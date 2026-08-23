import {
  getOutputFileName,
  isSupportedVideoExtension,
  isSupportedVideoType,
  resolveVideoContainer,
  type ValidatedVideoContainer,
} from "@/utils/media";
import {
  buildVerificationReport,
  classifyMetadata,
  formatMetadataValue,
  getVideoStreamSourceLabels,
  isSyntheticVideoMetadata,
  type MetadataEntry,
  type VerificationReport,
} from "@/utils/metadata";

const FFMPEG_CORE_URL = "/api/metadata/assets/ffmpeg-core.js";
const FFMPEG_WASM_URL = "/api/metadata/assets/ffmpeg-core.wasm";
const LOCAL_VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv"]);
const LOCAL_PROCESSING_TIMEOUT_MS = 180_000;
const MAX_DIAGNOSTIC_LINES = 20;
const MAX_DIAGNOSTIC_LINE_LENGTH = 512;
const MAX_DIAGNOSTIC_LENGTH = 2_048;
const MAX_FALLBACK_LOG_LINES = 2_048;
const MAX_FALLBACK_LOG_LENGTH = 512 * 1_024;

type FFmpegInstance = import("@ffmpeg/ffmpeg").FFmpeg;
type LocalVideoOperation = "inspect" | "clean";
type LocalVideoStage = "engine_load" | "mount" | "probe" | "remux" | "verify";
type ProbeData = {
  format?: { format_name?: string; tags?: Record<string, unknown> };
  streams?: Array<{ index: number; codec_type?: string; tags?: Record<string, unknown> }>;
  chapters?: Array<{ id?: number; tags?: Record<string, unknown> }>;
  programs?: Array<{ program_id?: number }>;
};

let ffmpegPromise: Promise<FFmpegInstance> | null = null;
let localVideoOperationQueue = Promise.resolve();
const inspectedVideoContainers = new WeakMap<File, ValidatedVideoContainer>();

class LocalVideoDiagnosticError extends Error {
  readonly diagnostic: string[];
  readonly diagnosticTruncated: boolean;
  readonly exitCode?: number;
  readonly stage: LocalVideoStage;

  constructor(
    message: string,
    stage: LocalVideoStage,
    options: { diagnostic?: string[]; diagnosticTruncated?: boolean; exitCode?: number } = {},
  ) {
    super(message);
    this.name = "LocalVideoDiagnosticError";
    this.stage = stage;
    this.exitCode = options.exitCode;
    this.diagnostic = options.diagnostic || [];
    this.diagnosticTruncated = options.diagnosticTruncated || false;
  }
}

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

const getSizeRange = (bytes: number) => {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 10) return "under_10_mb";
  if (megabytes < 50) return "10_50_mb";
  if (megabytes < 100) return "50_100_mb";
  return "100_mb_or_more";
};

const sanitizeDiagnosticLine = (message: string) =>
  message
    .replace(/\/input-[a-f\d]+\/input(?:\.[a-z\d]+)?/gi, "<input>")
    .replace(/\b(?:probe|output)-[a-f\d]+(?:\.[a-z\d]+)?/gi, "<output>")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DIAGNOSTIC_LINE_LENGTH);

const getSafeErrorDiagnostic = (error: unknown) => [
  sanitizeDiagnosticLine(error instanceof Error ? `${error.name}: ${error.message}` : String(error)),
];

