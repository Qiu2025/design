import { spawn, type ChildProcess } from "node:child_process";
import {
  classifyMetadata,
  formatMetadataValue,
  metadataEntryMatches,
  type MetadataEntry,
  type SelectedMetadataEntry,
} from "@/utils/metadata";

const COMMAND_TIMEOUT_MS = 120_000;
const MAX_STDERR_LENGTH = 64 * 1024;

type ProbeData = {
  format?: { tags?: Record<string, unknown> };
  streams?: Array<{ index: number; codec_type?: string; tags?: Record<string, unknown> }>;
  chapters?: Array<{ id?: number; tags?: Record<string, unknown> }>;
};

const runCommand = (command: string, args: string[], captureStdout: boolean) => {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let processHandle: ChildProcess;

    try {
      processHandle = spawn(command, args, { stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      processHandle.kill("SIGKILL");
      reject(new Error("Video processing timed out."));
    }, COMMAND_TIMEOUT_MS);

    processHandle.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    processHandle.stderr?.on("data", (chunk) => {
      if (stderr.length < MAX_STDERR_LENGTH) stderr += chunk.toString();
    });
    processHandle.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    processHandle.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Command failed with code ${code}`));
    });
  });
};

const createEntry = (
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
    const entry = createEntry("format", key, value, { sourceGroup: "Container" });
    if (entry) entries.push(entry);
  });

  (data.streams || []).forEach((stream, position) => {
    const sourceGroup = `${stream.codec_type?.toUpperCase() || "STREAM"} stream ${position + 1}`;
    Object.entries(stream.tags || {}).forEach(([key, value]) => {
      const entry = createEntry("stream", key, value, { streamIndex: stream.index, sourceGroup });
      if (entry) entries.push(entry);
    });
  });

  (data.chapters || []).forEach((chapter, position) => {
    Object.entries(chapter.tags || {}).forEach(([key, value]) => {
      const entry = createEntry("chapter", key, value, {
        chapterIndex: chapter.id ?? position,
        sourceGroup: `Chapter ${position + 1}`,
      });
      if (entry) entries.push(entry);
    });
  });

  return entries.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
};

export const inspectVideoMetadata = async (filePath: string) => {
  const ffprobeBinary = process.env.FFPROBE_PATH || "ffprobe";
  const output = await runCommand(
    ffprobeBinary,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", filePath],
    true,
  );

  return probeDataToEntries(JSON.parse(output) as ProbeData);
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

  before.forEach((entry) => {
    if (selected.some((candidate) => metadataEntryMatches(entry, candidate))) return;

    if (entry.scope === "format") args.push("-metadata", `${entry.key}=${entry.value}`);
    if (entry.scope === "stream") args.push(`-metadata:s:${entry.streamIndex ?? 0}`, `${entry.key}=${entry.value}`);
    if (entry.scope === "chapter") args.push(`-metadata:c:${entry.chapterIndex ?? 0}`, `${entry.key}=${entry.value}`);
  });

  args.push(outputPath);
  await runCommand(ffmpegBinary, args, false);
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
