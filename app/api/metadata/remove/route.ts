import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { NextResponse } from "next/server";
import {
  getOutputFileName,
  isSupportedVideoExtension,
  isSupportedVideoType,
  MAX_SERVER_VIDEO_BYTES,
} from "@/utils/media";
import { metadataEntryMatches, type SelectedMetadataEntry } from "@/utils/metadata";
import { findUnresolvedMetadata, inspectVideoMetadata, removeVideoMetadata } from "@/utils/server-video-metadata";

export const runtime = "nodejs";

const TEMP_DIRECTORY = join(tmpdir(), "snapbox-metadata-remove");
const REQUEST_OVERHEAD_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT_JOBS = 3;
const MAX_SELECTIONS = 500;

let activeJobs = 0;

const safeUnlink = async (filePath: string) => {
  try {
    await unlink(filePath);
  } catch {
    // The response must not be held up by an already-removed temporary file.
  }
};

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

const parseSelection = (raw: FormDataEntryValue | null) => {
  if (typeof raw !== "string") return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > MAX_SELECTIONS || !parsed.every(isSelectedEntry)) {
    throw new Error("invalid_selection");
  }
  return parsed;
};

const getSizeBucket = (bytes: number) => {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 10) return "under_10_mb";
  if (megabytes < 50) return "10_50_mb";
  if (megabytes < 100) return "50_100_mb";
  return "100_250_mb";
};

const getContainer = (fileName: string) => extname(fileName).slice(1).toLowerCase() || "unknown";

const logMetric = (metric: Record<string, string | number>) => {
  console.info("[metadata]", JSON.stringify(metric));
};

const getErrorCode = (detail: string) => {
  if (detail === "invalid_selection") return "invalid_selection";
  if (detail.includes("ENOENT") || detail.includes("not found")) return "ffmpeg_unavailable";
  if (detail.includes("timed out")) return "timeout";
  return "processing_failed";
};

const encodeVerification = (unresolved: SelectedMetadataEntry[]) => {
  return Buffer.from(JSON.stringify(unresolved.slice(0, MAX_SELECTIONS))).toString("base64url");
};

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);

  if (contentLength > MAX_SERVER_VIDEO_BYTES + REQUEST_OVERHEAD_BYTES) {
    return NextResponse.json({ error: "Video exceeds the 250 MB server limit." }, { status: 413 });
  }

  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    return NextResponse.json({ error: "The video server is busy. Please try again shortly." }, { status: 503 });
  }

  const startedAt = Date.now();
  let inputPath = "";
  let outputPath = "";
  let fileSize = 0;
  let container = "unknown";
  activeJobs += 1;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing video file." }, { status: 400 });
    }

    fileSize = file.size;
    container = getContainer(file.name);

    if (!isSupportedVideoType(file.type) && !isSupportedVideoExtension(file.name)) {
      return NextResponse.json({ error: "This video container is not supported by the server." }, { status: 400 });
    }

    if (file.size > MAX_SERVER_VIDEO_BYTES) {
      return NextResponse.json({ error: "Video exceeds the 250 MB server limit." }, { status: 413 });
    }

    const requestedSelection = parseSelection(formData.get("selected"));
    if (requestedSelection.length === 0) {
      return NextResponse.json({ error: "No metadata fields were selected." }, { status: 400 });
    }

    await mkdir(TEMP_DIRECTORY, { recursive: true });
    const extension = extname(file.name);
    const operationId = randomUUID();
    inputPath = join(TEMP_DIRECTORY, `${operationId}-input${extension}`);
    outputPath = join(TEMP_DIRECTORY, `${operationId}-output${extension}`);
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

    const before = await inspectVideoMetadata(inputPath);
    const allowedSelection = requestedSelection.filter((requested) =>
      before.some((entry) => !entry.protected && metadataEntryMatches(entry, requested)),
    );

    if (allowedSelection.length === 0) {
      return NextResponse.json({ error: "The selected metadata is not removable." }, { status: 400 });
    }

    await removeVideoMetadata(inputPath, outputPath, before, allowedSelection);
    const after = await inspectVideoMetadata(outputPath);
    const unresolvedEntries = findUnresolvedMetadata(before, after, allowedSelection);
    const unresolved = unresolvedEntries.map(({ scope, key, streamIndex, chapterIndex }) => ({
      scope,
      key,
      streamIndex,
      chapterIndex,
    }));
    const outputBuffer = await readFile(outputPath);
    const outputName = getOutputFileName(basename(file.name), "clean");

    logMetric({
      event: "server_video_clean",
      container,
      sizeRange: getSizeBucket(fileSize),
      durationMs: Date.now() - startedAt,
      result: unresolved.length === 0 ? "verified" : "unresolved",
    });

    return new NextResponse(outputBuffer, {
      status: 200,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(outputName)}`,
        "X-Output-File": encodeURIComponent(outputName),
        "X-Metadata-Verification": encodeVerification(unresolved),
        "X-Metadata-Removed-Count": String(allowedSelection.length - unresolved.length),
        "X-Metadata-Unresolved-Count": String(unresolved.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    const errorCode = getErrorCode(detail);

    logMetric({
      event: "server_video_clean",
      container,
      sizeRange: getSizeBucket(fileSize),
      durationMs: Date.now() - startedAt,
      result: "error",
      errorCode,
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

    return NextResponse.json({ error: "The video could not be cleaned without converting it." }, { status: 422 });
  } finally {
    activeJobs -= 1;
    if (inputPath) await safeUnlink(inputPath);
    if (outputPath) await safeUnlink(outputPath);
  }
}
