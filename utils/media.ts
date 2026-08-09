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

const SUPPORTED_VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "webm",
  "mkv",
  "avi",
  "flv",
  "3gp",
  "ts",
  "mpg",
  "mpeg",
  "ogv",
]);

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
