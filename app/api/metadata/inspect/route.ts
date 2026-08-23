import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { NextResponse } from "next/server";
import { isSupportedVideoExtension, isSupportedVideoType, MAX_SERVER_VIDEO_BYTES } from "@/utils/media";
import { getMetadataContainer, getMetadataSizeRange, logServerMetadataEvent } from "@/utils/server-metadata-logging";
import { inspectVideoMetadata, VideoCommandError } from "@/utils/server-video-metadata";

export const runtime = "nodejs";

const TEMP_DIRECTORY = join(tmpdir(), "snapbox-metadata-inspect");
const REQUEST_OVERHEAD_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT_INSPECTIONS = 3;

let activeInspections = 0;

const safeUnlink = async (filePath: string) => {
  try {
    await unlink(filePath);
  } catch {
    // The response must not be held up by an already-removed temporary file.
  }
};

const getErrorCode = (error: unknown) => {
  if (error instanceof VideoCommandError && error.kind === "unavailable") return "ffprobe_unavailable";
  if (error instanceof VideoCommandError && error.kind === "timeout") return "timeout";
  return "inspection_failed";
};

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);

  if (contentLength > MAX_SERVER_VIDEO_BYTES + REQUEST_OVERHEAD_BYTES) {
    return NextResponse.json({ error: "Video exceeds the 250 MB server limit." }, { status: 413 });
  }

  if (activeInspections >= MAX_CONCURRENT_INSPECTIONS) {
    return NextResponse.json({ error: "The video server is busy. Please try again shortly." }, { status: 503 });
  }

  const startedAt = Date.now();
  let inputPath = "";
  let fileSize = 0;
  let container = "unknown";
  activeInspections += 1;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing video file." }, { status: 400 });
    }

    fileSize = file.size;
    container = getMetadataContainer(file.name);

    if (!isSupportedVideoType(file.type) && !isSupportedVideoExtension(file.name)) {
      return NextResponse.json({ error: "This video container is not supported by the server." }, { status: 400 });
    }

    if (file.size > MAX_SERVER_VIDEO_BYTES) {
      return NextResponse.json({ error: "Video exceeds the 250 MB server limit." }, { status: 413 });
    }

    await mkdir(TEMP_DIRECTORY, { recursive: true });
    inputPath = join(TEMP_DIRECTORY, `${randomUUID()}${extname(file.name)}`);
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

    const entries = await inspectVideoMetadata(inputPath);
    logServerMetadataEvent({
      event: "server_video_inspect",
      execution: "on_server",
      container,
      sizeRange: getMetadataSizeRange(fileSize),
      durationMs: Date.now() - startedAt,
      result: "success",
    });

    return NextResponse.json({ entries }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const errorCode = getErrorCode(error);
    const commandError = error instanceof VideoCommandError ? error : null;

    logServerMetadataEvent({
      event: "server_video_inspect",
      execution: "on_server",
      container,
      sizeRange: getMetadataSizeRange(fileSize),
      durationMs: Date.now() - startedAt,
      result: "error",
      errorCode,
      stage: commandError?.stage || "request",
      ...(commandError ? { tool: commandError.tool } : {}),
      ...(commandError ? { reason: commandError.reason } : {}),
      ...(commandError?.exitCode === undefined ? {} : { exitCode: commandError.exitCode }),
    });

    if (errorCode === "ffprobe_unavailable") {
      return NextResponse.json({ error: "Video inspection is not available on this server." }, { status: 503 });
    }

    if (errorCode === "timeout") {
      return NextResponse.json({ error: "Video inspection timed out." }, { status: 504 });
    }

    return NextResponse.json({ error: "The server could not inspect this video container." }, { status: 422 });
  } finally {
    activeInspections -= 1;
    if (inputPath) await safeUnlink(inputPath);
  }
}
