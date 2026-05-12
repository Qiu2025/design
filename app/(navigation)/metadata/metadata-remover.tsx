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
import { InfoDialog } from "./components/InfoDialog";
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
type MetadataEntry = {
  id: string;
  group: string;
  label: string;
  value: string;
  key: string;
  scope: "image" | "format" | "stream";
  streamIndex?: number;
};
const METADATA_TOOL_STORAGE_KEY = "rayso.metadata.tool.v1";
const METADATA_FILES_DB = "rayso.metadata.files.v1";
const METADATA_FILES_STORE = "files";

type PersistedFileRecord = {
  key: "image" | "video";
  file: File;
  savedAt: number;
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

const openMetadataFilesDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(METADATA_FILES_DB, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(METADATA_FILES_STORE)) {
        db.createObjectStore(METADATA_FILES_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open IndexedDB"));
  });
};

const persistFileToIndexedDb = async (mode: Mode, file: File | null) => {
  const db = await openMetadataFilesDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(METADATA_FILES_STORE, "readwrite");
    const store = transaction.objectStore(METADATA_FILES_STORE);

    if (file) {
      const record: PersistedFileRecord = {
        key: mode,
        file,
        savedAt: Date.now(),
      };
      store.put(record);
    } else {
      store.delete(mode);
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not persist file"));
    transaction.onabort = () => reject(transaction.error || new Error("File persistence aborted"));
  });

  db.close();
};

const readPersistedFileFromIndexedDb = async (mode: Mode): Promise<File | null> => {
  const db = await openMetadataFilesDb();

  const record = await new Promise<PersistedFileRecord | undefined>((resolve, reject) => {
    const transaction = db.transaction(METADATA_FILES_STORE, "readonly");
    const store = transaction.objectStore(METADATA_FILES_STORE);
    const request = store.get(mode);

    request.onsuccess = () => resolve(request.result as PersistedFileRecord | undefined);
    request.onerror = () => reject(request.error || new Error("Could not restore file"));
  });

  db.close();
  return record?.file ?? null;
};

