"use client";

import {
  CheckCircleIcon,
  EraserIcon,
  FilmStripIcon,
  ImageIcon,
  TrashIcon,
  UploadIcon,
  Shield01Icon,
  XMarkCircleIcon,
} from "@raycast/icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Button } from "@/components/button";
import { NavigationActions } from "@/components/navigation";
import {
  getOutputFileName,
  isSupportedImageExtension,
  isSupportedImageType,
  isSupportedVideoExtension,
  isSupportedVideoType,
  MAX_VIDEO_BYTES,
} from "@/utils/media";
import cn from "classnames";
import styles from "./metadata-remover.module.css";

type Mode = "image" | "video";
type ProcessingState = "idle" | "uploading" | "processing" | "done" | "error";
type MetadataEntry = { key: string; value: string };

const MIME_TO_EXPORT_TYPE: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/bmp": "image/png",
  "image/gif": "image/png",
  "image/tiff": "image/png",
  "image/svg+xml": "image/png",
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

/* ── Lightweight EXIF parser (client-side, no deps) ── */
function readExifFromFile(file: File): Promise<MetadataEntry[]> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const entries: MetadataEntry[] = [];
      try {
        const view = new DataView(reader.result as ArrayBuffer);
        if (view.getUint16(0) !== 0xffd8) {
          resolve([]);
          return;
        }
        let offset = 2;
        while (offset < view.byteLength - 1) {
          const marker = view.getUint16(offset);
          if (marker === 0xffe1) {
            const length = view.getUint16(offset + 2);
            const exifBlock = new Uint8Array(reader.result as ArrayBuffer, offset + 4, length - 2);
            const str = new TextDecoder("latin1").decode(exifBlock);
            if (str.startsWith("Exif")) {
              const tiffOffset = offset + 10;
              const littleEndian = view.getUint16(tiffOffset) === 0x4949;
              const ifdOffset = view.getUint32(tiffOffset + 4, littleEndian);
              const ifdStart = tiffOffset + ifdOffset;
              if (ifdStart + 2 < view.byteLength) {
                const count = view.getUint16(ifdStart, littleEndian);
                for (let i = 0; i < count && ifdStart + 2 + i * 12 + 12 <= view.byteLength; i++) {
                  const entryOffset = ifdStart + 2 + i * 12;
                  const tag = view.getUint16(entryOffset, littleEndian);
                  const type = view.getUint16(entryOffset + 2, littleEndian);
                  const numValues = view.getUint32(entryOffset + 4, littleEndian);
                  let val = "";
                  if (type === 3) val = String(view.getUint16(entryOffset + 8, littleEndian));
                  else if (type === 4) val = String(view.getUint32(entryOffset + 8, littleEndian));
                  else if (type === 2) {
                    const strLen = numValues;
                    const valueOffset =
                      strLen <= 4 ? entryOffset + 8 : tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
                    if (valueOffset + strLen <= view.byteLength) {
                      const bytes = new Uint8Array(reader.result as ArrayBuffer, valueOffset, strLen);
                      val = new TextDecoder("latin1").decode(bytes).replace(/\0/g, "").trim();
                    }
                  } else if (type === 5 && numValues === 1) {
                    const rOff = tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
                    if (rOff + 8 <= view.byteLength) {
                      const num = view.getUint32(rOff, littleEndian);
                      const den = view.getUint32(rOff + 4, littleEndian);
                      val = den ? `${num}/${den}` : String(num);
                    }
                  }
                  if (val) entries.push({ key: tagName(tag), value: val });
                }
              }
            }
            break;
          }
          if ((marker & 0xff00) !== 0xff00) break;
          offset += 2 + view.getUint16(offset + 2);
        }
      } catch {
        /* parsing failed — return what we have */
      }
      resolve(entries);
    };
    reader.onerror = () => resolve([]);
    reader.readAsArrayBuffer(file.slice(0, 128 * 1024));
  });
}

