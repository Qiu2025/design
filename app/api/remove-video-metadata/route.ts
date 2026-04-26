import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { unlink, writeFile, mkdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { getOutputFileName, isSupportedVideoExtension, isSupportedVideoType, MAX_VIDEO_BYTES } from "@/utils/media";

export const runtime = "nodejs";

const TEMP_DIRECTORY = join(tmpdir(), "ray-so-metadata-remover");

/** Maximum time in ms before ffmpeg is killed. */
const FFMPEG_TIMEOUT_MS = 120_000;

/** Maximum concurrent video processing jobs. */
const MAX_CONCURRENT_JOBS = 3;

let activeJobs = 0;

const runFfmpeg = (inputPath: string, outputPath: string): Promise<void> => {
  const ffmpegBinary = process.env.FFMPEG_PATH || "ffmpeg";

  const args = [
    "-y",
    "-i",
    inputPath,
    "-map",
    "0",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-c",
    "copy",
    outputPath,
  ];

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let processHandle: ChildProcess;

    try {
      processHandle = spawn(ffmpegBinary, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (spawnError) {
      reject(spawnError);
      return;
    }

    let stderr = "";

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        processHandle.kill("SIGKILL");
        reject(new Error("Processing timed out. The file may be too large or complex."));
      }
    }, FFMPEG_TIMEOUT_MS);

    processHandle.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    processHandle.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });

    processHandle.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);

        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      }
    });
  });
};

const safeUnlink = async (filePath: string) => {
  try {
    await unlink(filePath);
  } catch {
    // Ignore cleanup failures.
  }
};

export async function POST(request: Request) {
  // Concurrency guard
  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    return NextResponse.json(
      { error: "Server is busy processing other videos. Please try again in a moment." },
      { status: 503 },
    );
  }

  let inputPath = "";
  let outputPath = "";

  activeJobs++;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing video file." }, { status: 400 });
    }

    const fileType = file.type;
    const fileName = file.name || "video";

    if (!isSupportedVideoType(fileType) && !isSupportedVideoExtension(fileName)) {
      return NextResponse.json({ error: "Unsupported video format." }, { status: 400 });
    }

    if (file.size > MAX_VIDEO_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB limit.` },
        { status: 400 },
      );
    }

    const extension = extname(fileName) || ".mp4";
    const uniqueId = randomUUID();

    await mkdir(TEMP_DIRECTORY, { recursive: true });

    inputPath = join(TEMP_DIRECTORY, `${uniqueId}-input${extension}`);
    outputPath = join(TEMP_DIRECTORY, `${uniqueId}-output${extension}`);

    const inputBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, inputBuffer);

    await runFfmpeg(inputPath, outputPath);

    const outputBuffer = await readFile(outputPath);
    const outputName = getOutputFileName(basename(fileName), "clean");

    return new NextResponse(outputBuffer, {
      status: 200,
      headers: {
        "Content-Type": fileType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${outputName}"`,
        "X-Output-File": outputName,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";

    if (detail.includes("ENOENT") || detail.includes("not recognized")) {
      return NextResponse.json(
        { error: "ffmpeg is not available on the server. Install ffmpeg or set FFMPEG_PATH." },
        { status: 500 },
      );
    }

    if (detail.includes("timed out")) {
      return NextResponse.json({ error: detail }, { status: 504 });
    }

    return NextResponse.json({ error: `Could not process video: ${detail}` }, { status: 500 });
  } finally {
    activeJobs--;

    if (inputPath) {
      await safeUnlink(inputPath);
    }

    if (outputPath) {
      await safeUnlink(outputPath);
    }
  }
}
