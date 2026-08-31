import { basename, join } from "node:path";
import { NextResponse } from "next/server";
import {
  getOutputFileName,
  getExtensionFromFileName,
  isSupportedVideoExtension,
  isSupportedVideoType,
  MAX_SERVER_VIDEO_BYTES,
} from "@/utils/media";
import { metadataEntryMatches, type SelectedMetadataEntry } from "@/utils/metadata";
import { getMetadataContainer, getMetadataSizeRange, logServerMetadataEvent } from "@/utils/server-metadata-logging";
import {
  createServerMetadataDownloadStream,
  createServerMetadataTemporaryDirectory,
  receiveServerMetadataUpload,
  releaseServerVideoJob,
  removeServerMetadataTemporaryDirectory,
  ServerMetadataRequestError,
  tryAcquireServerVideoJob,
} from "@/utils/server-metadata-runtime";
import {
  findUnresolvedMetadata,
  inspectVideoMetadata,
  removeVideoMetadata,
  VideoCommandError,
} from "@/utils/server-video-metadata";

export const runtime = "nodejs";

const REQUEST_OVERHEAD_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_SERVER_VIDEO_BYTES + REQUEST_OVERHEAD_BYTES;
const MAX_SELECTIONS = 500;

const isSelectedEntry = (value: unknown): value is SelectedMetadataEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  const validScope = entry.scope === "format" || entry.scope === "stream" || entry.scope === "chapter";
  const validKey = typeof entry.key === "string" && entry.key.length > 0 && entry.key.length <= 128;
  const validStream =
    entry.streamIndex === undefined || (Number.isInteger(entry.streamIndex) && Number(entry.streamIndex) >= 0);
  const validChapter =
    entry.chapterIndex === undefined || (Number.isInteger(entry.chapterIndex) && Number(entry.chapterIndex) >= 0);
  return validScope && validKey && validStream && validChapter;
};

const parseSelection = (raw: string | null) => {
  if (typeof raw !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid_selection");
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_SELECTIONS || !parsed.every(isSelectedEntry)) {
    throw new Error("invalid_selection");
  }
  return parsed;
};

const getErrorCode = (error: unknown) => {
  if (error instanceof ServerMetadataRequestError) return error.code;
  if (error instanceof Error && error.message === "invalid_selection") return "invalid_selection";
  if (error instanceof VideoCommandError && error.kind === "unavailable") return "ffmpeg_unavailable";
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
  return "processing_failed";
};

const encodeVerification = (unresolved: SelectedMetadataEntry[]) => {
  return Buffer.from(JSON.stringify(unresolved.slice(0, MAX_SELECTIONS))).toString("base64url");
};