const EXIF_TAGS: Record<number, string> = {
  0x010f: "Camera Make",
  0x0110: "Camera Model",
  0x0112: "Orientation",
  0x011a: "X Resolution",
  0x011b: "Y Resolution",
  0x0128: "Resolution Unit",
  0x0131: "Software",
  0x0132: "Date/Time",
  0x013b: "Artist",
  0x8298: "Copyright",
  0x8769: "Exif IFD",
  0x8825: "GPS IFD",
  0x0100: "Image Width",
  0x0101: "Image Height",
  0x0102: "Bits/Sample",
  0x0103: "Compression",
  0x0106: "Photometric Interp.",
  0x010e: "Image Description",
  0x0201: "JPEG Offset",
  0x0202: "JPEG Length",
  0xa002: "Pixel X Dimension",
  0xa003: "Pixel Y Dimension",
  0x9003: "Date Original",
  0x9004: "Date Digitized",
  0x829a: "Exposure Time",
  0x829d: "F-Number",
  0x9207: "Metering Mode",
  0x920a: "Focal Length",
  0xa405: "Focal Length (35mm)",
};
function tagName(tag: number) {
  return EXIF_TAGS[tag] || `Tag 0x${tag.toString(16).toUpperCase()}`;
}

/* ── Component ── */
export function MetadataRemover() {
  const [mode, setMode] = useState<Mode>("image");
  const [file, setFile] = useState<File | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState>("idle");
  const [quality, setQuality] = useState(92);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [metadataEntries, setMetadataEntries] = useState<MetadataEntry[]>([]);
  const [metadataLoading, setMetadataLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const qualityValue = useMemo(() => quality / 100, [quality]);
  const isLossy = file ? file.type === "image/jpeg" || file.type === "image/webp" : false;
  const isProcessing = processingState === "uploading" || processingState === "processing";

  const resetFeedback = useCallback(() => {
    setMessage(null);
    setError(null);
  }, []);

  const resetAll = useCallback(() => {
    setFile(null);
    setProcessingState("idle");
    setUploadProgress(0);
    setMetadataEntries([]);
    setMetadataLoading(false);
    resetFeedback();
  }, [resetFeedback]);

  /* Auto-read EXIF when an image file is selected */
  useEffect(() => {
    if (!file || mode !== "image") {
      setMetadataEntries([]);
      return;
    }
    if (file.type !== "image/jpeg") {
      setMetadataEntries([]);
      return;
    }
    setMetadataLoading(true);
    readExifFromFile(file).then((entries) => {
      setMetadataEntries(entries);
      setMetadataLoading(false);
    });
  }, [file, mode]);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    resetFeedback();
    setProcessingState("idle");
    setFile(f);
  };

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    resetFeedback();
    setProcessingState("idle");
    const f = e.dataTransfer?.files?.[0] || null;
    if (f) setFile(f);
  };
  const onRemoveFile = () => {
    resetAll();
    if (inputRef.current) inputRef.current.value = "";
  };

  const validateImageFile = (f: File) => isSupportedImageType(f.type) || isSupportedImageExtension(f.name);
  const validateVideoFile = (f: File) => isSupportedVideoType(f.type) || isSupportedVideoExtension(f.name);

  const removeImageMetadata = async () => {
    if (!file) {
      setError("Select an image file first.");
      return;
    }
    if (!validateImageFile(file)) {
      setError("Unsupported image format.");
      return;
    }
    setProcessingState("processing");
    resetFeedback();
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("Read failed"));
        r.readAsDataURL(file);
      });
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error("Decode failed"));
        i.src = dataUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas failed");
      ctx.drawImage(img, 0, 0);
      const exportType = MIME_TO_EXPORT_TYPE[file.type] || "image/png";
      const qp = exportType === "image/jpeg" || exportType === "image/webp" ? qualityValue : undefined;
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, exportType, qp));
      if (!blob) throw new Error("Export failed");
      downloadBlob(blob, getOutputFileName(file.name, "clean"));
      setProcessingState("done");
      setMessage("Image exported without metadata.");
    } catch (err) {
      setProcessingState("error");
      setError(`Image processing failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const removeVideoMetadata = async () => {
    if (!file) {
      setError("Select a video file first.");
      return;
    }
    if (!validateVideoFile(file)) {
      setError("Unsupported video format.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setError(`File exceeds ${formatBytes(MAX_VIDEO_BYTES)} limit.`);
      return;
    }
    setProcessingState("uploading");
    setUploadProgress(0);
    resetFeedback();
    try {
      const formData = new FormData();
      formData.set("file", file);
      const { blob, fileName } = await new Promise<{ blob: Blob; fileName: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (ev) => {
          if (ev.lengthComputable) {
            const pct = Math.round((ev.loaded / ev.total) * 100);
            setUploadProgress(pct);
            if (pct >= 100) setProcessingState("processing");
          }
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({
              blob: xhr.response as Blob,
              fileName: xhr.getResponseHeader("X-Output-File") || getOutputFileName(file.name, "clean"),
            });
          } else {
            const r = new FileReader();
            r.onload = () => {
              try {
                reject(new Error(JSON.parse(r.result as string)?.error || "Unknown"));
              } catch {
                reject(new Error("Unknown"));
              }
            };
            r.onerror = () => reject(new Error("Unknown"));
            r.readAsText(xhr.response);
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Network error.")));
        xhr.addEventListener("timeout", () => reject(new Error("Request timed out.")));
        xhr.open("POST", "/api/remove-video-metadata");
        xhr.responseType = "blob";
        xhr.timeout = 180_000;
        xhr.send(formData);
      });
      downloadBlob(blob, fileName);
      setProcessingState("done");
      setMessage("Video processed — metadata removed.");
    } catch (err) {
      setProcessingState("error");
      setError(`Video processing failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const imageAccept =
    ".jpg,.jpeg,.png,.webp,.gif,.bmp,.tiff,.tif,.svg,image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff,image/svg+xml";
  const videoAccept =
    ".mp4,.mov,.webm,.mkv,.avi,.flv,.3gp,.ts,.mpg,.mpeg,.ogv,video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,video/x-flv,video/3gpp,video/mp2t,video/mpeg,video/ogg";
  const accept = mode === "image" ? imageAccept : videoAccept;
  const supportedFormats =
    mode === "image" ? "JPG, PNG, WebP, GIF, BMP, TIFF, SVG" : "MP4, MOV, WebM, MKV, AVI, FLV, 3GP, TS, MPEG, OGV";

  return (
    <>
      <NavigationActions>
        <Button
          onClick={mode === "image" ? removeImageMetadata : removeVideoMetadata}
          disabled={isProcessing || !file}
          variant="primary"
        >
          <EraserIcon className="h-4 w-4" />
          {isProcessing ? "Processing…" : "Remove Metadata"}
        </Button>
      </NavigationActions>

      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Remove metadata from your files</h1>
          <p className={styles.subtitle}>
            Strip EXIF, XMP, IPTC and other embedded metadata for privacy. Choose between image and video processing
            below.
          </p>
        </header>

        {/* Mode toggle */}
        <div className={styles.modeToggle}>
          <button
            type="button"
            onClick={() => {
              setMode("image");
              resetAll();
            }}
            className={cn(styles.modeButton, mode === "image" && styles.modeButtonActive)}
          >
            <ImageIcon className="h-4 w-4" /> Image
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("video");
              resetAll();
            }}
            className={cn(styles.modeButton, mode === "video" && styles.modeButtonActive)}
          >
            <FilmStripIcon className="h-4 w-4" /> Video
          </button>
        </div>

        {/* Drop zone */}
        {!isProcessing && (
          <div
            ref={dropZoneRef}
            className={cn(styles.dropZone, dragging && styles.dropZoneDragging, file && styles.dropZoneHasFile)}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              onChange={onFileChange}
              className={styles.hiddenInput}
              id="metadata-file-input"
            />
            {!file ? (
              <>
                <div className={styles.dropZoneIcon}>
                  <UploadIcon className="h-6 w-6" />
                </div>
                <p className={styles.dropZoneLabel}>
                  Drop your {mode} here or <span className="text-brand">browse</span>
                </p>
                <p className={styles.dropZoneHint}>Click or drag a file to get started</p>
                <p className={styles.dropZoneAccept}>Supports {supportedFormats}</p>
              </>
            ) : (
              <>
                <div className={styles.dropZoneIcon}>
                  {mode === "image" ? <ImageIcon className="h-6 w-6" /> : <FilmStripIcon className="h-6 w-6" />}
                </div>
                <p className={styles.dropZoneLabel}>File ready</p>
                <p className={styles.dropZoneHint}>Click &ldquo;Remove Metadata&rdquo; in the top right to process</p>
              </>
            )}
          </div>
        )}

        {/* Processing state */}
        {isProcessing && (
          <div className={cn(styles.dropZone, styles.dropZoneHasFile)}>
            <div className={styles.processingOverlay}>
              <div className={styles.spinner} />
              <p className={styles.processingText}>{processingState === "uploading" ? "Uploading…" : "Processing…"}</p>
              <p className={styles.processingHint}>
                {processingState === "uploading"
                  ? "Sending file to server"
                  : mode === "image"
                    ? "Stripping metadata locally"
                    : "Server is removing metadata"}
              </p>
            </div>
          </div>
        )}

        {/* File preview */}
        {file && !isProcessing && (
          <div className={styles.filePreview}>
            <div className={styles.fileIconWrapper}>
              {mode === "image" ? <ImageIcon className="h-5 w-5" /> : <FilmStripIcon className="h-5 w-5" />}
            </div>
            <div className={styles.fileInfo}>
              <p className={styles.fileName}>{file.name}</p>
              <p className={styles.fileSize}>{formatBytes(file.size)}</p>
            </div>
            <button type="button" className={styles.fileRemove} onClick={onRemoveFile} aria-label="Remove file">
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Metadata preview for JPEG images */}
        {file && !isProcessing && mode === "image" && (metadataLoading || metadataEntries.length > 0) && (
          <div className={styles.metadataPreview}>
            <p className={styles.metadataTitle}>Detected metadata</p>
            {metadataLoading ? (
              <p className={styles.metadataHint}>Reading…</p>
            ) : (
              <div className={styles.metadataList}>
                {metadataEntries.map((entry, i) => (
                  <div key={i} className={styles.metadataRow}>
                    <span className={styles.metadataKey}>{entry.key}</span>
                    <span className={styles.metadataValue}>{entry.value}</span>
                  </div>
                ))}
              </div>
            )}
            <p className={styles.metadataHint}>All detected metadata will be stripped on export.</p>
          </div>
        )}

        {file &&
          !isProcessing &&
          mode === "image" &&
          !metadataLoading &&
          metadataEntries.length === 0 &&
          file.type === "image/jpeg" && (
            <div className={styles.metadataPreview}>
              <p className={styles.metadataTitle}>No EXIF metadata detected</p>
              <p className={styles.metadataHint}>
                This image may already be clean, or uses non-EXIF metadata that will still be stripped.
              </p>
            </div>
          )}

        {/* Quality slider */}
        {mode === "image" && file && !isProcessing && isLossy && (
          <div className={styles.qualitySection}>
            <span className={styles.qualityLabel}>Quality</span>
            <input
              id="quality-slider"
              type="range"
              min={60}
              max={100}
              step={1}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className={styles.qualitySlider}
            />
            <span className={styles.qualityValue}>{quality}</span>
          </div>
        )}

        {/* Upload progress */}
        {mode === "video" && processingState === "uploading" && (
          <div className={styles.uploadProgress}>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${uploadProgress}%` }} />
            </div>
            <p className={styles.progressText}>Uploading — {uploadProgress}%</p>
          </div>
        )}

        {/* Video size limit */}
        {mode === "video" && !file && !isProcessing && (
          <p className={styles.sizeLimit}>Max file size: {formatBytes(MAX_VIDEO_BYTES)}</p>
        )}

        {/* Feedback */}
        {message && (
          <div className={cn(styles.feedback, styles.feedbackSuccess)}>
            <CheckCircleIcon className={cn("h-4 w-4", styles.feedbackIcon)} /> {message}
          </div>
        )}
        {error && (
          <div className={cn(styles.feedback, styles.feedbackError)}>
            <XMarkCircleIcon className={cn("h-4 w-4", styles.feedbackIcon)} /> {error}
          </div>
        )}

        {/* Privacy notice */}
        <div className={styles.privacyNotice}>
          <Shield01Icon className="h-3.5 w-3.5" />
          {mode === "image"
            ? "Images are processed entirely in your browser — nothing is uploaded."
            : "Videos are uploaded to the server for processing and deleted immediately after."}
        </div>
      </div>
    </>
  );
}
