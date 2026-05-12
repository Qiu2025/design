import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { exiftool } from "exiftool-vendored";
import {
  getOutputFileName,
  isSupportedImageExtension,
  isSupportedImageType,
  isSupportedVideoExtension,
  isSupportedVideoType,
  MAX_VIDEO_BYTES,
} from "@/utils/media";

export const runtime = "nodejs";

const TEMP_DIRECTORY = join(tmpdir(), "snapbox-metadata-remove");

type RemoveMode = "image" | "video";

type SelectedEntry = {
  scope: "image" | "format" | "stream";
  key: string;
  streamIndex?: number;
};

const runCommand = (command: string, args: string[]) => {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let processHandle: ChildProcess;
    try {
      processHandle = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }

    let stderr = "";
    processHandle.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    processHandle.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    processHandle.on("close", (code) => {
      if (!settled) {
        settled = true;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      }
    });
  });
};

const inspectVideoTags = async (filePath: string) => {
  const ffprobeBinary = process.env.FFPROBE_PATH || "ffprobe";
  const output = await new Promise<string>((resolve, reject) => {
    const processHandle = spawn(ffprobeBinary, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);

    let stdout = "";
    let stderr = "";

    processHandle.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
    processHandle.stderr?.on("data", (chunk) => (stderr += chunk.toString()));

    processHandle.on("error", (error) => reject(error));
    processHandle.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `ffprobe exited with code ${code}`));
      }
    });
  });

  return JSON.parse(output) as {
    format?: { tags?: Record<string, string> };
    streams?: Array<{ index: number; tags?: Record<string, string> }>;
  };
};

const safeUnlink = async (filePath: string) => {
  try {
    await unlink(filePath);
  } catch {
    // ignore cleanup failures
  }
};

const removeImageMetadata = async (filePath: string, selected: SelectedEntry[]) => {
  const deleteMap: Record<string, null> = {};

  selected
    .filter((entry) => entry.scope === "image")
    .forEach((entry) => {
      deleteMap[entry.key] = null;
    });

  if (Object.keys(deleteMap).length === 0) {
    return;
  }

  await exiftool.write(filePath, deleteMap, ["-overwrite_original", "-ignoreMinorErrors"]);
};

const removeVideoMetadata = async (inputPath: string, outputPath: string, selected: SelectedEntry[]) => {
  const ffmpegBinary = process.env.FFMPEG_PATH || "ffmpeg";
  const probeData = await inspectVideoTags(inputPath);

  const selectedFormatKeys = new Set(selected.filter((entry) => entry.scope === "format").map((entry) => entry.key));
  const selectedStreamKeys = new Set(
    selected.filter((entry) => entry.scope === "stream").map((entry) => `${entry.streamIndex ?? -1}:${entry.key}`),
  );

  const args = ["-y", "-i", inputPath, "-map", "0", "-map_metadata", "-1", "-map_chapters", "-1", "-c", "copy"];

  const formatTags = probeData.format?.tags || {};
  Object.entries(formatTags).forEach(([key, value]) => {
    if (selectedFormatKeys.has(key)) return;
    args.push("-metadata", `${key}=${value}`);
  });

  (probeData.streams || []).forEach((stream) => {
    const tags = stream.tags || {};
    Object.entries(tags).forEach(([key, value]) => {
      if (selectedStreamKeys.has(`${stream.index}:${key}`)) return;
      args.push(`-metadata:s:${stream.index}`, `${key}=${value}`);
    });
  });

  args.push(outputPath);

  await runCommand(ffmpegBinary, args);
};

export async function POST(request: Request) {
  let inputPath = "";
  let outputPath = "";

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const mode = formData.get("mode") as RemoveMode | null;
    const selectedRaw = formData.get("selected");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file." }, { status: 400 });
    }

    if (!mode || (mode !== "image" && mode !== "video")) {
      return NextResponse.json({ error: "Missing or invalid mode." }, { status: 400 });
    }

    const selected = selectedRaw ? (JSON.parse(String(selectedRaw)) as SelectedEntry[]) : [];

    if (selected.length === 0) {
      return NextResponse.json({ error: "No metadata fields selected." }, { status: 400 });
    }

    if (mode === "image" && !isSupportedImageType(file.type) && !isSupportedImageExtension(file.name)) {
      return NextResponse.json({ error: "Unsupported image format." }, { status: 400 });
    }

    if (mode === "video" && !isSupportedVideoType(file.type) && !isSupportedVideoExtension(file.name)) {
      return NextResponse.json({ error: "Unsupported video format." }, { status: 400 });
    }

    if (mode === "video" && file.size > MAX_VIDEO_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB limit.` },
        { status: 400 },
      );
    }

    await mkdir(TEMP_DIRECTORY, { recursive: true });

    const extension = extname(file.name) || "";
    const uniqueId = randomUUID();
    inputPath = join(TEMP_DIRECTORY, `${uniqueId}-input${extension}`);
    outputPath = join(TEMP_DIRECTORY, `${uniqueId}-output${extension}`);

    const inputBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, inputBuffer);
    await writeFile(outputPath, inputBuffer);

    if (mode === "image") {
      await removeImageMetadata(outputPath, selected);
    } else {
      await removeVideoMetadata(inputPath, outputPath, selected);
    }

    const outputBuffer = await readFile(outputPath);
    const outputName = getOutputFileName(basename(file.name), "clean");

    return new NextResponse(outputBuffer, {
      status: 200,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Content-Disposition": `attachment; filename=\"${outputName}\"`,
        "X-Output-File": outputName,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Unable to remove metadata: ${detail}` }, { status: 500 });
  } finally {
    if (inputPath) await safeUnlink(inputPath);
    if (outputPath) await safeUnlink(outputPath);
  }
}
