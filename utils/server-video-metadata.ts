import { spawn, type ChildProcess } from "node:child_process";
import { getExtensionFromFileName } from "@/utils/media";
import {
  classifyMetadata,
  formatMetadataValue,
  getVideoStreamSourceLabels,
  isSyntheticVideoMetadata,
  metadataEntryMatches,
  type MetadataEntry,
  type SelectedMetadataEntry,
} from "@/utils/metadata";

const COMMAND_TIMEOUT_MS = 120_000;
const MAX_STDERR_LENGTH = 64 * 1024;

export type VideoCommandStage = "probe" | "probe_before" | "probe_after" | "remux";
export type VideoCommandFailureKind = "command_failed" | "timeout" | "unavailable";
export type VideoCommandFailureReason =
  | "invalid_data"
  | "missing_movie_header"
  | "permission_denied"
  | "unknown"
  | "unsupported_media";

export class VideoCommandError extends Error {
  readonly exitCode?: number;
  readonly kind: VideoCommandFailureKind;
  readonly reason: VideoCommandFailureReason;
  readonly stage: VideoCommandStage;
  readonly tool: "ffmpeg" | "ffprobe";

  constructor(
    tool: "ffmpeg" | "ffprobe",
    stage: VideoCommandStage,
    kind: VideoCommandFailureKind,
    options: { exitCode?: number; reason?: VideoCommandFailureReason } = {},
  ) {
    super(`${tool}_${kind}`);
    this.name = "VideoCommandError";
    this.tool = tool;
    this.stage = stage;
    this.kind = kind;
    this.exitCode = options.exitCode;
    this.reason = options.reason || "unknown";
  }
}

type ProbeData = {
  format?: { tags?: Record<string, unknown> };
  streams?: Array<{ index: number; codec_type?: string; tags?: Record<string, unknown> }>;
  chapters?: Array<{ id?: number; tags?: Record<string, unknown> }>;
};

const getCommandFailureReason = (stderr: string): VideoCommandFailureReason => {
  const detail = stderr.toLowerCase();
  if (detail.includes("moov atom not found")) return "missing_movie_header";
  if (detail.includes("invalid data found when processing input")) return "invalid_data";
  if (detail.includes("permission denied")) return "permission_denied";
  if (detail.includes("unsupported codec") || detail.includes("unknown decoder")) return "unsupported_media";
  return "unknown";
};

const runCommand = (
  tool: "ffmpeg" | "ffprobe",
  stage: VideoCommandStage,
  command: string,
  args: string[],
  captureStdout: boolean,
) => {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let processHandle: ChildProcess;

    try {
      processHandle = spawn(command, args, { stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"] });
    } catch (error) {
      const kind = (error as NodeJS.ErrnoException).code === "ENOENT" ? "unavailable" : "command_failed";
      reject(new VideoCommandError(tool, stage, kind));
      return;
    }

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      processHandle.kill("SIGKILL");
      reject(new VideoCommandError(tool, stage, "timeout"));
    }, COMMAND_TIMEOUT_MS);

    processHandle.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    processHandle.stderr?.on("data", (chunk) => {
      const message = chunk.toString();
      const combined = stderr + message;
      stderr = combined.slice(-MAX_STDERR_LENGTH);
    });
    processHandle.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const kind = (error as NodeJS.ErrnoException).code === "ENOENT" ? "unavailable" : "command_failed";
      reject(new VideoCommandError(tool, stage, kind));
    });
    processHandle.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(
        new VideoCommandError(tool, stage, "command_failed", {
          exitCode: code ?? undefined,
          reason: getCommandFailureReason(stderr),
        }),
      );
    });
  });
};

const createEntry = (
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
    const entry = createEntry("format", key, value, { sourceGroup: "Container", sourceLabel: "File" });
    if (entry) entries.push(entry);
  });

  const streams = data.streams || [];
  const streamSourceLabels = getVideoStreamSourceLabels(streams.map((stream) => stream.codec_type));
  streams.forEach((stream, position) => {
    const sourceGroup = `${stream.codec_type?.toUpperCase() || "STREAM"} stream ${position + 1}`;
    Object.entries(stream.tags || {}).forEach(([key, value]) => {
      if (isSyntheticVideoMetadata(container, "stream", key)) return;

      const entry = createEntry("stream", key, value, {
        streamIndex: stream.index,
        sourceGroup,
        sourceLabel: streamSourceLabels[position],
      });
      if (entry) entries.push(entry);
    });
  });

  (data.chapters || []).forEach((chapter, position) => {
    Object.entries(chapter.tags || {}).forEach(([key, value]) => {
      const entry = createEntry("chapter", key, value, {
        chapterIndex: chapter.id ?? position,
        sourceGroup: `Chapter ${position + 1}`,
        sourceLabel: `Chapter ${position + 1}`,
      });
      if (entry) entries.push(entry);
    });
  });

  return entries.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
};

export const inspectVideoMetadata = async (filePath: string, stage: Exclude<VideoCommandStage, "remux"> = "probe") => {
  const ffprobeBinary = process.env.FFPROBE_PATH || "ffprobe";
  const output = await runCommand(
    "ffprobe",
    stage,
    ffprobeBinary,
    [
      "-hide_banner",
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      "-show_chapters",
      filePath,
    ],
    true,
  );

  return probeDataToEntries(JSON.parse(output) as ProbeData, getExtensionFromFileName(filePath));
};

export const removeVideoMetadata = async (
  inputPath: string,
  outputPath: string,
  before: MetadataEntry[],
  selected: SelectedMetadataEntry[],
) => {
  const ffmpegBinary = process.env.FFMPEG_PATH || "ffmpeg";
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
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

  before.forEach((entry) => {
    if (selected.some((candidate) => metadataEntryMatches(entry, candidate))) return;

    if (entry.scope === "format") args.push("-metadata", `${entry.key}=${entry.value}`);
    if (entry.scope === "stream") args.push(`-metadata:s:${entry.streamIndex ?? 0}`, `${entry.key}=${entry.value}`);
    if (entry.scope === "chapter") args.push(`-metadata:c:${entry.chapterIndex ?? 0}`, `${entry.key}=${entry.value}`);
  });

  args.push(outputPath);
  await runCommand("ffmpeg", "remux", ffmpegBinary, args, false);
};

export const findUnresolvedMetadata = (
  before: MetadataEntry[],
  after: MetadataEntry[],
  selected: SelectedMetadataEntry[],
) => {
  return before.filter(
    (entry) =>
      selected.some((candidate) => metadataEntryMatches(entry, candidate)) &&
      after.some((candidate) =>
        metadataEntryMatches(candidate, {
          scope: entry.scope,
          key: entry.key,
          streamIndex: entry.streamIndex,
          chapterIndex: entry.chapterIndex,
        }),
      ),
  );
};
