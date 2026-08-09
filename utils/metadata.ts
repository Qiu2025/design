export type MetadataMode = "image" | "video";
export type MetadataScope = "image" | "format" | "stream" | "chapter";
export type CleaningPreset = "safe" | "maximum" | "custom";
export type ProcessingLocation = "local" | "server";
export type MetadataSensitivity = "sensitive" | "technical" | "functional";

export type MetadataEntry = {
  id: string;
  group: string;
  label: string;
  value: string;
  key: string;
  scope: MetadataScope;
  streamIndex?: number;
  chapterIndex?: number;
  sensitivity: MetadataSensitivity;
  protected: boolean;
  protectionReason?: string;
};

export type SelectedMetadataEntry = Pick<MetadataEntry, "scope" | "key" | "streamIndex" | "chapterIndex">;

export type VerificationReport = {
  removed: MetadataEntry[];
  preserved: MetadataEntry[];
  unresolved: MetadataEntry[];
};

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const matchesAny = (value: string, patterns: string[]) => patterns.some((pattern) => value.includes(pattern));

const FUNCTIONAL_PATTERNS = [
  "orientation",
  "rotation",
  "rotate",
  "icc",
  "colorprofile",
  "colorspace",
  "srgb",
  "renderingintent",
  "profile",
  "chromatic",
  "whitepoint",
  "transfercharacter",
  "primaries",
  "gamma",
  "bitdepth",
  "colortype",
  "compression",
  "interlace",
  "filter",
  "palette",
  "transparency",
  "backgroundcolor",
  "animation",
  "framecount",
  "loopcount",
  "iterations",
  "imagewidth",
  "imageheight",
  "imagesize",
  "megapixels",
  "pixelaspectratio",
  "pixelsperunit",
  "pixelunits",
  "resolution",
  "xresolution",
  "yresolution",
  "duration",
  "framerate",
  "samplerate",
  "channels",
  "channelmode",
  "codec",
  "language",
  "disposition",
  "majorbrand",
  "minorversion",
  "compatiblebrands",
];

const LOCATION_PATTERNS = [
  "gps",
  "location",
  "latitude",
  "longitude",
  "altitude",
  "geotag",
  "geolocation",
  "city",
  "country",
  "province",
  "state",
  "sublocation",
];

const DATE_PATTERNS = ["date", "time", "timestamp", "year", "month", "day", "timezone", "offsettime"];

const IDENTITY_PATTERNS = [
  "author",
  "artist",
  "creator",
  "owner",
  "copyright",
  "contact",
  "credit",
  "byline",
  "rights",
  "licensor",
  "email",
  "phone",
  "address",
];

const TEXT_PATTERNS = [
  "title",
  "description",
  "comment",
  "keyword",
  "subject",
  "headline",
  "caption",
  "label",
  "rating",
  "category",
  "instructions",
  "usercomment",
];

const DEVICE_PATTERNS = ["make", "model", "camera", "lens", "serial", "device", "body", "firmware", "hostcomputer"];

const SOFTWARE_PATTERNS = [
  "software",
  "application",
  "producer",
  "encoder",
  "encodedby",
  "toolkit",
  "history",
  "documentancestor",
  "derivedfrom",
  "editing",
];

const IDENTIFIER_PATTERNS = [
  "uuid",
  "uniqueid",
  "documentid",
  "instanceid",
  "originaldocumentid",
  "assetid",
  "mediaid",
  "umid",
];

const PREVIEW_PATTERNS = ["thumbnail", "preview", "jpgfromraw", "otherimage", "screenimage"];

export const classifyMetadata = (group: string, key: string, scope: MetadataScope) => {
  const haystack = normalize(`${group} ${key}`);

  if (matchesAny(haystack, FUNCTIONAL_PATTERNS)) {
    return {
      group: "Required for playback or display",
      sensitivity: "functional" as const,
      protected: true,
      protectionReason: "Preserved to keep the file looking and working the same.",
    };
  }

  if (matchesAny(haystack, PREVIEW_PATTERNS)) {
    return { group: "Embedded previews", sensitivity: "sensitive" as const, protected: false };
  }

  if (matchesAny(haystack, LOCATION_PATTERNS)) {
    return { group: "Location", sensitivity: "sensitive" as const, protected: false };
  }

  if (matchesAny(haystack, DATE_PATTERNS)) {
    return { group: "Dates and times", sensitivity: "sensitive" as const, protected: false };
  }

  if (matchesAny(haystack, IDENTITY_PATTERNS)) {
    return { group: "Identity and rights", sensitivity: "sensitive" as const, protected: false };
  }

  if (matchesAny(haystack, TEXT_PATTERNS)) {
    return { group: "Text and labels", sensitivity: "sensitive" as const, protected: false };
  }

  if (matchesAny(haystack, DEVICE_PATTERNS)) {
    return { group: "Device and camera", sensitivity: "sensitive" as const, protected: false };
  }

  if (matchesAny(haystack, SOFTWARE_PATTERNS)) {
    return { group: "Software and history", sensitivity: "sensitive" as const, protected: false };
  }

  if (matchesAny(haystack, IDENTIFIER_PATTERNS)) {
    return { group: "Unique identifiers", sensitivity: "sensitive" as const, protected: false };
  }

  return {
    group: scope === "image" ? "Technical metadata" : "Container and track metadata",
    sensitivity: "technical" as const,
    protected: false,
  };
};

export const getPresetSelection = (entries: MetadataEntry[], preset: Exclude<CleaningPreset, "custom">) => {
  return new Set(
    entries
      .filter((entry) => !entry.protected && (preset === "maximum" || entry.sensitivity === "sensitive"))
      .map((entry) => entry.id),
  );
};

export const serializeSelectedEntries = (entries: MetadataEntry[]): SelectedMetadataEntry[] => {
  return entries.map(({ scope, key, streamIndex, chapterIndex }) => ({ scope, key, streamIndex, chapterIndex }));
};

export const metadataEntryMatches = (entry: MetadataEntry, selected: SelectedMetadataEntry) => {
  return (
    entry.scope === selected.scope &&
    entry.key.toLowerCase() === selected.key.toLowerCase() &&
    entry.streamIndex === selected.streamIndex &&
    entry.chapterIndex === selected.chapterIndex
  );
};

export const buildVerificationReport = (
  before: MetadataEntry[],
  after: MetadataEntry[],
  selectedIds: Set<string>,
): VerificationReport => {
  const selected = before.filter((entry) => selectedIds.has(entry.id));
  const unresolved = selected.filter((entry) =>
    after.some((candidate) => metadataEntryMatches(candidate, serializeSelectedEntries([entry])[0])),
  );
  const unresolvedIds = new Set(unresolved.map((entry) => entry.id));

  return {
    removed: selected.filter((entry) => !unresolvedIds.has(entry.id)),
    preserved: before.filter((entry) => !selectedIds.has(entry.id)),
    unresolved,
  };
};

export const formatMetadataValue = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
