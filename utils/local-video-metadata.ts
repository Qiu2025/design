import { getOutputFileName, isSupportedVideoExtension, isSupportedVideoType } from "@/utils/media";
import {
  buildVerificationReport,
  classifyMetadata,
  formatMetadataValue,
  type MetadataEntry,
  type VerificationReport,
} from "@/utils/metadata";

const FFMPEG_CORE_URL = "/api/metadata/assets/ffmpeg-core.js";
const FFMPEG_WASM_URL = "/api/metadata/assets/ffmpeg-core.wasm";
const LOCAL_VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv"]);
const LOCAL_PROCESSING_TIMEOUT_MS = 180_000;

type FFmpegInstance = import("@ffmpeg/ffmpeg").FFmpeg;
type ProbeData = {
  format?: { tags?: Record<string, unknown> };
  streams?: Array<{ index: number; codec_type?: string; tags?: Record<string, unknown> }>;
  chapters?: Array<{ id?: number; tags?: Record<string, unknown> }>;
};

let ffmpegPromise: Promise<FFmpegInstance> | null = null;

const getExtension = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex === -1 ? "" : fileName.slice(dotIndex + 1).toLowerCase();
};

const getVideoFormat = (file: File) => {
  const extension = getExtension(file.name);
  if (extension) return extension;

  return (
    {
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "video/webm": "webm",
      "video/x-matroska": "mkv",
    }[file.type] || ""
  );
};

const getVideoMimeType = (file: File) => file.type || "application/octet-stream";

const getDeviceMemoryLimit = () => {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  const memory = navigatorWithMemory.deviceMemory;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (memory && memory <= 2) return 48 * 1024 * 1024;
  if (memory && memory <= 4) return 80 * 1024 * 1024;
  if (memory && memory <= 8) return (isMobile ? 96 : 160) * 1024 * 1024;
  return (isMobile ? 128 : 224) * 1024 * 1024;
};

const getFfmpeg = async () => {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({ coreURL: FFMPEG_CORE_URL, wasmURL: FFMPEG_WASM_URL });
      return ffmpeg;
    })().catch((error) => {
      ffmpegPromise = null;
      throw error;
    });
  }

  return ffmpegPromise;
};

const toText = (data: Awaited<ReturnType<FFmpegInstance["readFile"]>>) => {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
};

const createVideoEntry = (
  scope: "format" | "stream" | "chapter",
  key: string,
  value: unknown,
  options: { streamIndex?: number; chapterIndex?: number; sourceGroup: string },
): MetadataEntry | null => {
  const stringValue = formatMetadataValue(value);
  if (!stringValue) return null;

  const classification = classifyMetadata(options.sourceGroup, key, scope);
  const suffix =
    scope === "stream"
      ? `${options.streamIndex ?? -1}:${key}`
      : scope === "chapter"
        ? `${options.chapterIndex ?? -1}:${key}`
        : key;

  return {
    id: `${scope}:${suffix}`,
    group: classification.group,
    label: key,
    value: stringValue,
    key,
    scope,
    streamIndex: options.streamIndex,
    chapterIndex: options.chapterIndex,
    sensitivity: classification.sensitivity,
    protected: classification.protected,
    protectionReason: classification.protectionReason,
  };
};

const probeDataToEntries = (data: ProbeData) => {
  const entries: MetadataEntry[] = [];

  Object.entries(data.format?.tags || {}).forEach(([key, value]) => {
    const entry = createVideoEntry("format", key, value, { sourceGroup: "Container" });
    if (entry) entries.push(entry);
  });

  (data.streams || []).forEach((stream, position) => {
    const sourceGroup = `${stream.codec_type?.toUpperCase() || "STREAM"} stream ${position + 1}`;
    Object.entries(stream.tags || {}).forEach(([key, value]) => {
      const entry = createVideoEntry("stream", key, value, { streamIndex: stream.index, sourceGroup });
      if (entry) entries.push(entry);
    });
  });

  (data.chapters || []).forEach((chapter, position) => {
    Object.entries(chapter.tags || {}).forEach(([key, value]) => {
      const entry = createVideoEntry("chapter", key, value, {
        chapterIndex: chapter.id ?? position,
        sourceGroup: `Chapter ${position + 1}`,
      });
      if (entry) entries.push(entry);
    });
  });

  return entries.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
};

const withMountedFile = async <T>(file: File, operation: (ffmpeg: FFmpegInstance, inputPath: string) => Promise<T>) => {
  const ffmpeg = await getFfmpeg();
  const { FFFSType } = await import("@ffmpeg/ffmpeg");
  const operationId = crypto.randomUUID().replace(/-/g, "");
  const mountPath = `/input-${operationId}` as `/${string}`;
  const extension = getExtension(file.name);
  const mountedName = `input${extension ? `.${extension}` : ""}`;
  const mountedFile = new File([file], mountedName, { type: file.type, lastModified: file.lastModified });

  await ffmpeg.createDir(mountPath);
  await ffmpeg.mount(FFFSType.WORKERFS, { files: [mountedFile] }, mountPath);

  try {
    return await operation(ffmpeg, `${mountPath}/${mountedName}`);
  } finally {
    await ffmpeg.unmount(mountPath).catch(() => undefined);
    await ffmpeg.deleteDir(mountPath).catch(() => undefined);
  }
};

