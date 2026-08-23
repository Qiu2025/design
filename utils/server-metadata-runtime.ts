import "server-only";
import busboy from "busboy";
import { createWriteStream } from "node:fs";
import { chmod, lstat, mkdtemp, open, readdir, rm, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { logServerMetadataEvent } from "@/utils/server-metadata-logging";

const MAX_CONCURRENT_SERVER_VIDEO_JOBS = 3;
const MAX_DOWNLOAD_DURATION_MS = 180_000;
const MAX_DOWNLOAD_CHUNK_BYTES = 64 * 1024;
const MAX_SELECTION_FIELD_BYTES = 256 * 1024;
const MAX_UPLOAD_DURATION_MS = 180_000;
const STALE_TEMPORARY_AGE_MS = 60 * 60 * 1000;
const TEMPORARY_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const TEMPORARY_DIRECTORY_PATTERN = /^snapbox-metadata-(inspect|remove)-[A-Za-z0-9]+$/;
const LEGACY_TEMPORARY_DIRECTORIES = ["snapbox-metadata-inspect", "snapbox-metadata-remove"];
const GLOBAL_STATE_KEY = "__snapboxMetadataServerRuntime";

type RuntimeState = {
  activeJobs: number;
  activeTemporaryDirectories: Set<string>;
  lastTemporarySweepAt: number;
  temporarySweep: Promise<void> | null;
};

type RuntimeGlobal = typeof globalThis & {
  [GLOBAL_STATE_KEY]?: RuntimeState;
};

const runtimeGlobal = globalThis as RuntimeGlobal;
const runtimeState = (runtimeGlobal[GLOBAL_STATE_KEY] ||= {
  activeJobs: 0,
  activeTemporaryDirectories: new Set(),
  lastTemporarySweepAt: 0,
  temporarySweep: null,
});
runtimeState.activeTemporaryDirectories ||= new Set();

export type ServerMetadataRequestErrorCode =
  | "invalid_content_type"
  | "invalid_request"
  | "payload_too_large"
  | "request_timeout";

type UploadOptions = {
  maximumFileBytes: number;
  maximumRequestBytes: number;
  selectedField: boolean;
};

export type ServerMetadataUpload = {
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  selected: string | null;
};

export class ServerMetadataRequestError extends Error {
  readonly code: ServerMetadataRequestErrorCode;

  constructor(code: ServerMetadataRequestErrorCode) {
    super(code);
    this.name = "ServerMetadataRequestError";
    this.code = code;
  }
}

const getErrorCode = (error: unknown) => {
  if (!(error instanceof Error)) return "unknown";
  return (error as NodeJS.ErrnoException).code || error.name;
};

const logTemporaryCleanupError = (error: unknown) => {
  logServerMetadataEvent({
    event: "server_video_temporary_cleanup",
    execution: "on_server",
    result: "error",
    errorCode: getErrorCode(error),
  });
};

const removeStaleTemporaryDirectory = async (directoryPath: string, cutoff: number) => {
  try {
    const details = await lstat(directoryPath);
    if (!details.isDirectory() || details.mtimeMs >= cutoff) return;
    await rm(directoryPath, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") logTemporaryCleanupError(error);
  }
};

const removeStaleLegacyFiles = async (directoryPath: string, cutoff: number) => {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile()) return;
        const filePath = join(directoryPath, entry.name);

        try {
          const details = await lstat(filePath);
          if (details.mtimeMs < cutoff) await unlink(filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") logTemporaryCleanupError(error);
        }
      }),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") logTemporaryCleanupError(error);
  }
};

const sweepStaleTemporaryFiles = async () => {
  const temporaryRoot = tmpdir();
  const cutoff = Date.now() - STALE_TEMPORARY_AGE_MS;

  try {
    const entries = await readdir(temporaryRoot, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && TEMPORARY_DIRECTORY_PATTERN.test(entry.name))
        .filter((entry) => !runtimeState.activeTemporaryDirectories.has(resolve(temporaryRoot, entry.name)))
        .map((entry) => removeStaleTemporaryDirectory(join(temporaryRoot, entry.name), cutoff)),
    );
  } catch (error) {
    logTemporaryCleanupError(error);
  }

  await Promise.all(
    LEGACY_TEMPORARY_DIRECTORIES.map((directory) =>
      removeStaleLegacyFiles(join(/* turbopackIgnore: true */ temporaryRoot, directory), cutoff),
    ),
  );
};

const ensureTemporarySweep = async () => {
  if (Date.now() - runtimeState.lastTemporarySweepAt < TEMPORARY_SWEEP_INTERVAL_MS) return;

  if (!runtimeState.temporarySweep) {
    runtimeState.temporarySweep = sweepStaleTemporaryFiles().finally(() => {
      runtimeState.lastTemporarySweepAt = Date.now();
      runtimeState.temporarySweep = null;
    });
  }

  await runtimeState.temporarySweep;
};