export async function POST(request: Request) {
  if (!tryAcquireServerVideoJob()) {
    return NextResponse.json({ error: "The video server is busy. Please try again shortly." }, { status: 503 });
  }

  const startedAt = Date.now();
  let temporaryDirectory = "";
  let outputPath = "";
  let fileSize = 0;
  let container = "unknown";
  let cleanupDeferredToDownload = false;
  let jobReleased = false;
  let resourceCleanup: Promise<void> | null = null;
  const releaseJob = () => {
    if (jobReleased) return;
    jobReleased = true;
    releaseServerVideoJob();
  };
  const finishResources = () =>
    (resourceCleanup ||= (async () => {
      try {
        if (temporaryDirectory) await removeServerMetadataTemporaryDirectory(temporaryDirectory);
      } finally {
        releaseJob();
      }
    })());

  try {
    temporaryDirectory = await createServerMetadataTemporaryDirectory("remove");
    const upload = await receiveServerMetadataUpload(request, temporaryDirectory, {
      maximumFileBytes: MAX_SERVER_VIDEO_BYTES,
      maximumRequestBytes: MAX_REQUEST_BYTES,
      selectedField: true,
    });
    fileSize = upload.fileSize;
    container = getMetadataContainer(upload.fileName);

    if (!isSupportedVideoType(upload.mimeType) && !isSupportedVideoExtension(upload.fileName)) {
      return NextResponse.json({ error: "This video container is not supported by the server." }, { status: 400 });
    }

    const requestedSelection = parseSelection(upload.selected);
    if (requestedSelection.length === 0) {
      return NextResponse.json({ error: "No metadata fields were selected." }, { status: 400 });
    }

    const beforeInspection = await inspectVideoMetadata(upload.filePath, "probe_before", {
      fileName: upload.fileName,
      mimeType: upload.mimeType,
    });
    const before = beforeInspection.entries;
    outputPath = join(temporaryDirectory, `output.${beforeInspection.container.extension}`);
    const allowedSelection = requestedSelection.filter((requested) =>
      before.some((entry) => !entry.protected && metadataEntryMatches(entry, requested)),
    );

    if (allowedSelection.length === 0) {
      return NextResponse.json({ error: "The selected metadata is not removable." }, { status: 400 });
    }

    if (allowedSelection.length !== requestedSelection.length) {
      return NextResponse.json(
        { error: "The metadata changed. Inspect the video again before cleaning it." },
        { status: 409 },
      );
    }

    await removeVideoMetadata(
      upload.filePath,
      outputPath,
      before,
      allowedSelection,
      beforeInspection.container.demuxer,
      beforeInspection.container.muxer,
    );
    const { entries: after } = await inspectVideoMetadata(outputPath, "probe_after");
    const unresolvedEntries = findUnresolvedMetadata(before, after, allowedSelection);
    const unresolved = unresolvedEntries.map(({ scope, key, streamIndex, chapterIndex }) => ({
      scope,
      key,
      streamIndex,
      chapterIndex,
    }));
    const requestedOutputName = getOutputFileName(basename(upload.fileName), "clean");
    const outputName = getExtensionFromFileName(requestedOutputName)
      ? requestedOutputName
      : `${requestedOutputName.replace(/\.+$/, "")}.${beforeInspection.container.extension}`;

    logServerMetadataEvent({
      event: "server_video_clean",
      execution: "on_server",
      container,
      sizeRange: getMetadataSizeRange(fileSize),
      durationMs: Date.now() - startedAt,
      result: unresolved.length === 0 ? "verified" : "unresolved",
    });

    const outputStream = createServerMetadataDownloadStream(outputPath, finishResources, request.signal);
    const response = new NextResponse(outputStream, {
      status: 200,
      headers: {
        "Content-Type": beforeInspection.container.mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(outputName)}`,
        "X-Output-File": encodeURIComponent(outputName),
        "X-Metadata-Verification": encodeVerification(unresolved),
        "X-Metadata-Removed-Count": String(allowedSelection.length - unresolved.length),
        "X-Metadata-Unresolved-Count": String(unresolved.length),
        "Cache-Control": "no-store",
      },
    });
    cleanupDeferredToDownload = true;
    return response;
  } catch (error) {
    const errorCode = getErrorCode(error);
    const commandError = error instanceof VideoCommandError ? error : null;

    logServerMetadataEvent({
      event: "server_video_clean",
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

    if (errorCode === "invalid_selection") {
      return NextResponse.json({ error: "Invalid metadata selection." }, { status: 400 });
    }

    if (errorCode === "ffmpeg_unavailable") {
      return NextResponse.json({ error: "Video processing is not available on this server." }, { status: 503 });
    }

    if (errorCode === "timeout") {
      return NextResponse.json({ error: "Video processing timed out." }, { status: 504 });
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
        { error: "This video uses a program structure that Design cannot preserve safely." },
        { status: 422 },
      );
    }

    return NextResponse.json({ error: "The video could not be cleaned without converting it." }, { status: 422 });
  } finally {
    if (!cleanupDeferredToDownload) await finishResources();
  }
}