/* ── Component ── */
export function MetadataRemover() {
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === "undefined") {
      return "image";
    }

    try {
      const persisted = window.localStorage.getItem(METADATA_TOOL_STORAGE_KEY);

      if (!persisted) {
        return "image";
      }

      const parsed = JSON.parse(persisted) as { mode?: Mode };
      return parsed.mode === "video" ? "video" : "image";
    } catch {
      return "image";
    }
  });
  const [file, setFile] = useState<File | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [metadataEntries, setMetadataEntries] = useState<MetadataEntry[]>([]);
  const [selectedMetadata, setSelectedMetadata] = useState<Set<string>>(new Set());
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataQuery, setMetadataQuery] = useState("");
  const [hasAttemptedRestore, setHasAttemptedRestore] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const isProcessing = processingState === "uploading" || processingState === "processing";
  const selectedCount = selectedMetadata.size;

  const filteredEntries = useMemo(() => {
    if (!metadataQuery.trim()) {
      return metadataEntries;
    }
    const query = metadataQuery.toLowerCase();
    return metadataEntries.filter(
      (entry) =>
        entry.label.toLowerCase().includes(query) ||
        entry.value.toLowerCase().includes(query) ||
        entry.group.toLowerCase().includes(query),
    );
  }, [metadataEntries, metadataQuery]);

  const groupedEntries = useMemo(() => {
    const groups = new Map<string, MetadataEntry[]>();
    filteredEntries.forEach((entry) => {
      const group = entry.group || "Other";
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)?.push(entry);
    });

    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredEntries]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        METADATA_TOOL_STORAGE_KEY,
        JSON.stringify({
          mode,
        }),
      );
    } catch {
      // Ignore storage failures.
    }
  }, [mode]);

  const resetFeedback = useCallback(() => {
    setMessage(null);
    setError(null);
  }, []);

  const resetAll = useCallback(() => {
    setFile(null);
    setProcessingState("idle");
    setUploadProgress(0);
    setMetadataEntries([]);
    setSelectedMetadata(new Set());
    setMetadataLoading(false);
    setMetadataError(null);
    setMetadataQuery("");
    resetFeedback();
  }, [resetFeedback]);

  const setSelectedFile = useCallback(
    async (nextFile: File | null) => {
      setFile(nextFile);

      try {
        await persistFileToIndexedDb(mode, nextFile);
      } catch {
        // Ignore persistence failures (quota/private mode), keep in-memory behavior.
      }
    },
    [mode],
  );

  useEffect(() => {
    setHasAttemptedRestore(false);
  }, [mode]);

  useEffect(() => {
    if (hasAttemptedRestore || file) {
      return;
    }

    let active = true;

    readPersistedFileFromIndexedDb(mode)
      .then((persistedFile) => {
        if (!active || !persistedFile) {
          return;
        }

        setFile(persistedFile);
      })
      .catch(() => {
        // Ignore restore failures and continue without persisted file.
      })
      .finally(() => {
        if (active) {
          setHasAttemptedRestore(true);
        }
      });

    return () => {
      active = false;
    };
  }, [file, hasAttemptedRestore, mode]);

  useEffect(() => {
    if (!file) {
      setMetadataEntries([]);
      setSelectedMetadata(new Set());
      setMetadataError(null);
      return;
    }

    let active = true;
    const formData = new FormData();
    formData.set("file", file);
    formData.set("mode", mode);

    setMetadataLoading(true);
    setMetadataError(null);

    fetch("/api/metadata/inspect", { method: "POST", body: formData })
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.error || "Unable to inspect metadata.");
        }
        return payload.entries as MetadataEntry[];
      })
      .then((entries) => {
        if (!active) return;
        setMetadataEntries(entries);
        setSelectedMetadata(new Set(entries.map((entry) => entry.id)));
      })
      .catch((error: Error) => {
        if (!active) return;
        setMetadataEntries([]);
        setSelectedMetadata(new Set());
        setMetadataError(error.message);
      })
      .finally(() => {
        if (active) {
          setMetadataLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [file, mode]);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    resetFeedback();
    setProcessingState("idle");
    void setSelectedFile(f);
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
    if (f) {
      void setSelectedFile(f);
    }
  };
  const onRemoveFile = () => {
    resetAll();
    void setSelectedFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const toggleMetadataSelection = (id: string) => {
    setSelectedMetadata((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllMetadata = () => {
    setSelectedMetadata(new Set(metadataEntries.map((entry) => entry.id)));
  };

  const deselectAllMetadata = () => {
    setSelectedMetadata(new Set());
  };

  const selectGroupMetadata = (entries: MetadataEntry[]) => {
    setSelectedMetadata((prev) => {
      const next = new Set(prev);
      entries.forEach((entry) => next.add(entry.id));
      return next;
    });
  };

  const deselectGroupMetadata = (entries: MetadataEntry[]) => {
    setSelectedMetadata((prev) => {
      const next = new Set(prev);
      entries.forEach((entry) => next.delete(entry.id));
      return next;
    });
  };

  const validateImageFile = (f: File) => isSupportedImageType(f.type) || isSupportedImageExtension(f.name);
  const validateVideoFile = (f: File) => isSupportedVideoType(f.type) || isSupportedVideoExtension(f.name);

  const removeSelectedMetadata = async () => {
    if (!file) {
      setError(`Select a ${mode} file first.`);
      return;
    }

    if (mode === "image" && !validateImageFile(file)) {
      setError("Unsupported image format.");
      return;
    }

    if (mode === "video" && !validateVideoFile(file)) {
      setError("Unsupported video format.");
      return;
    }

    if (mode === "video" && file.size > MAX_VIDEO_BYTES) {
      setError(`File exceeds ${formatBytes(MAX_VIDEO_BYTES)} limit.`);
      return;
    }

    const selectedEntries = metadataEntries.filter((entry) => selectedMetadata.has(entry.id));

    if (selectedEntries.length === 0) {
      setError("Select at least one metadata field to remove.");
      return;
    }

    resetFeedback();

    try {
      if (mode === "video") {
        setProcessingState("uploading");
        setUploadProgress(0);

        const formData = new FormData();
        formData.set("file", file);
        formData.set("mode", mode);
        formData.set(
          "selected",
          JSON.stringify(selectedEntries.map(({ scope, key, streamIndex }) => ({ scope, key, streamIndex }))),
        );

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
          xhr.open("POST", "/api/metadata/remove");
          xhr.responseType = "blob";
          xhr.timeout = 180_000;
          xhr.send(formData);
        });

        downloadBlob(blob, fileName);
        setProcessingState("done");
        setMessage(
          `Video processed — removed ${selectedEntries.length} metadata field${selectedEntries.length !== 1 ? "s" : ""}.`,
        );
        return;
      }

      setProcessingState("processing");

      const formData = new FormData();
      formData.set("file", file);
      formData.set("mode", mode);
      formData.set(
        "selected",
        JSON.stringify(selectedEntries.map(({ scope, key, streamIndex }) => ({ scope, key, streamIndex }))),
      );

      const response = await fetch("/api/metadata/remove", { method: "POST", body: formData });
      const blob = await response.blob();

      if (!response.ok) {
        let detail = "Unknown error";
        try {
          const text = await blob.text();
          detail = JSON.parse(text)?.error || detail;
        } catch {
          // ignore parse errors
        }
        throw new Error(detail);
      }

      const outputName = response.headers.get("X-Output-File") || getOutputFileName(file.name, "clean");
      downloadBlob(blob, outputName);
      setProcessingState("done");
      setMessage(
        `Image exported. Removed ${selectedEntries.length} metadata field${selectedEntries.length !== 1 ? "s" : ""}.`,
      );
    } catch (err) {
      setProcessingState("error");
      setError(`Processing failed: ${err instanceof Error ? err.message : "Unknown error"}`);
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
        <InfoDialog />
        <Button
          onClick={removeSelectedMetadata}
          disabled={isProcessing || !file || selectedCount === 0}
          variant="primary"
        >
          <EraserIcon className="h-4 w-4" />
          {isProcessing ? "Processing…" : `Remove Metadata${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
        </Button>
      </NavigationActions>

      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Remove metadata from your files</h1>
          <p className={styles.subtitle}>
            Review detected metadata, choose what to remove, and export a clean image or video.
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
                {processingState === "uploading" ? "Sending file to server" : "Server is removing metadata"}
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

        {/* Metadata preview */}
        {file && !isProcessing && (metadataLoading || metadataEntries.length > 0 || metadataError) && (
          <div className={styles.metadataPreview}>
            <div className={styles.metadataHeader}>
              <p className={styles.metadataTitle}>Detected metadata</p>
              {metadataEntries.length > 0 && !metadataLoading && (
                <div className={styles.metadataControls}>
                  <button type="button" onClick={selectAllMetadata} className={styles.metadataControlButton}>
                    Select all
                  </button>
                  <button type="button" onClick={deselectAllMetadata} className={styles.metadataControlButton}>
                    Clear
                  </button>
                </div>
              )}
            </div>

            {metadataLoading ? (
              <p className={styles.metadataHint}>Reading…</p>
            ) : metadataError ? (
              <p className={styles.metadataError}>{metadataError}</p>
            ) : (
              <>
                <div className={styles.metadataSearch}>
                  <input
                    type="text"
                    value={metadataQuery}
                    onChange={(event) => setMetadataQuery(event.target.value)}
                    placeholder="Search metadata"
                    className={styles.metadataSearchInput}
                  />
                  <span className={styles.metadataSearchCount}>{filteredEntries.length} shown</span>
                </div>

                {groupedEntries.map(([group, entries]) => (
                  <div key={group} className={styles.metadataGroup}>
                    <div className={styles.metadataGroupHeader}>
                      <div className={styles.metadataGroupTitle}>{group}</div>
                      <div className={styles.metadataGroupActions}>
                        <button
                          type="button"
                          onClick={() => selectGroupMetadata(entries)}
                          className={styles.metadataGroupButton}
                        >
                          Select
                        </button>
                        <button
                          type="button"
                          onClick={() => deselectGroupMetadata(entries)}
                          className={styles.metadataGroupButton}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className={styles.metadataList}>
                      {entries.map((entry) => (
                        <label key={entry.id} className={styles.metadataRow}>
                          <input
                            type="checkbox"
                            checked={selectedMetadata.has(entry.id)}
                            onChange={() => toggleMetadataSelection(entry.id)}
                            className={styles.metadataCheckbox}
                          />
                          <span className={styles.metadataKey}>{entry.label}</span>
                          <span className={styles.metadataValue}>{entry.value}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}

            <p className={styles.metadataHint}>
              {selectedCount > 0
                ? `${selectedCount} metadata field${selectedCount !== 1 ? "s" : ""} selected for removal`
                : "Select metadata fields to remove"}
            </p>
          </div>
        )}

        {file && !isProcessing && !metadataLoading && !metadataError && metadataEntries.length === 0 && (
          <div className={styles.metadataPreview}>
            <p className={styles.metadataTitle}>No metadata detected</p>
            <p className={styles.metadataHint}>This file may already be clean, or the metadata is not readable.</p>
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
            ? "Images are uploaded to the server for selective removal and deleted immediately after."
            : "Videos are uploaded to the server for processing and deleted immediately after."}
        </div>
      </div>
    </>
  );
}