const runLocalVideoOperation = <T>(operation: () => Promise<T>) => {
  const result = localVideoOperationQueue.then(operation, operation);
  localVideoOperationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const captureFfmpegDiagnostics = (ffmpeg: FFmpegInstance) => {
  const lines: string[] = [];
  let length = 0;
  let truncated = false;
  const logHandler = ({ type, message }: { type: string; message: string }) => {
    if (type !== "stderr") return;
    const line = sanitizeDiagnosticLine(message);
    if (!line) return;

    if (message.length > MAX_DIAGNOSTIC_LINE_LENGTH) truncated = true;
    lines.push(line);
    length += line.length;
    while (lines.length > MAX_DIAGNOSTIC_LINES || length > MAX_DIAGNOSTIC_LENGTH) {
      length -= lines.shift()?.length || 0;
      truncated = true;
    }
  };

  ffmpeg.on("log", logHandler);
  return {
    dispose: () => ffmpeg.off("log", logHandler),
    snapshot: () => ({ diagnostic: [...lines], diagnosticTruncated: truncated }),
  };
};

const logLocalVideoFailure = (operation: LocalVideoOperation, file: File, startedAt: number, error: unknown) => {
  const diagnosticError = error instanceof LocalVideoDiagnosticError ? error : null;
  const fallbackDiagnostic =
    error instanceof Error ? sanitizeDiagnosticLine(`${error.name}: ${error.message}`) : "Unknown local video error";
  const format = getVideoFormat(file);

  console.error(
    "[metadata][local-video]",
    JSON.stringify({
      event: `local_video_${operation}`,
      execution: "on_device",
      operation,
      stage: diagnosticError?.stage || "engine_load",
      result: "error",
      container: LOCAL_VIDEO_EXTENSIONS.has(format) ? format : "unknown",
      sizeRange: getSizeRange(file.size),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      errorCode:
        diagnosticError?.exitCode === -1
          ? "wasm_abort"
          : diagnosticError
            ? `${diagnosticError.stage}_failed`
            : "runtime_failed",
      ...(diagnosticError?.exitCode === undefined ? {} : { exitCode: diagnosticError.exitCode }),
      diagnostic: diagnosticError?.diagnostic.length ? diagnosticError.diagnostic : [fallbackDiagnostic],
      diagnosticTruncated: diagnosticError?.diagnosticTruncated || false,
    }),
  );
};

const getDeviceMemoryLimit = () => {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  const memory = navigatorWithMemory.deviceMemory;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (memory && memory <= 2) return 48 * 1024 * 1024;
  if (memory && memory <= 4) return 80 * 1024 * 1024;
  if (memory && memory <= 8) return (isMobile ? 96 : 160) * 1024 * 1024;
  return (isMobile ? 128 : 224) * 1024 * 1024;
};

const createFfmpeg = async () => {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({ coreURL: FFMPEG_CORE_URL, wasmURL: FFMPEG_WASM_URL });
  return ffmpeg;
};

const getFfmpeg = async () => {
  if (!ffmpegPromise) {
    ffmpegPromise = createFfmpeg().catch((error) => {
      ffmpegPromise = null;
      throw error;
    });
  }

  return ffmpegPromise;
};

const discardFfmpeg = async () => {
  const currentPromise = ffmpegPromise;
  ffmpegPromise = null;
  const current = await currentPromise?.catch(() => null);
  current?.terminate();
};

const toText = (data: Awaited<ReturnType<FFmpegInstance["readFile"]>>) => {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
};

const createVideoEntry = (
  scope: "format" | "stream" | "chapter",
  key: string,
  value: unknown,
  options: { streamIndex?: number; chapterIndex?: number; sourceGroup: string; sourceLabel: string },
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
    sourceLabel: options.sourceLabel,
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

const probeDataToEntries = (data: ProbeData, container: string) => {
  const entries: MetadataEntry[] = [];

  Object.entries(data.format?.tags || {}).forEach(([key, value]) => {
    const entry = createVideoEntry("format", key, value, { sourceGroup: "Container", sourceLabel: "File" });
    if (entry) entries.push(entry);
  });

  const streams = data.streams || [];
  const streamSourceLabels = getVideoStreamSourceLabels(streams.map((stream) => stream.codec_type));
  streams.forEach((stream, position) => {
    const sourceGroup = `${stream.codec_type?.toUpperCase() || "STREAM"} stream ${position + 1}`;
    Object.entries(stream.tags || {}).forEach(([key, value]) => {
      if (isSyntheticVideoMetadata(container, "stream", key)) return;

      const entry = createVideoEntry("stream", key, value, {
        streamIndex: stream.index,
        sourceGroup,
        sourceLabel: streamSourceLabels[position],
      });
      if (entry) entries.push(entry);
    });
  });

  (data.chapters || []).forEach((chapter, position) => {
    Object.entries(chapter.tags || {}).forEach(([key, value]) => {
      const entry = createVideoEntry("chapter", key, value, {
        chapterIndex: position,
        sourceGroup: `Chapter ${position + 1}`,
        sourceLabel: `Chapter ${position + 1}`,
      });
      if (entry) entries.push(entry);
    });
  });

  return entries.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
};

const withMountedFile = async <T>(file: File, operation: (ffmpeg: FFmpegInstance, inputPath: string) => Promise<T>) => {
  let ffmpeg: FFmpegInstance;
  try {
    ffmpeg = await getFfmpeg();
  } catch (error) {
    throw new LocalVideoDiagnosticError("The local video engine could not start.", "engine_load", {
      diagnostic: getSafeErrorDiagnostic(error),
    });
  }
  const { FFFSType } = await import("@ffmpeg/ffmpeg");
  const operationId = crypto.randomUUID().replace(/-/g, "");
  const mountPath = `/input-${operationId}` as `/${string}`;
  const extension = getExtension(file.name);
  const mountedName = `input${extension ? `.${extension}` : ""}`;
  const mountedFile = new File([file], mountedName, { type: file.type, lastModified: file.lastModified });

  try {
    await ffmpeg.createDir(mountPath);
    await ffmpeg.mount(FFFSType.WORKERFS, { files: [mountedFile] }, mountPath);
  } catch (error) {
    await ffmpeg.deleteDir(mountPath).catch(() => undefined);
    throw new LocalVideoDiagnosticError("The browser could not open this video for local processing.", "mount", {
      diagnostic: getSafeErrorDiagnostic(error),
    });
  }

  try {
    return await operation(ffmpeg, `${mountPath}/${mountedName}`);
  } finally {
    await ffmpeg.unmount(mountPath).catch(() => undefined);
    await ffmpeg.deleteDir(mountPath).catch(() => undefined);
  }
};

const probePath = async (ffmpeg: FFmpegInstance, inputPath: string, stage: "probe" | "verify") => {
  const outputPath = `probe-${crypto.randomUUID().replace(/-/g, "")}.json`;
  const diagnostics = captureFfmpegDiagnostics(ffmpeg);

  try {
    const exitCode = await ffmpeg.ffprobe(
      [
        "-hide_banner",
        "-v",
        "error",
        "-nofind_stream_info",
        "-print_format",
        "json",
        "-show_entries",
        "format=format_name:format_tags:stream=index,codec_type:stream_tags:chapter=id:chapter_tags:program=program_id",
        inputPath,
        "-o",
        outputPath,
      ],
      LOCAL_PROCESSING_TIMEOUT_MS,
    );

    if (exitCode !== 0) {
      throw new LocalVideoDiagnosticError("The browser could not inspect this video container.", stage, {
        ...diagnostics.snapshot(),
        exitCode,
      });
    }
    const output = await ffmpeg.readFile(outputPath, "utf8");
    try {
      return JSON.parse(toText(output)) as ProbeData;
    } catch {
      throw new LocalVideoDiagnosticError("The local video engine returned an unreadable inspection result.", stage, {
        ...diagnostics.snapshot(),
        exitCode,
      });
    }
  } catch (error) {
    if (error instanceof LocalVideoDiagnosticError) throw error;
    throw new LocalVideoDiagnosticError("The browser could not inspect this video container.", stage, {
      ...diagnostics.snapshot(),
    });
  } finally {
    diagnostics.dispose();
    await ffmpeg.deleteFile(outputPath).catch(() => undefined);
  }
};

const captureFfmpegInputLog = (ffmpeg: FFmpegInstance) => {
  const lines: string[] = [];
  let complete = false;
  let length = 0;
  let readingInput = false;
  let truncated = false;

  const logHandler = ({ type, message }: { type: string; message: string }) => {
    if (type !== "stderr" || complete) return;

    message.split(/\r?\n/).forEach((rawLine) => {
      if (complete) return;
      const line = rawLine.replace(/\r$/, "");

      if (!readingInput) {
        if (!/^Input #0(?:,|\s)/.test(line)) return;
        readingInput = true;
      } else if (/^(?:Output #0(?:,|\s)|Stream mapping:)/.test(line)) {
        complete = true;
        return;
      }

      const remainingLength = MAX_FALLBACK_LOG_LENGTH - length;
      if (lines.length >= MAX_FALLBACK_LOG_LINES || remainingLength <= 0) {
        truncated = true;
        return;
      }

      const capturedLine = line.slice(0, remainingLength);
      lines.push(capturedLine);
      length += capturedLine.length;
      if (capturedLine.length !== line.length) truncated = true;
    });
  };

  ffmpeg.on("log", logHandler);
  return {
    dispose: () => ffmpeg.off("log", logHandler),
    snapshot: () => ({ complete, lines: [...lines], truncated }),
  };
};

const parseFfmpegInputLog = (lines: string[]): ProbeData | null => {
  const formatTags: Record<string, unknown> = {};
  const streams: NonNullable<ProbeData["streams"]> = [];
  const chapters: NonNullable<ProbeData["chapters"]> = [];
  const programs: NonNullable<ProbeData["programs"]> = [];
  let activeTags = formatTags;
  let currentTag: string | null = null;
  let formatName = "";
  let readingInput = false;
  let readingMetadata = false;

  lines.forEach((line) => {
    const inputMatch = line.match(/^Input #0,\s*(.+),\s+from\s+/);
    if (inputMatch) {
      readingInput = true;
      formatName = inputMatch[1].trim();
      activeTags = formatTags;
      currentTag = null;
      readingMetadata = false;
      return;
    }
    if (!readingInput) return;

    const programMatch = line.match(/^\s{2,}Program\s+(\d+)(?:\s|$)/);
    if (programMatch) {
      programs.push({ program_id: Number(programMatch[1]) });
      activeTags = {};
      currentTag = null;
      readingMetadata = false;
      return;
    }

    const streamMatch = line.match(
      /^\s{2,}Stream #0:(\d+)(?:\[[^\]]+\])?(?:\(([^)]+)\))?:\s*(Video|Audio|Subtitle|Data|Attachment|Unknown)\s*:/i,
    );
    if (streamMatch) {
      const tags: Record<string, unknown> = {};
      const language = streamMatch[2]?.trim();
      if (language) tags.language = language;
      streams.push({ index: Number(streamMatch[1]), codec_type: streamMatch[3].toLowerCase(), tags });
      activeTags = tags;
      currentTag = null;
      readingMetadata = false;
      return;
    }

    const chapterMatch = line.match(/^\s{2,}Chapter #0:(\d+)(?::|\s)/);
    if (chapterMatch) {
      const tags: Record<string, unknown> = {};
      chapters.push({ id: Number(chapterMatch[1]), tags });
      activeTags = tags;
      currentTag = null;
      readingMetadata = false;
      return;
    }

    if (/^\s{2,}Metadata:\s*$/.test(line)) {
      currentTag = null;
      readingMetadata = true;
      return;
    }

    if (!readingMetadata) return;
    if (/^\s{2,}(?:Disposition|Side data):\s*$/.test(line)) {
      currentTag = null;
      readingMetadata = false;
      return;
    }

    const tagMatch = line.match(/^\s{4,}([^:]+?)\s*:\s?(.*)$/);
    if (tagMatch) {
      currentTag = tagMatch[1].trim();
      activeTags[currentTag] = tagMatch[2].trim();
      return;
    }

    if (currentTag && /^\s{6,}\S/.test(line)) {
      activeTags[currentTag] = `${activeTags[currentTag]}\n${line.trim()}`;
    }
  });

  if (!readingInput || streams.length === 0) return null;
  return { format: { format_name: formatName, tags: formatTags }, streams, chapters, programs };
};

const probePathWithFfmpegLog = async (ffmpeg: FFmpegInstance, inputPath: string, stage: "probe" | "verify") => {
  const inputLog = captureFfmpegInputLog(ffmpeg);

  try {
    let exitCode: number;
    try {
      exitCode = await ffmpeg.exec(
        [
          "-hide_banner",
          "-loglevel",
          "info",
          "-nostats",
          "-i",
          inputPath,
          "-map",
          "0",
          "-t",
          "0",
          "-c",
          "copy",
          "-f",
          "null",
          "-",
        ],
        LOCAL_PROCESSING_TIMEOUT_MS,
      );
    } catch (error) {
      throw new LocalVideoDiagnosticError("The browser could not inspect this video container.", stage, {
        diagnostic: getSafeErrorDiagnostic(error),
      });
    }

    const captured = inputLog.snapshot();
    const data = captured.complete && !captured.truncated ? parseFfmpegInputLog(captured.lines) : null;
    if (!data) {
      throw new LocalVideoDiagnosticError("The browser could not inspect this video container.", stage, {
        diagnostic: [
          captured.truncated
            ? "The FFmpeg metadata fallback exceeded its bounded output size."
            : "FFmpeg did not expose a complete input metadata block.",
        ],
        exitCode,
      });
    }

    return { data, exitCode };
  } finally {
    inputLog.dispose();
  }
};

const recoverProbeAbort = async (file: File, stage: "probe" | "verify", originalError: LocalVideoDiagnosticError) => {
  await discardFfmpeg();

  try {
    const fallback = await withMountedFile(file, (ffmpeg, inputPath) =>
      probePathWithFfmpegLog(ffmpeg, inputPath, stage),
    );
    if (fallback.exitCode === -1) await discardFfmpeg();
    return fallback.data;
  } catch (error) {
    if (error instanceof LocalVideoDiagnosticError && error.exitCode === -1) await discardFfmpeg();
    if (error instanceof LocalVideoDiagnosticError) throw error;
    throw originalError;
  }
};

const probeVideo = async (file: File, stage: "probe" | "verify") => {
  try {
    return await withMountedFile(file, (ffmpeg, inputPath) => probePath(ffmpeg, inputPath, stage));
  } catch (error) {
    if (error instanceof LocalVideoDiagnosticError && error.exitCode === -1) {
      return recoverProbeAbort(file, stage, error);
    }
    throw error;
  }
};

const validateVideoProbe = (file: File, data: ProbeData, stage: "probe" | "verify") => {
  if ((data.programs || []).length > 0) {
    throw new LocalVideoDiagnosticError(
      "This video uses a program structure that SnapBox cannot preserve safely.",
      stage,
    );
  }

  try {
    return resolveVideoContainer(file.name, file.type, data.format?.format_name);
  } catch (error) {
    throw new LocalVideoDiagnosticError(
      error instanceof Error ? error.message : "The detected video container is not supported.",
      stage,
      { diagnostic: getSafeErrorDiagnostic(error) },
    );
  }
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
  return runLocalVideoOperation(async () => {
    const startedAt = performance.now();
    try {
      const data = await probeVideo(file, "probe");
      const container = validateVideoProbe(file, data, "probe");
      inspectedVideoContainers.set(file, container);
      return probeDataToEntries(data, container.extension);
    } catch (error) {
      logLocalVideoFailure("inspect", file, startedAt, error);
      throw new Error(error instanceof Error ? error.message : "The browser could not inspect this video container.");
    }
  });
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

  return runLocalVideoOperation(async () => {
    const startedAt = performance.now();
    try {
      const selectedIdSet = new Set(selected.map((entry) => entry.id));
      let container = inspectedVideoContainers.get(file);
      if (!container) {
        const data = await probeVideo(file, "probe");
        container = validateVideoProbe(file, data, "probe");
        inspectedVideoContainers.set(file, container);
      }
      const requestedOutputName = getOutputFileName(file.name, "clean");
      const outputName = getExtension(requestedOutputName)
        ? requestedOutputName
        : `${requestedOutputName.replace(/\.+$/, "")}.${container.extension}`;

      const outputData = await withMountedFile(file, async (ffmpeg, inputPath) => {
        const outputPath = `output-${crypto.randomUUID().replace(/-/g, "")}.${container.extension}`;
        const args = [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          container.demuxer,
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
          "-fflags",
          "+bitexact",
          "-c",
          "copy",
        ];

        entries.forEach((entry) => {
          if (selectedIdSet.has(entry.id)) return;

          if (entry.scope === "format") args.push("-metadata", `${entry.key}=${entry.value}`);
          if (entry.scope === "stream")
            args.push(`-metadata:s:${entry.streamIndex ?? 0}`, `${entry.key}=${entry.value}`);
          if (entry.scope === "chapter")
            args.push(`-metadata:c:${entry.chapterIndex ?? 0}`, `${entry.key}=${entry.value}`);
        });

        args.push("-f", container.muxer, outputPath);

        const progressHandler = ({ progress }: { progress: number }) => {
          onProgress?.(Math.max(0, Math.min(100, Math.round(progress * 100))));
        };
        const diagnostics = captureFfmpegDiagnostics(ffmpeg);
        ffmpeg.on("progress", progressHandler);

        try {
          const exitCode = await ffmpeg.exec(args, LOCAL_PROCESSING_TIMEOUT_MS);
          if (exitCode !== 0) {
            throw new LocalVideoDiagnosticError(
              "The browser could not remux this video without converting it.",
              "remux",
              {
                ...diagnostics.snapshot(),
                exitCode,
              },
            );
          }
          const data = await ffmpeg.readFile(outputPath);
          if (typeof data === "string") {
            throw new LocalVideoDiagnosticError("The local video engine returned an invalid file.", "remux", {
              ...diagnostics.snapshot(),
              exitCode,
            });
          }
          return new Uint8Array(data);
        } catch (error) {
          if (error instanceof LocalVideoDiagnosticError) throw error;
          throw new LocalVideoDiagnosticError(
            "The browser could not remux this video without converting it.",
            "remux",
            {
              ...diagnostics.snapshot(),
            },
          );
        } finally {
          diagnostics.dispose();
          ffmpeg.off("progress", progressHandler);
          await ffmpeg.deleteFile(outputPath).catch(() => undefined);
        }
      });

      const outputFile = new File([outputData], outputName, { type: container.mimeType });
      const verifiedData = await probeVideo(outputFile, "verify");
      const verifiedContainer = validateVideoProbe(outputFile, verifiedData, "verify");
      const verifiedEntries = probeDataToEntries(verifiedData, verifiedContainer.extension);

      return {
        blob: outputFile,
        fileName: outputName,
        report: buildVerificationReport(entries, verifiedEntries, selectedIdSet),
      };
    } catch (error) {
      logLocalVideoFailure("clean", file, startedAt, error);
      throw new Error(error instanceof Error ? error.message : "The browser could not clean this video locally.");
    }
  });
};

export const disposeLocalVideoEngine = discardFfmpeg;
