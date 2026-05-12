import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { exiftool } from "exiftool-vendored";
import {
  isSupportedImageExtension,
  isSupportedImageType,
  isSupportedVideoExtension,
  isSupportedVideoType,
} from "@/utils/media";

export const runtime = "nodejs";

const TEMP_DIRECTORY = join(tmpdir(), "snapbox-metadata-inspect");

type InspectMode = "image" | "video";

type MetadataEntry = {
  id: string;
  group: string;
  label: string;
  value: string;
  key: string;
  scope: "image" | "format" | "stream";
  streamIndex?: number;
};

const isSupportedImage = (file: File) => isSupportedImageType(file.type) || isSupportedImageExtension(file.name);
const isSupportedVideo = (file: File) => isSupportedVideoType(file.type) || isSupportedVideoExtension(file.name);

const toStringValue = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return null;
};

const SYSTEM_IMAGE_TAGS = new Set([
  "SourceFile",
  "FileName",
  "Directory",
  "FileSize",
  "FileType",
  "FileTypeExtension",
  "MIMEType",
  "ImageSize",
  "Megapixels",
  "ExifToolVersion",
]);

const getImageGroup = (key: string) => {
  const lower = key.toLowerCase();
  if (lower.includes("gps") || lower.includes("location")) return "Location";
  if (lower.includes("date") || lower.includes("time")) return "Timestamps";
  if (
    lower.includes("camera") ||
    lower.includes("lens") ||
    lower.includes("focal") ||
    lower.includes("exposure") ||
    lower.includes("fnumber")
  )
    return "Camera";
  if (lower.includes("copyright") || lower.includes("artist") || lower.includes("owner")) return "Ownership";
  if (lower.includes("software") || lower.includes("creator") || lower.includes("maker")) return "Software";
  if (lower.includes("icc") || lower.includes("profile") || lower.includes("color")) return "Color Profile";
  return "Other";
};

const runCommand = (command: string, args: string[]) => {
  return new Promise<string>((resolve, reject) => {
    const processHandle = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    processHandle.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    processHandle.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    processHandle.on("error", (error) => reject(error));
    processHandle.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Command failed with code ${code}`));
      }
    });
  });
};

const inspectImage = async (filePath: string) => {
  const tags = await exiftool.read(filePath);
  const entries: MetadataEntry[] = [];

  Object.entries(tags).forEach(([key, value]) => {
    if (SYSTEM_IMAGE_TAGS.has(key)) {
      return;
    }

    const stringValue = toStringValue(value);

    if (!stringValue) {
      return;
    }

    entries.push({
      id: `image:${key}`,
      group: getImageGroup(key),
      label: key,
      value: stringValue,
      key,
      scope: "image",
    });
  });

  return entries.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
};

const inspectVideo = async (filePath: string) => {
  const ffprobeBinary = process.env.FFPROBE_PATH || "ffprobe";
  const output = await runCommand(ffprobeBinary, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  const parsed = JSON.parse(output) as {
    format?: { tags?: Record<string, string> };
    streams?: Array<{ index: number; codec_type?: string; tags?: Record<string, string> }>;
  };

  const entries: MetadataEntry[] = [];

  const formatTags = parsed.format?.tags || {};
  Object.entries(formatTags).forEach(([key, value]) => {
    const stringValue = toStringValue(value);
    if (!stringValue) return;
    entries.push({
      id: `format:${key}`,
      group: "Container",
      label: key,
      value: stringValue,
      key,
      scope: "format",
    });
  });

  (parsed.streams || []).forEach((stream, idx) => {
    const streamTags = stream.tags || {};
    const typeLabel = stream.codec_type ? stream.codec_type.toUpperCase() : "STREAM";
    const group = `${typeLabel} Stream ${idx + 1}`;

    Object.entries(streamTags).forEach(([key, value]) => {
      const stringValue = toStringValue(value);
      if (!stringValue) return;
      entries.push({
        id: `stream:${stream.index}:${key}`,
        group,
        label: key,
        value: stringValue,
        key,
        scope: "stream",
        streamIndex: stream.index,
      });
    });
  });

  return entries.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
};

const safeUnlink = async (filePath: string) => {
  try {
    await unlink(filePath);
  } catch {
    // ignore cleanup failures
  }
};

export async function POST(request: Request) {
  let inputPath = "";

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const mode = formData.get("mode") as InspectMode | null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file." }, { status: 400 });
    }

    if (!mode || (mode !== "image" && mode !== "video")) {
      return NextResponse.json({ error: "Missing or invalid mode." }, { status: 400 });
    }

    if (mode === "image" && !isSupportedImage(file)) {
      return NextResponse.json({ error: "Unsupported image format." }, { status: 400 });
    }

    if (mode === "video" && !isSupportedVideo(file)) {
      return NextResponse.json({ error: "Unsupported video format." }, { status: 400 });
    }

    await mkdir(TEMP_DIRECTORY, { recursive: true });

    const extension = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
    inputPath = join(TEMP_DIRECTORY, `${randomUUID()}${extension || ""}`);

    const inputBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, inputBuffer);

    const entries = mode === "image" ? await inspectImage(inputPath) : await inspectVideo(inputPath);

    return NextResponse.json({ entries });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Unable to inspect metadata: ${detail}` }, { status: 500 });
  } finally {
    if (inputPath) {
      await safeUnlink(inputPath);
    }
  }
}
