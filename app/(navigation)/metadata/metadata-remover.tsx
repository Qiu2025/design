"use client";

import {
  CheckCircleIcon,
  ChevronDownIcon,
  DownloadIcon,
  EraserIcon,
  FilmStripIcon,
  ImageIcon,
  LockIcon,
  Shield01Icon,
  TrashIcon,
  UploadIcon,
  WarningIcon,
  XMarkCircleIcon,
} from "@raycast/icons";
import cn from "classnames";
import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Button } from "@/components/button";
import { NavigationActions } from "@/components/navigation";
import { cleanLocalImage, getLocalImageSupport, inspectLocalImage } from "@/utils/local-image-metadata";
import { cleanLocalVideo, getLocalVideoSupport, inspectLocalVideo } from "@/utils/local-video-metadata";
import {
  getOutputFileName,
  isSupportedVideoExtension,
  isSupportedVideoType,
  MAX_SERVER_VIDEO_BYTES,
} from "@/utils/media";
import {
  getPresetSelection,
  metadataEntryMatches,
  serializeSelectedEntries,
  type CleaningPreset,
  type MetadataEntry,
  type MetadataMode,
  type ProcessingLocation,
  type SelectedMetadataEntry,
  type VerificationReport,
} from "@/utils/metadata";
import { InfoDialog } from "./components/InfoDialog";
import styles from "./metadata-remover.module.css";

type ProcessingState = "idle" | "inspecting" | "uploading" | "processing" | "done" | "error";
type PendingDownload = { blob: Blob; fileName: string };
const SERVER_CONSENT_SESSION_KEY = "snapbox.metadata.server-consent";

const IMAGE_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.gif,.bmp,.tiff,.tif,.svg,image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff,image/svg+xml";
const VIDEO_ACCEPT =
  ".mp4,.mov,.webm,.mkv,.avi,.flv,.3gp,.ts,.mpg,.mpeg,.ogv,video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,video/x-flv,video/3gpp,video/mp2t,video/mpeg,video/ogg";

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};

const getErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

const decodeServerVerification = (encoded: string | null): SelectedMetadataEntry[] => {
  if (!encoded) return [];

  try {
    const base64 = encoded
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return JSON.parse(atob(base64)) as SelectedMetadataEntry[];
  } catch {
    throw new Error("The server returned an unreadable verification report.");
  }
};