export const tryAcquireServerVideoJob = () => {
  if (runtimeState.activeJobs >= MAX_CONCURRENT_SERVER_VIDEO_JOBS) return false;
  runtimeState.activeJobs += 1;
  return true;
};

export const releaseServerVideoJob = () => {
  runtimeState.activeJobs = Math.max(0, runtimeState.activeJobs - 1);
};

const parseDeclaredLength = (request: Request, maximumBytes: number) => {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader === null) return;

  const normalizedLength = contentLengthHeader.trim();
  if (!/^\d+$/.test(normalizedLength)) throw new ServerMetadataRequestError("invalid_request");

  const declaredBytes = Number(normalizedLength);
  if (!Number.isSafeInteger(declaredBytes)) throw new ServerMetadataRequestError("invalid_request");
  if (declaredBytes > maximumBytes) throw new ServerMetadataRequestError("payload_too_large");
};

const createByteLimiter = (maximumBytes: number, onBytes?: (bytes: number) => void) => {
  let receivedBytes = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.byteLength;
      onBytes?.(receivedBytes);

      if (receivedBytes > maximumBytes) {
        callback(new ServerMetadataRequestError("payload_too_large"));
        return;
      }

      callback(null, chunk);
    },
  });
};

export const receiveServerMetadataUpload = async (
  request: Request,
  temporaryDirectory: string,
  options: UploadOptions,
): Promise<ServerMetadataUpload> => {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "multipart/form-data") {
    throw new ServerMetadataRequestError("invalid_content_type");
  }

  parseDeclaredLength(request, options.maximumRequestBytes);
  if (!request.body) throw new ServerMetadataRequestError("invalid_request");

  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: Object.fromEntries(request.headers),
      limits: {
        fieldNameSize: 64,
        fields: options.selectedField ? 1 : 0,
        fieldSize: options.selectedField ? MAX_SELECTION_FIELD_BYTES : 0,
        files: 1,
        // The custom file transform enforces the inclusive application limit.
        fileSize: options.maximumFileBytes + 1,
        headerPairs: 32,
        parts: options.selectedField ? 3 : 2,
      },
    });
  } catch {
    throw new ServerMetadataRequestError("invalid_request");
  }

  let fileName = "";
  let filePath = "";
  let fileSize = 0;
  let fileSeen = false;
  let mimeType = "";
  let selected: string | null = null;
  let uploadError: Error | null = null;
  let resolveFile: (() => void) | null = null;
  let rejectFile: ((error: Error) => void) | null = null;
  const fileCompleted = new Promise<void>((resolve, reject) => {
    resolveFile = resolve;
    rejectFile = reject;
  });

  const failUpload = (error: Error) => {
    if (uploadError) return;
    uploadError = error;
    rejectFile?.(error);
    parser.destroy(error);
  };

  parser.on("file", (fieldName, file, info) => {
    if (fieldName !== "file" || fileSeen) {
      file.resume();
      failUpload(new ServerMetadataRequestError("invalid_request"));
      return;
    }

    fileSeen = true;
    fileName = basename(info.filename || "video");
    mimeType = info.mimeType;
    const extension = extname(fileName).toLowerCase();
    const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : "";
    filePath = join(temporaryDirectory, `input${safeExtension}`);
    const fileLimiter = createByteLimiter(options.maximumFileBytes, (bytes) => {
      fileSize = bytes;
    });
    const output = createWriteStream(filePath, { flags: "wx", mode: 0o600 });

    file.on("limit", () => failUpload(new ServerMetadataRequestError("payload_too_large")));
    void pipeline(file, fileLimiter, output)
      .then(() => resolveFile?.())
      .catch((error: Error) => failUpload(error));
  });

  parser.on("field", (fieldName, value, info) => {
    if (!options.selectedField || fieldName !== "selected" || selected !== null || info.valueTruncated) {
      failUpload(new ServerMetadataRequestError("invalid_request"));
      return;
    }
    selected = value;
  });
  parser.on("filesLimit", () => failUpload(new ServerMetadataRequestError("invalid_request")));
  parser.on("fieldsLimit", () => failUpload(new ServerMetadataRequestError("invalid_request")));
  parser.on("partsLimit", () => failUpload(new ServerMetadataRequestError("invalid_request")));
  parser.on("finish", () => {
    if (!fileSeen) failUpload(new ServerMetadataRequestError("invalid_request"));
  });

  const requestStream = Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>);
  const requestLimiter = createByteLimiter(options.maximumRequestBytes);
  const requestCompleted = pipeline(requestStream, requestLimiter, parser).catch((error: Error) => {
    const requestError =
      error instanceof ServerMetadataRequestError ? error : new ServerMetadataRequestError("invalid_request");
    failUpload(requestError);
    throw requestError;
  });
  const uploadTimeout = setTimeout(() => {
    const error = new ServerMetadataRequestError("request_timeout");
    failUpload(error);
    requestStream.destroy(error);
  }, MAX_UPLOAD_DURATION_MS);
  uploadTimeout.unref();

  const results = await Promise.allSettled([requestCompleted, fileCompleted]);
  clearTimeout(uploadTimeout);
  const failedResult = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (uploadError) throw uploadError;
  if (failedResult?.reason instanceof ServerMetadataRequestError) throw failedResult.reason;
  if (failedResult) {
    throw new ServerMetadataRequestError("invalid_request");
  }

  if (!fileName || !filePath || fileSize > options.maximumFileBytes) {
    throw new ServerMetadataRequestError("invalid_request");
  }

  return { fileName, filePath, fileSize, mimeType, selected };
};