const probeVideo = async (file: File) => {
  return withMountedFile(file, async (ffmpeg, inputPath) => {
    const outputPath = `probe-${crypto.randomUUID().replace(/-/g, "")}.json`;

    try {
      const exitCode = await ffmpeg.ffprobe(
        [
          "-v",
          "error",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          "-show_chapters",
          inputPath,
          "-o",
          outputPath,
        ],
        LOCAL_PROCESSING_TIMEOUT_MS,
      );

      if (exitCode !== 0) throw new Error("The browser could not inspect this video container.");
      const output = await ffmpeg.readFile(outputPath, "utf8");
      return JSON.parse(toText(output)) as ProbeData;
    } finally {
      await ffmpeg.deleteFile(outputPath).catch(() => undefined);
    }
  });
};

export const getLocalVideoSupport = (file: File) => {
  if (typeof WebAssembly === "undefined" || typeof Worker === "undefined") {
    return { supported: false, reason: "This browser cannot run the local video engine." };
  }

  if (!isSupportedVideoType(file.type) && !isSupportedVideoExtension(file.name)) {
    return { supported: false, reason: "This video format is not supported." };
  }

  if (!LOCAL_VIDEO_EXTENSIONS.has(getVideoFormat(file))) {
    return { supported: false, reason: "This container needs the server video engine." };
  }

  const limit = getDeviceMemoryLimit();
  if (file.size > limit) {
    return {
      supported: false,
      reason: `This file is too large for the available browser memory (${Math.round(limit / (1024 * 1024))} MB local limit).`,
    };
  }

  return { supported: true, reason: null };
};

export const inspectLocalVideo = async (file: File) => {
  const support = getLocalVideoSupport(file);
  if (!support.supported) throw new Error(support.reason || "This video cannot be processed locally.");
  return probeDataToEntries(await probeVideo(file));
};

export type LocalVideoCleanResult = {
  blob: Blob;
  fileName: string;
  report: VerificationReport;
};

export const cleanLocalVideo = async (
  file: File,
  entries: MetadataEntry[],
  selectedIds: Set<string>,
  onProgress?: (progress: number) => void,
): Promise<LocalVideoCleanResult> => {
  const selected = entries.filter((entry) => selectedIds.has(entry.id) && !entry.protected);
  if (selected.length === 0) throw new Error("Select at least one removable metadata field.");

  const selectedIdSet = new Set(selected.map((entry) => entry.id));
  const outputName = getOutputFileName(file.name, "clean");
  const extension = getVideoFormat(file);

  const outputData = await withMountedFile(file, async (ffmpeg, inputPath) => {
    const outputPath = `output-${crypto.randomUUID().replace(/-/g, "")}${extension ? `.${extension}` : ""}`;
    const args = [
      "-y",
      "-i",
      inputPath,
      "-map",
      "0",
      "-map_metadata:g",
      "-1",
      "-map_metadata:s",
      "-1",
      "-map_metadata:c",
      "-1",
      "-map_chapters",
      "0",
      "-c",
      "copy",
    ];

    entries.forEach((entry) => {
      if (selectedIdSet.has(entry.id)) return;

      if (entry.scope === "format") args.push("-metadata", `${entry.key}=${entry.value}`);
      if (entry.scope === "stream") args.push(`-metadata:s:${entry.streamIndex ?? 0}`, `${entry.key}=${entry.value}`);
      if (entry.scope === "chapter") args.push(`-metadata:c:${entry.chapterIndex ?? 0}`, `${entry.key}=${entry.value}`);
    });

    args.push(outputPath);

    const progressHandler = ({ progress }: { progress: number }) => {
      onProgress?.(Math.max(0, Math.min(100, Math.round(progress * 100))));
    };
    ffmpeg.on("progress", progressHandler);

    try {
      const exitCode = await ffmpeg.exec(args, LOCAL_PROCESSING_TIMEOUT_MS);
      if (exitCode !== 0) throw new Error("The browser could not remux this video without converting it.");
      const data = await ffmpeg.readFile(outputPath);
      if (typeof data === "string") throw new Error("The local video engine returned an invalid file.");
      return new Uint8Array(data);
    } finally {
      ffmpeg.off("progress", progressHandler);
      await ffmpeg.deleteFile(outputPath).catch(() => undefined);
    }
  });

  const outputFile = new File([outputData], outputName, { type: getVideoMimeType(file) });
  const verifiedEntries = probeDataToEntries(await probeVideo(outputFile));

  return {
    blob: outputFile,
    fileName: outputName,
    report: buildVerificationReport(entries, verifiedEntries, selectedIds),
  };
};

export const disposeLocalVideoEngine = async () => {
  const ffmpeg = await ffmpegPromise?.catch(() => null);
  ffmpeg?.terminate();
  ffmpegPromise = null;
};