export function MetadataRemover() {
  const [mode, setMode] = useState<MetadataMode>("image");
  const [processingLocation, setProcessingLocation] = useState<ProcessingLocation>("local");
  const [serverConsentGranted, setServerConsentGranted] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(SERVER_CONSENT_SESSION_KEY) === "granted";
    } catch {
      return false;
    }
  });
  const [file, setFile] = useState<File | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [metadataEntries, setMetadataEntries] = useState<MetadataEntry[]>([]);
  const [selectedMetadata, setSelectedMetadata] = useState<Set<string>>(new Set());
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataQuery, setMetadataQuery] = useState("");
  const [preset, setPreset] = useState<CleaningPreset>("safe");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [pendingDownload, setPendingDownload] = useState<PendingDownload | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const isBusy =
    processingState === "inspecting" || processingState === "uploading" || processingState === "processing";
  const selectedCount = selectedMetadata.size;
  const removableEntries = useMemo(() => metadataEntries.filter((entry) => !entry.protected), [metadataEntries]);
  const protectedCount = metadataEntries.length - removableEntries.length;
  const serverTooLarge = Boolean(file && file.size > MAX_SERVER_VIDEO_BYTES);

  const filteredEntries = useMemo(() => {
    const query = metadataQuery.trim().toLowerCase();
    if (!query) return metadataEntries;
    return metadataEntries.filter((entry) =>
      [entry.label, entry.value, entry.group].some((value) => value.toLowerCase().includes(query)),
    );
  }, [metadataEntries, metadataQuery]);

  const groupedEntries = useMemo(() => {
    const groups = new Map<string, MetadataEntry[]>();
    filteredEntries.forEach((entry) => groups.set(entry.group, [...(groups.get(entry.group) || []), entry]));
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredEntries]);

  const clearInspection = useCallback(() => {
    setMetadataEntries([]);
    setSelectedMetadata(new Set());
    setMetadataError(null);
    setMetadataQuery("");
    setPreset("safe");
    setDetailsOpen(false);
    setReport(null);
    setPendingDownload(null);
    setProgress(0);
    setMessage(null);
    setError(null);
    setProcessingState("idle");
  }, []);

  const applyInspectedEntries = useCallback((entries: MetadataEntry[]) => {
    setMetadataEntries(entries);
    setSelectedMetadata(getPresetSelection(entries, "safe"));
    setPreset("safe");
    setReport(null);
    setPendingDownload(null);
  }, []);

  const inspectOnDevice = useCallback(
    async (nextFile: File, nextMode: MetadataMode) => {
      setProcessingState("inspecting");
      setMetadataError(null);
      setError(null);

      try {
        if (nextMode === "image") {
          const support = getLocalImageSupport(nextFile);
          if (!support.supported) throw new Error(support.reason || "This image format is not supported.");
          applyInspectedEntries(await inspectLocalImage(nextFile));
          if (!support.guaranteed && support.reason) setMessage(support.reason);
        } else {
          const support = getLocalVideoSupport(nextFile);
          if (!support.supported) throw new Error(support.reason || "This video cannot be processed on this device.");
          applyInspectedEntries(await inspectLocalVideo(nextFile));
        }
        setProcessingState("idle");
      } catch (inspectionError) {
        setMetadataEntries([]);
        setSelectedMetadata(new Set());
        setMetadataError(getErrorMessage(inspectionError, "The file could not be inspected on this device."));
        setProcessingState("error");
      }
    },
    [applyInspectedEntries],
  );

  const setSelectedFile = useCallback(
    (nextFile: File | null) => {
      clearInspection();
      setFile(nextFile);
      if (!nextFile) return;

      if (mode === "video" && !isSupportedVideoType(nextFile.type) && !isSupportedVideoExtension(nextFile.name)) {
        setMetadataError("This video format is not supported locally or by the server.");
        setProcessingState("error");
        return;
      }

      if (mode === "image" || processingLocation === "local") {
        void inspectOnDevice(nextFile, mode);
      }
    },
    [clearInspection, inspectOnDevice, mode, processingLocation],
  );

  const changeMode = (nextMode: MetadataMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setProcessingLocation("local");
    setFile(null);
    clearInspection();
    if (inputRef.current) inputRef.current.value = "";
  };

  const changeProcessingLocation = (nextLocation: ProcessingLocation) => {
    if (nextLocation === processingLocation) return;
    setProcessingLocation(nextLocation);
    clearInspection();

    if (file && nextLocation === "local") {
      void inspectOnDevice(file, "video");
    }
  };

  const requestServerConsent = () => {
    if (serverConsentGranted) return true;
    const granted = window.confirm(
      "SnapBox will upload this video to process it, delete its temporary files after the response, and keep consent only for this browser session. Continue?",
    );
    if (granted) {
      setServerConsentGranted(true);
      try {
        window.sessionStorage.setItem(SERVER_CONSENT_SESSION_KEY, "granted");
      } catch {
        // In-memory consent still applies when session storage is unavailable.
      }
    }
    return granted;
  };

  const inspectOnServer = async () => {
    if (!file || mode !== "video" || processingLocation !== "server") return;
    if (serverTooLarge) {
      setMetadataError("This video exceeds the 250 MB server limit and will not be uploaded.");
      return;
    }
    if (!requestServerConsent()) return;

    setProcessingState("uploading");
    setMetadataError(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/metadata/inspect", { method: "POST", body: formData });
      const payload = (await response.json()) as { entries?: MetadataEntry[]; error?: string };
      if (!response.ok || !payload.entries)
        throw new Error(payload.error || "The server could not inspect this video.");
      applyInspectedEntries(payload.entries);
      setProcessingState("idle");
    } catch (inspectionError) {
      setMetadataEntries([]);
      setSelectedMetadata(new Set());
      setMetadataError(getErrorMessage(inspectionError, "The server could not inspect this video."));
      setProcessingState("error");
    }
  };

  const applyPreset = (nextPreset: Exclude<CleaningPreset, "custom">) => {
    setPreset(nextPreset);
    setSelectedMetadata(getPresetSelection(metadataEntries, nextPreset));
    setReport(null);
    setPendingDownload(null);
  };

  const toggleMetadataSelection = (entry: MetadataEntry) => {
    if (entry.protected) return;
    setPreset("custom");
    setReport(null);
    setPendingDownload(null);
    setSelectedMetadata((previous) => {
      const next = new Set(previous);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.add(entry.id);
      return next;
    });
  };

  const selectGroup = (entries: MetadataEntry[], selected: boolean) => {
    setPreset("custom");
    setSelectedMetadata((previous) => {
      const next = new Set(previous);
      entries
        .filter((entry) => !entry.protected)
        .forEach((entry) => (selected ? next.add(entry.id) : next.delete(entry.id)));
      return next;
    });
  };

  const finishCleaning = (result: PendingDownload & { report: VerificationReport }) => {
    setReport(result.report);
    setProcessingState("done");
    setProgress(100);

    if (result.report.unresolved.length > 0) {
      setPendingDownload({ blob: result.blob, fileName: result.fileName });
      setMessage(null);
      return;
    }

    setPendingDownload(null);
    downloadBlob(result.blob, result.fileName);
    setMessage("Verified: no selected fields remain among the metadata SnapBox can detect.");
  };

  const cleanOnServer = async (selectedEntries: MetadataEntry[]) => {
    if (!file) return;
    if (serverTooLarge) throw new Error("This video exceeds the 250 MB server limit and will not be uploaded.");
    if (!requestServerConsent()) return;

    setProcessingState("uploading");
    setProgress(0);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("selected", JSON.stringify(serializeSelectedEntries(selectedEntries)));

    const result = await new Promise<PendingDownload & { report: VerificationReport }>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        const uploadProgress = Math.round((event.loaded / event.total) * 100);
        setProgress(uploadProgress);
        if (uploadProgress >= 100) setProcessingState("processing");
      });
      request.addEventListener("load", () => {
        if (request.status < 200 || request.status >= 300) {
          request.response.text().then((body: string) => {
            try {
              reject(
                new Error((JSON.parse(body) as { error?: string }).error || "The server could not clean this video."),
              );
            } catch {
              reject(new Error("The server could not clean this video."));
            }
          });
          return;
        }

        try {
          const unresolvedSelection = decodeServerVerification(request.getResponseHeader("X-Metadata-Verification"));
          const unresolved = selectedEntries.filter((entry) =>
            unresolvedSelection.some((candidate) => metadataEntryMatches(entry, candidate)),
          );
          const unresolvedIds = new Set(unresolved.map((entry) => entry.id));
          const outputHeader = request.getResponseHeader("X-Output-File");
          resolve({
            blob: request.response as Blob,
            fileName: outputHeader ? decodeURIComponent(outputHeader) : getOutputFileName(file.name, "clean"),
            report: {
              removed: selectedEntries.filter((entry) => !unresolvedIds.has(entry.id)),
              preserved: metadataEntries.filter((entry) => !selectedMetadata.has(entry.id)),
              unresolved,
            },
          });
        } catch (responseError) {
          reject(responseError);
        }
      });
      request.addEventListener("error", () => reject(new Error("The upload failed because of a network error.")));
      request.addEventListener("timeout", () => reject(new Error("Server processing timed out.")));
      request.open("POST", "/api/metadata/remove");
      request.responseType = "blob";
      request.timeout = 180_000;
      request.send(formData);
    });

    finishCleaning(result);
  };

  const removeSelectedMetadata = async () => {
    if (!file || selectedCount === 0) return;
    const selectedEntries = metadataEntries.filter((entry) => selectedMetadata.has(entry.id) && !entry.protected);
    if (selectedEntries.length === 0) return;

    setError(null);
    setMessage(null);
    setReport(null);
    setPendingDownload(null);

    try {
      if (mode === "video" && processingLocation === "server") {
        await cleanOnServer(selectedEntries);
        return;
      }

      setProcessingState("processing");
      setProgress(0);
      const result =
        mode === "image"
          ? await cleanLocalImage(file, metadataEntries, selectedMetadata)
          : await cleanLocalVideo(file, metadataEntries, selectedMetadata, setProgress);
      finishCleaning(result);
    } catch (processingError) {
      setProcessingState("error");
      setError(getErrorMessage(processingError, "The file could not be cleaned without altering it."));
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => setSelectedFile(event.target.files?.[0] || null);
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) setSelectedFile(droppedFile);
  };

  const removeFile = () => {
    setFile(null);
    clearInspection();
    if (inputRef.current) inputRef.current.value = "";
  };

  const supportedFormats =
    mode === "image"
      ? "JPEG, PNG and WebP. GIF, TIFF, BMP and SVG when they can be preserved."
      : "Compatibility depends on the container, browser and device.";
  const hasNothingToClean =
    file && !isBusy && !metadataError && metadataEntries.length > 0 && removableEntries.length === 0;
  const hasNoDetectedMetadata = file && !isBusy && !metadataError && metadataEntries.length === 0;

  return (
    <>
      <NavigationActions>
        <InfoDialog />
        <Button
          onClick={removeSelectedMetadata}
          disabled={isBusy || !file || selectedCount === 0 || (processingLocation === "server" && serverTooLarge)}
          variant="primary"
        >
          <EraserIcon className="h-4 w-4" />
          {isBusy && processingState !== "inspecting"
            ? "Cleaning…"
            : `Clean file${selectedCount ? ` (${selectedCount})` : ""}`}
        </Button>
      </NavigationActions>

      <main className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Remove metadata from your files</h1>
          <p className={styles.subtitle}>Guided privacy cleaning with a detailed, verifiable report.</p>
        </header>

        <div className={styles.modeToggle} aria-label="File type">
          <button
            type="button"
            onClick={() => changeMode("image")}
            className={cn(styles.modeButton, mode === "image" && styles.modeButtonActive)}
          >
            <ImageIcon className="h-4 w-4" /> Image
          </button>
          <button
            type="button"
            onClick={() => changeMode("video")}
            className={cn(styles.modeButton, mode === "video" && styles.modeButtonActive)}
          >
            <FilmStripIcon className="h-4 w-4" /> Video
          </button>
        </div>

        {mode === "video" && (
          <section className={styles.processingChooser} aria-label="Video processing location">
            <button
              type="button"
              className={cn(styles.processingOption, processingLocation === "local" && styles.processingOptionActive)}
              onClick={() => changeProcessingLocation("local")}
            >
              <span className={styles.processingOptionTitle}>On this device</span>
              <span className={styles.processingBadge}>Recommended</span>
              <span className={styles.processingOptionText}>No upload. Compatibility depends on this device.</span>
            </button>
            <button
              type="button"
              className={cn(
                styles.processingOption,
                processingLocation === "server" && styles.processingOptionActive,
                processingLocation === "local" && metadataError && file && styles.processingOptionSuggested,
              )}
              onClick={() => changeProcessingLocation("server")}
            >
              <span className={styles.processingOptionTitle}>Server fallback</span>
              <span className={styles.processingOptionText}>Explicit consent required. Maximum 250 MB.</span>
            </button>
          </section>
        )}

        <div
          ref={dropZoneRef}
          className={cn(styles.dropZone, dragging && styles.dropZoneDragging, file && styles.dropZoneHasFile)}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault();
            if (dropZoneRef.current && !dropZoneRef.current.contains(event.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            id="metadata-file-input"
            type="file"
            accept={mode === "image" ? IMAGE_ACCEPT : VIDEO_ACCEPT}
            onChange={onFileChange}
            className={styles.hiddenInput}
            disabled={isBusy}
          />
          <div className={styles.dropZoneIcon}>
            {file ? (
              mode === "image" ? (
                <ImageIcon className="h-6 w-6" />
              ) : (
                <FilmStripIcon className="h-6 w-6" />
              )
            ) : (
              <UploadIcon className="h-6 w-6" />
            )}
          </div>
          <p className={styles.dropZoneLabel}>{file ? "Choose a different file" : `Drop one ${mode} here or browse`}</p>
          <p className={styles.dropZoneHint}>Files are kept only in memory and disappear when this page is reloaded.</p>
          <p className={styles.dropZoneAccept}>{supportedFormats}</p>
        </div>

        {file && (
          <div className={styles.filePreview}>
            <div className={styles.fileIconWrapper}>
              {mode === "image" ? <ImageIcon className="h-5 w-5" /> : <FilmStripIcon className="h-5 w-5" />}
            </div>
            <div className={styles.fileInfo}>
              <p className={styles.fileName}>{file.name}</p>
              <p className={styles.fileSize}>
                {formatBytes(file.size)} · output: {getOutputFileName(file.name, "clean")}
              </p>
            </div>
            <button
              type="button"
              className={styles.fileRemove}
              onClick={removeFile}
              aria-label="Remove file"
              disabled={isBusy}
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        {mode === "video" && processingLocation === "server" && file && metadataEntries.length === 0 && !isBusy && (
          <div className={cn(styles.serverCallout, serverTooLarge && styles.serverCalloutError)}>
            <div>
              <p className={styles.calloutTitle}>
                {serverTooLarge ? "Server unavailable for this file" : "Ready for server inspection"}
              </p>
              <p className={styles.calloutText}>
                {serverTooLarge
                  ? "This video is larger than 250 MB. SnapBox will not upload it."
                  : "Nothing has been uploaded. Continue only if you consent to sending this video for temporary processing."}
              </p>
            </div>
            {!serverTooLarge && <Button onClick={inspectOnServer}>Inspect on server</Button>}
          </div>
        )}

        {isBusy && (
          <div className={styles.processingPanel}>
            <div className={styles.spinner} />
            <div>
              <p className={styles.processingText}>
                {processingState === "inspecting"
                  ? "Inspecting metadata…"
                  : processingState === "uploading"
                    ? "Uploading with consent…"
                    : "Cleaning and verifying…"}
              </p>
              <p className={styles.processingHint}>
                {processingLocation === "local" || mode === "image"
                  ? "This work stays on your device."
                  : "Temporary server files are deleted after the response."}
              </p>
            </div>
          </div>
        )}

        {file && metadataError && !isBusy && (
          <div className={cn(styles.feedback, styles.feedbackError)}>
            <XMarkCircleIcon className={cn("h-4 w-4", styles.feedbackIcon)} />
            <span>{metadataError}</span>
            {mode === "video" && processingLocation === "local" && file.size <= MAX_SERVER_VIDEO_BYTES && (
              <button type="button" className={styles.inlineAction} onClick={() => changeProcessingLocation("server")}>
                Use server fallback
              </button>
            )}
          </div>
        )}

        {file && metadataEntries.length > 0 && removableEntries.length > 0 && !isBusy && (
          <section className={styles.cleaningPanel}>
            <div className={styles.metadataHeader}>
              <div>
                <p className={styles.metadataTitle}>Choose a cleaning level</p>
                <p className={styles.metadataHint}>
                  {removableEntries.length} removable · {protectedCount} protected
                </p>
              </div>
              {preset === "custom" && <span className={styles.customBadge}>Custom</span>}
            </div>

            <div className={styles.presetButtons}>
              <button
                type="button"
                className={cn(styles.presetButton, preset === "safe" && styles.presetButtonActive)}
                onClick={() => applyPreset("safe")}
              >
                <span>Safe cleaning</span>
                <small>Personal, location, date, device and history data</small>
              </button>
              <button
                type="button"
                className={cn(styles.presetButton, preset === "maximum" && styles.presetButtonActive)}
                onClick={() => applyPreset("maximum")}
              >
                <span>Maximum cleaning</span>
                <small>Also removes remaining non-functional metadata</small>
              </button>
            </div>

            <button
              type="button"
              className={styles.detailsToggle}
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
            >
              <span>Details and manual selection</span>
              <ChevronDownIcon className={cn("h-4 w-4", detailsOpen && styles.chevronOpen)} />
            </button>

            {detailsOpen && (
              <div className={styles.detailsBody}>
                <div className={styles.metadataSearch}>
                  <input
                    value={metadataQuery}
                    onChange={(event) => setMetadataQuery(event.target.value)}
                    placeholder="Search fields or values"
                    className={styles.metadataSearchInput}
                  />
                  <span className={styles.metadataSearchCount}>{filteredEntries.length} shown</span>
                </div>

                {groupedEntries.map(([group, entries]) => {
                  const selectable = entries.filter((entry) => !entry.protected);
                  return (
                    <div key={group} className={styles.metadataGroup}>
                      <div className={styles.metadataGroupHeader}>
                        <span className={styles.metadataGroupTitle}>{group}</span>
                        {selectable.length > 0 && (
                          <span className={styles.metadataGroupActions}>
                            <button
                              type="button"
                              onClick={() => selectGroup(selectable, true)}
                              className={styles.metadataGroupButton}
                            >
                              Select
                            </button>
                            <button
                              type="button"
                              onClick={() => selectGroup(selectable, false)}
                              className={styles.metadataGroupButton}
                            >
                              Clear
                            </button>
                          </span>
                        )}
                      </div>
                      <div className={styles.metadataList}>
                        {entries.map((entry) => (
                          <label
                            key={entry.id}
                            className={cn(styles.metadataRow, entry.protected && styles.metadataRowProtected)}
                          >
                            <input
                              type="checkbox"
                              checked={!entry.protected && selectedMetadata.has(entry.id)}
                              disabled={entry.protected}
                              onChange={() => toggleMetadataSelection(entry)}
                              className={styles.metadataCheckbox}
                            />
                            <span className={styles.metadataField}>
                              <span className={styles.metadataKey}>{entry.label}</span>
                              {entry.protected && (
                                <span className={styles.protectedLabel}>
                                  <LockIcon className="h-3 w-3" /> Protected
                                </span>
                              )}
                            </span>
                            <span className={styles.metadataValue}>{entry.value}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <p className={styles.protectedNote}>
                  Orientation, color, animation, playback and stream structure stay protected so the file remains
                  usable.
                </p>
              </div>
            )}

            <div className={styles.selectionSummary}>
              <strong>{selectedCount}</strong> fields selected for removal
            </div>
          </section>
        )}

        {(hasNothingToClean || hasNoDetectedMetadata) && (
          <div className={cn(styles.feedback, styles.feedbackSuccess)}>
            <CheckCircleIcon className={cn("h-4 w-4", styles.feedbackIcon)} />
            This file already appears clean
          </div>
        )}

        {progress > 0 && isBusy && processingState !== "inspecting" && (
          <div className={styles.uploadProgress}>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${progress}%` }} />
            </div>
            <p className={styles.progressText}>
              {processingState === "uploading" ? `Uploading — ${progress}%` : `Processing — ${progress}%`}
            </p>
          </div>
        )}

        {report && (
          <section className={cn(styles.report, report.unresolved.length > 0 && styles.reportWarning)}>
            <div className={styles.reportHeader}>
              {report.unresolved.length > 0 ? (
                <WarningIcon className="h-5 w-5" />
              ) : (
                <CheckCircleIcon className="h-5 w-5" />
              )}
              <div>
                <p className={styles.reportTitle}>
                  {report.unresolved.length > 0 ? "Verification found unresolved fields" : "Cleaning verified"}
                </p>
                <p className={styles.reportText}>
                  {report.unresolved.length > 0
                    ? "The download did not start. You can review the result and decide whether to download it with a warning."
                    : "No selected fields remain among the metadata SnapBox can detect."}
                </p>
              </div>
            </div>
            <div className={styles.reportGrid}>
              <div>
                <strong>{report.removed.length}</strong>
                <span>Removed</span>
              </div>
              <div>
                <strong>{report.preserved.length}</strong>
                <span>Preserved</span>
              </div>
              <div>
                <strong>{report.unresolved.length}</strong>
                <span>Unresolved</span>
              </div>
            </div>
            <div className={styles.reportDetails}>
              {[
                { label: "Removed", entries: report.removed },
                { label: "Preserved", entries: report.preserved },
                { label: "Unresolved", entries: report.unresolved },
              ].map(({ label, entries }) => (
                <details key={label}>
                  <summary>
                    {label} ({entries.length})
                  </summary>
                  {entries.length > 0 ? (
                    <ul>
                      {entries.map((entry) => (
                        <li key={entry.id}>{entry.label}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>None</p>
                  )}
                </details>
              ))}
            </div>
            {report.unresolved.length > 0 && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => pendingDownload && downloadBlob(pendingDownload.blob, pendingDownload.fileName)}
                  disabled={!pendingDownload}
                >
                  <DownloadIcon className="h-4 w-4" /> Download with warning
                </Button>
              </>
            )}
          </section>
        )}

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

        <div className={styles.privacyNotice}>
          <Shield01Icon className="h-3.5 w-3.5" />
          {mode === "image" || processingLocation === "local"
            ? "Local processing: this file is never uploaded or stored persistently."
            : "Server fallback uploads only after consent and removes temporary files after the response."}
        </div>
      </main>
    </>
  );
}
