export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/svg+xml",
] as const;

export const VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
  "video/x-flv",
  "video/3gpp",
  "video/mp2t",
  "video/mpeg",
  "video/ogg",
] as const;

export const MAX_SERVER_VIDEO_BYTES = 250 * 1024 * 1024;

export type VideoContainerFamily = "avi" | "flv" | "isobmff" | "matroska" | "mpeg" | "mpegts" | "ogg";

export type ValidatedVideoContainer = {
  demuxer: string;
  extension: string;
  family: VideoContainerFamily;
  mimeType: string;
  muxer: string;
};

export type VideoContainerValidationErrorCode = "container_mismatch" | "unsupported_container";

export class VideoContainerValidationError extends Error {
  readonly code: VideoContainerValidationErrorCode;

  constructor(code: VideoContainerValidationErrorCode) {
    super(
      code === "container_mismatch"
        ? "The file extension does not match the detected video container."
        : "The detected video container is not supported.",
    );
    this.name = "VideoContainerValidationError";
    this.code = code;
  }
}

const VIDEO_CONTAINER_BY_EXTENSION: Record<string, ValidatedVideoContainer> = {
  "3gp": { demuxer: "mov", extension: "3gp", family: "isobmff", mimeType: "video/3gpp", muxer: "3gp" },
  avi: { demuxer: "avi", extension: "avi", family: "avi", mimeType: "video/x-msvideo", muxer: "avi" },
  flv: { demuxer: "flv", extension: "flv", family: "flv", mimeType: "video/x-flv", muxer: "flv" },
  mkv: {
    demuxer: "matroska",
    extension: "mkv",
    family: "matroska",
    mimeType: "video/x-matroska",
    muxer: "matroska",
  },
  mov: { demuxer: "mov", extension: "mov", family: "isobmff", mimeType: "video/quicktime", muxer: "mov" },
  mp4: { demuxer: "mov", extension: "mp4", family: "isobmff", mimeType: "video/mp4", muxer: "mp4" },
  mpeg: { demuxer: "mpeg", extension: "mpeg", family: "mpeg", mimeType: "video/mpeg", muxer: "mpeg" },
  mpg: { demuxer: "mpeg", extension: "mpg", family: "mpeg", mimeType: "video/mpeg", muxer: "mpeg" },
  ogv: { demuxer: "ogg", extension: "ogv", family: "ogg", mimeType: "video/ogg", muxer: "ogg" },
  ts: { demuxer: "mpegts", extension: "ts", family: "mpegts", mimeType: "video/mp2t", muxer: "mpegts" },
  webm: { demuxer: "matroska", extension: "webm", family: "matroska", mimeType: "video/webm", muxer: "webm" },
};

const VIDEO_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "video/3gpp": "3gp",
  "video/mp2t": "ts",
  "video/mp4": "mp4",
  "video/mpeg": "mpg",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-flv": "flv",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
};

const VIDEO_FAMILY_BY_PROBE_FORMAT: Record<string, VideoContainerFamily> = {
  "3g2": "isobmff",
  "3gp": "isobmff",
  avi: "avi",
  flv: "flv",
  m4a: "isobmff",
  matroska: "matroska",
  mj2: "isobmff",
  mov: "isobmff",
  mp4: "isobmff",
  mpeg: "mpeg",
  mpegts: "mpegts",
  ogg: "ogg",
  webm: "matroska",
};

export const isSupportedImageType = (type: string) => {
  return IMAGE_MIME_TYPES.includes(type as (typeof IMAGE_MIME_TYPES)[number]);
};

export const isSupportedVideoType = (type: string) => {
  return VIDEO_MIME_TYPES.includes(type as (typeof VIDEO_MIME_TYPES)[number]);
};

export const getExtensionFromFileName = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex === -1 || dotIndex === fileName.length - 1) {
    return "";
  }

  return fileName.slice(dotIndex + 1).toLowerCase();
};

export const getClaimedVideoContainer = (fileName: string, mimeType: string) => {
  const claimedExtension = getExtensionFromFileName(fileName);
  const fallbackExtension = VIDEO_EXTENSION_BY_MIME_TYPE[mimeType.trim().toLowerCase()] || "";
  return VIDEO_CONTAINER_BY_EXTENSION[claimedExtension || fallbackExtension] || null;
};

export const resolveVideoContainer = (
  fileName: string,
  mimeType: string,
  probeFormatName: string | undefined,
): ValidatedVideoContainer => {
  const detectedFamilies = new Set(
    (probeFormatName || "")
      .split(",")
      .map((format) => VIDEO_FAMILY_BY_PROBE_FORMAT[format.trim().toLowerCase()])
      .filter((family): family is VideoContainerFamily => Boolean(family)),
  );

  if (detectedFamilies.size !== 1) {
    throw new VideoContainerValidationError("unsupported_container");
  }

  const detectedFamily = detectedFamilies.values().next().value as VideoContainerFamily;
  const claimedContainer = getClaimedVideoContainer(fileName, mimeType);

  if (!claimedContainer) {
    throw new VideoContainerValidationError("unsupported_container");
  }

  if (claimedContainer.family !== detectedFamily) {
    throw new VideoContainerValidationError("container_mismatch");
  }

  return claimedContainer;
};

const SUPPORTED_VIDEO_EXTENSIONS = new Set(Object.keys(VIDEO_CONTAINER_BY_EXTENSION));

const SUPPORTED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif", "svg"]);

export const isSupportedVideoExtension = (fileName: string) => {
  const extension = getExtensionFromFileName(fileName);
  return SUPPORTED_VIDEO_EXTENSIONS.has(extension);
};

export const isSupportedImageExtension = (fileName: string) => {
  const extension = getExtensionFromFileName(fileName);
  return SUPPORTED_IMAGE_EXTENSIONS.has(extension);
};

export const getOutputFileName = (fileName: string, suffix: string) => {
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex === -1) {
    return `${fileName}-${suffix}`;
  }

  const baseName = fileName.slice(0, dotIndex);
  const extension = fileName.slice(dotIndex + 1);
  return `${baseName}-${suffix}.${extension}`;
};
