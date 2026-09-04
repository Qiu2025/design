import "server-only";
import { extname } from "node:path";

const LOGGABLE_VIDEO_CONTAINERS = new Set([
  "3gp",
  "avi",
  "flv",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "ogv",
  "ts",
  "webm",
]);

type MetadataLogValue = boolean | number | string;

export const getMetadataSizeRange = (bytes: number) => {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 10) return "under_10_mb";
  if (megabytes < 50) return "10_50_mb";
  if (megabytes < 100) return "50_100_mb";
  return "100_250_mb";
};

export const getMetadataContainer = (fileName: string) => {
  const container = extname(fileName).slice(1).toLowerCase();
  return LOGGABLE_VIDEO_CONTAINERS.has(container) ? container : "unknown";
};

export const logServerMetadataEvent = (metric: Record<string, MetadataLogValue>) => {
  const entry = `[metadata][server] ${JSON.stringify(metric)}`;
  if (metric.result === "error") console.error(entry);
  else console.info(entry);
};