export const createServerMetadataTemporaryDirectory = async (operation: "inspect" | "remove") => {
  await ensureTemporarySweep();
  const directoryPath = await mkdtemp(join(tmpdir(), `snapbox-metadata-${operation}-`));
  await chmod(directoryPath, 0o700);
  runtimeState.activeTemporaryDirectories.add(resolve(directoryPath));
  return directoryPath;
};

export const removeServerMetadataTemporaryDirectory = async (directoryPath: string) => {
  const resolvedPath = resolve(directoryPath);
  const temporaryRoot = resolve(tmpdir());
  const isExpectedDirectory =
    dirname(resolvedPath) === temporaryRoot && TEMPORARY_DIRECTORY_PATTERN.test(basename(resolvedPath));

  if (!isExpectedDirectory) {
    logTemporaryCleanupError(new Error("invalid_temporary_directory"));
    return;
  }

  try {
    await rm(resolvedPath, { recursive: true, force: true });
  } catch (error) {
    logTemporaryCleanupError(error);
  } finally {
    runtimeState.activeTemporaryDirectories.delete(resolvedPath);
  }
};

export const createServerMetadataDownloadStream = (
  filePath: string,
  onFinished: () => Promise<void>,
  abortSignal?: AbortSignal,
): ReadableStream<Uint8Array> => {
  const fileHandle = open(filePath, "r");
  let abortHandler: (() => void) | null = null;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let controllerSettled = false;
  let finished = false;
  let cleanup: Promise<void> | null = null;
  let position = 0;
  let downloadTimeout: ReturnType<typeof setTimeout> | null = null;
  const finish = () => {
    if (abortHandler && abortSignal) {
      abortSignal.removeEventListener("abort", abortHandler);
      abortHandler = null;
    }
    if (downloadTimeout) {
      clearTimeout(downloadTimeout);
      downloadTimeout = null;
    }
    return (cleanup ||= (async () => {
      const handle = await fileHandle.catch(() => null);
      if (handle) await handle.close().catch(logTemporaryCleanupError);
      await onFinished();
    })());
  };
  downloadTimeout = setTimeout(() => {
    if (finished) return;
    finished = true;
    void (async () => {
      try {
        await finish();
      } finally {
        if (!controllerSettled) {
          controllerSettled = true;
          controller?.error(new Error("metadata_download_timeout"));
        }
      }
    })().catch(logTemporaryCleanupError);
  }, MAX_DOWNLOAD_DURATION_MS);
  downloadTimeout.unref();

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
    async pull(streamController) {
      try {
        const handle = await fileHandle;
        if (finished) return;
        const buffer = Buffer.allocUnsafe(MAX_DOWNLOAD_CHUNK_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
        if (finished) return;
        if (bytesRead === 0) {
          finished = true;
          await finish();
          if (!controllerSettled) {
            controllerSettled = true;
            streamController.close();
          }
          return;
        }
        position += bytesRead;
        streamController.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead));
      } catch (error) {
        finished = true;
        await finish();
        if (!controllerSettled) {
          controllerSettled = true;
          streamController.error(error);
        }
      }
    },
    async cancel() {
      finished = true;
      controllerSettled = true;
      await finish();
    },
  });

  abortHandler = () => {
    if (finished) return;
    finished = true;
    void (async () => {
      try {
        await finish();
      } finally {
        if (!controllerSettled) {
          controllerSettled = true;
          controller?.error(new Error("metadata_download_cancelled"));
        }
      }
    })().catch(logTemporaryCleanupError);
  };
  abortSignal?.addEventListener("abort", abortHandler, { once: true });
  if (abortSignal?.aborted) abortHandler();

  return stream;
};
