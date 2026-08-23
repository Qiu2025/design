import { getOutputFileName, isSupportedImageExtension, isSupportedImageType } from "@/utils/media";
import {
  buildVerificationReport,
  classifyMetadata,
  formatMetadataValue,
  type MetadataEntry,
  type VerificationReport,
} from "@/utils/metadata";

const EXIFTOOL_ASSET_URL = "/api/metadata/assets/zeroperl.wasm";
const CORE_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const OPTIONAL_IMAGE_EXTENSIONS = new Set(["gif", "bmp", "tif", "tiff", "svg"]);
const NON_EMBEDDED_GROUPS = new Set(["System", "File", "ExifTool", "Composite"]);
const PNG_TEXT_CHUNKS = new Set(["tEXt", "zTXt", "iTXt"]);

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const getExtension = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex === -1 ? "" : fileName.slice(dotIndex + 1).toLowerCase();
};

const getImageFormat = (file: File) => {
  const extension = getExtension(file.name);
  if (extension) return extension;

  return (
    {
      "image/jpeg": "jpeg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/bmp": "bmp",
      "image/tiff": "tiff",
      "image/svg+xml": "svg",
    }[file.type] || ""
  );
};

const getImageMimeType = (file: File) => {
  if (file.type) return file.type;

  const extension = getExtension(file.name);
  return (
    {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      bmp: "image/bmp",
      tif: "image/tiff",
      tiff: "image/tiff",
      svg: "image/svg+xml",
    }[extension] || "application/octet-stream"
  );
};

const exiftoolFetch = (...args: unknown[]) => {
  const [input, init] = args as [RequestInfo | URL, RequestInit | undefined];
  const requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  if (requestedUrl.endsWith("zeroperl.wasm")) {
    return fetch(EXIFTOOL_ASSET_URL, init);
  }

  return fetch(input, init);
};

const parseExiftoolJson = (raw: string) => JSON.parse(raw) as Array<Record<string, unknown>>;

const createImageEntry = (qualifiedKey: string, value: unknown): MetadataEntry | null => {
  const separatorIndex = qualifiedKey.indexOf(":");
  if (separatorIndex === -1) return null;

  const sourceGroup = qualifiedKey.slice(0, separatorIndex);
  const key = qualifiedKey.slice(separatorIndex + 1);
  const stringValue = formatMetadataValue(value);

  if (!stringValue || NON_EMBEDDED_GROUPS.has(sourceGroup)) return null;

  const classification = classifyMetadata(sourceGroup, key, "image");

  return {
    id: `image:${qualifiedKey}`,
    group: classification.group,
    label: key,
    sourceLabel: sourceGroup || "Image",
    value: stringValue,
    key: qualifiedKey,
    scope: "image",
    sensitivity: classification.sensitivity,
    protected: classification.protected,
    protectionReason: classification.protectionReason,
  };
};

const readPngKeyword = (type: string, data: Uint8Array) => {
  if (!PNG_TEXT_CHUNKS.has(type)) return null;
  const nullIndex = data.indexOf(0);
  if (nullIndex <= 0) return null;
  return new TextDecoder("latin1").decode(data.slice(0, nullIndex));
};

const stripSelectedPngTextChunks = (buffer: ArrayBuffer, selected: MetadataEntry[]) => {
  const bytes = new Uint8Array(buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];

  if (bytes.length < 8 || !signature.every((value, index) => bytes[index] === value)) {
    return buffer;
  }

  const selectedPngKeys = new Set(
    selected
      .filter((entry) => entry.key.startsWith("PNG:") && !entry.protected)
      .map((entry) => normalize(entry.key.slice(entry.key.indexOf(":") + 1))),
  );

  if (selectedPngKeys.size === 0) return buffer;

  const chunks: Uint8Array[] = [bytes.slice(0, 8)];
  const view = new DataView(buffer);
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const end = offset + 12 + length;
    if (end > bytes.length) return buffer;

    const type = new TextDecoder("ascii").decode(bytes.slice(offset + 4, offset + 8));
    const data = bytes.slice(offset + 8, offset + 8 + length);
    const keyword = readPngKeyword(type, data);
    const shouldRemove = keyword ? selectedPngKeys.has(normalize(keyword)) : false;

    if (!shouldRemove) chunks.push(bytes.slice(offset, end));
    offset = end;

    if (type === "IEND") break;
  }

  const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let outputOffset = 0;

  chunks.forEach((chunk) => {
    output.set(chunk, outputOffset);
    outputOffset += chunk.byteLength;
  });

  return output.buffer;
};

export const getLocalImageSupport = (file: File) => {
  const extension = getImageFormat(file);
  const isRecognized = isSupportedImageType(file.type) || isSupportedImageExtension(file.name);

  if (!isRecognized) {
    return { supported: false, guaranteed: false, reason: "This image format is not supported." };
  }

  if (CORE_IMAGE_EXTENSIONS.has(extension)) {
    return { supported: true, guaranteed: true, reason: null };
  }

  if (OPTIONAL_IMAGE_EXTENSIONS.has(extension)) {
    return {
      supported: true,
      guaranteed: false,
      reason: "SnapBox will only export this format if it can preserve its original behavior.",
    };
  }

  return { supported: false, guaranteed: false, reason: "This image format is not supported locally." };
};

export const inspectLocalImage = async (file: File): Promise<MetadataEntry[]> => {
  const support = getLocalImageSupport(file);
  if (!support.supported) throw new Error(support.reason || "Unsupported image format.");

  const { parseMetadata } = await import("@uswriting/exiftool");
  const result = await parseMetadata(file, {
    args: ["-json", "-G1", "-s", "-duplicates", "-api", "LargeFileSupport=1"],
    fetch: exiftoolFetch,
    transform: parseExiftoolJson,
  });

  if (!result.success) throw new Error(result.error || "ExifTool could not inspect this image.");

  const tags = result.data[0] || {};
  return Object.entries(tags)
    .map(([key, value]) => createImageEntry(key, value))
    .filter((entry): entry is MetadataEntry => Boolean(entry))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
};

export type LocalImageCleanResult = {
  blob: Blob;
  fileName: string;
  report: VerificationReport;
};

export const cleanLocalImage = async (
  file: File,
  entries: MetadataEntry[],
  selectedIds: Set<string>,
): Promise<LocalImageCleanResult> => {
  const selected = entries.filter((entry) => selectedIds.has(entry.id) && !entry.protected);
  if (selected.length === 0) throw new Error("Select at least one removable metadata field.");

  const { writeMetadata } = await import("@uswriting/exiftool");
  const deleteMap = Object.fromEntries(selected.map((entry) => [entry.key, ""]));
  const result = await writeMetadata(file, deleteMap, {
    args: ["-m", "-q", "-q", "-api", "LargeFileSupport=1"],
    fetch: exiftoolFetch,
  });

  if (!result.success) throw new Error(result.error || "ExifTool could not clean this image without converting it.");

  const strippedBuffer =
    getImageFormat(file) === "png" ? stripSelectedPngTextChunks(result.data, selected) : result.data;
  const outputName = getOutputFileName(file.name, "clean");
  const outputFile = new File([strippedBuffer], outputName, { type: getImageMimeType(file) });
  const verifiedEntries = await inspectLocalImage(outputFile);

  return {
    blob: outputFile,
    fileName: outputName,
    report: buildVerificationReport(entries, verifiedEntries, selectedIds),
  };
};

export const disposeLocalImageEngine = async () => {
  const { dispose } = await import("@uswriting/exiftool");
  await dispose();
};
