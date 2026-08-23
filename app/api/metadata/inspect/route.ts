import { NextResponse } from "next/server";
import { isSupportedVideoExtension, isSupportedVideoType, MAX_SERVER_VIDEO_BYTES } from "@/utils/media";
import { getMetadataContainer, getMetadataSizeRange, logServerMetadataEvent } from "@/utils/server-metadata-logging";
import {
  createServerMetadataTemporaryDirectory,
  receiveServerMetadataUpload,
  releaseServerVideoJob,
  removeServerMetadataTemporaryDirectory,
  ServerMetadataRequestError,
  tryAcquireServerVideoJob,
} from "@/utils/server-metadata-runtime";
import { inspectVideoMetadata, VideoCommandError } from "@/utils/server-video-metadata";

export const runtime = "nodejs";

const REQUEST_OVERHEAD_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_SERVER_VIDEO_BYTES + REQUEST_OVERHEAD_BYTES;

const getErrorCode = (error: unknown) => {
  if (error instanceof ServerMetadataRequestError) return error.code;
  if (error instanceof VideoCommandError && error.kind === "unavailable") return "ffprobe_unavailable";
  if (error instanceof VideoCommandError && error.kind === "timeout") return "timeout";
  if (error instanceof VideoCommandError && error.reason === "container_mismatch") return "container_mismatch";
  if (
    error instanceof VideoCommandError &&
    (error.reason === "invalid_data" || error.reason === "missing_movie_header")
  ) {
    return "invalid_video_data";
  }
  if (error instanceof VideoCommandError && error.reason === "unsupported_container") return "unsupported_container";
  if (error instanceof VideoCommandError && error.reason === "unsupported_structure") return "unsupported_structure";
  return "inspection_failed";
};

export async function POST(request: Request) {
  if (!tryAcquireServerVideoJob()) {
    return NextResponse.json({ error: "The video server is busy. Please try again shortly." }, { status: 503 });
  }

  const startedAt = Date.now();
  let temporaryDirectory = "";
  let fileSize = 0;
  let container = "unknown";

  try {
    temporaryDirectory = await createServerMetadataTemporaryDirectory("inspect");
    const upload = await receiveServerMetadataUpload(request, temporaryDirectory, {
      maximumFileBytes: MAX_SERVER_VIDEO_BYTES,
      maximumRequestBytes: MAX_REQUEST_BYTES,
      selectedField: false,
    });
    fileSize = upload.fileSize;
    container = getMetadataContainer(upload.fileName);

    if (!isSupportedVideoType(upload.mimeType) && !isSupportedVideoExtension(upload.fileName)) {
      return NextResponse.json({ error: "This video container is not supported by the server." }, { status: 400 });
    }

    const { entries } = await inspectVideoMetadata(upload.filePath, "probe", {
      fileName: upload.fileName,
      mimeType: upload.mimeType,
    });
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

    if (errorCode === "request_timeout") {
      return NextResponse.json({ error: "Video upload timed out." }, { status: 408 });
    }

    if (errorCode === "payload_too_large") {
      return NextResponse.json({ error: "Video exceeds the 250 MB server limit." }, { status: 413 });
    }

    if (errorCode === "invalid_content_type") {
      return NextResponse.json({ error: "Expected a multipart video upload." }, { status: 415 });
    }

    if (errorCode === "invalid_request") {
      return NextResponse.json({ error: "Invalid video upload." }, { status: 400 });
    }

    if (errorCode === "container_mismatch") {
      return NextResponse.json(
        { error: "The file extension does not match the detected video container." },
        { status: 422 },
      );
    }

    if (errorCode === "invalid_video_data") {
      return NextResponse.json(
        { error: "The video is invalid or does not match its file extension." },
        { status: 422 },
      );
    }

    if (errorCode === "unsupported_container") {
      return NextResponse.json({ error: "The detected video container is not supported." }, { status: 422 });
    }

    if (errorCode === "unsupported_structure") {
      return NextResponse.json(
        { error: "This video uses a program structure that SnapBox cannot preserve safely." },
        { status: 422 },
      );
    }

    return NextResponse.json({ error: "The server could not inspect this video container." }, { status: 422 });
  } finally {
    releaseServerVideoJob();
    if (temporaryDirectory) await removeServerMetadataTemporaryDirectory(temporaryDirectory);
  }
}
