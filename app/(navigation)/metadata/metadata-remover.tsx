"use client";

import {
  CheckCircleIcon,
  ChevronRightIcon,
  DownloadIcon,
  EraserIcon,
  FilmStripIcon,
  ImageIcon,
  LockIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  UploadIcon,
  WarningIcon,
  XMarkCircleIcon,
} from "@raycast/icons";
import cn from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/dialog";
import { Input, InputSlot } from "@/components/input";
import { NavigationActions } from "@/components/navigation";
import { ScrollArea } from "@/components/scroll-area";
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
const SERVER_CONSENT_SESSION_KEY = "design.metadata.server-consent";

const IMAGE_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.gif,.bmp,.tiff,.tif,.svg,image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff,image/svg+xml";
const VIDEO_ACCEPT =
  ".mp4,.mov,.webm,.mkv,.avi,.flv,.3gp,.ts,.mpg,.mpeg,.ogv,video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,video/x-flv,video/3gpp,video/mp2t,video/mpeg,video/ogg";
const PROTECTED_METADATA_GROUP = "Required for playback or display";
const TECHNICAL_METADATA_GROUPS = new Set(["Technical metadata", "Container and track metadata"]);

const getMetadataGroupRank = (group: string) => {
  if (group === PROTECTED_METADATA_GROUP) return 2;
  if (TECHNICAL_METADATA_GROUPS.has(group)) return 1;
  return 0;
};

const compareMetadataGroups = (left: string, right: string) => {
  return getMetadataGroupRank(left) - getMetadataGroupRank(right) || left.localeCompare(right);
};

const normalizeMetadataLabel = (label: string) => label.trim().toLowerCase();

const waitForInspectionPaint = () =>
  new Promise<void>((resolve) => {
    if (document.visibilityState !== "visible") {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fallback = window.setTimeout(finish, 64);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.clearTimeout(fallback);
        finish();
      });
    });
  });

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
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [inspectionComplete, setInspectionComplete] = useState(false);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [pendingDownload, setPendingDownload] = useState<PendingDownload | null>(null);
  const [preserveWorkbenchDuringInspection, setPreserveWorkbenchDuringInspection] = useState(false);
  const [inspectionRevision, setInspectionRevision] = useState(0);
  const [serverConsentOpen, setServerConsentOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const serverConsentResolverRef = useRef<((granted: boolean) => void) | null>(null);
  const serverConsentPromiseRef = useRef<Promise<boolean> | null>(null);
  const inspectionRequestRef = useRef(0);
  const isBusy =
    processingState === "inspecting" || processingState === "uploading" || processingState === "processing";
  const selectedCount = selectedMetadata.size;
  const removableEntries = useMemo(() => metadataEntries.filter((entry) => !entry.protected), [metadataEntries]);
  const protectedCount = metadataEntries.length - removableEntries.length;
  const serverTooLarge = Boolean(file && file.size > MAX_SERVER_VIDEO_BYTES);
  const duplicateMetadataLabels = useMemo(() => {
    const counts = new Map<string, number>();
    metadataEntries.forEach((entry) => {
      const label = normalizeMetadataLabel(entry.label);
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([label]) => label),
    );
  }, [metadataEntries]);

  const filteredEntries = useMemo(() => {
    const query = metadataQuery.trim().toLowerCase();
    if (!query) return metadataEntries;
    return metadataEntries.filter((entry) => {
      const searchableValues = [entry.label, entry.value, entry.group];
      if (duplicateMetadataLabels.has(normalizeMetadataLabel(entry.label))) searchableValues.push(entry.sourceLabel);
      return searchableValues.some((value) => value.toLowerCase().includes(query));
    });
  }, [duplicateMetadataLabels, metadataEntries, metadataQuery]);

  const groupedEntries = useMemo(() => {
    const groups = new Map<string, MetadataEntry[]>();
    filteredEntries.forEach((entry) => groups.set(entry.group, [...(groups.get(entry.group) || []), entry]));
    return Array.from(groups.entries()).sort((a, b) => compareMetadataGroups(a[0], b[0]));
  }, [filteredEntries]);

  const metadataGroups = useMemo(() => {
    const groups = new Map<string, MetadataEntry[]>();
    metadataEntries.forEach((entry) => groups.set(entry.group, [...(groups.get(entry.group) || []), entry]));
    return Array.from(groups.entries()).sort((a, b) => compareMetadataGroups(a[0], b[0]));
  }, [metadataEntries]);

  const visibleGroups = useMemo(() => {
    if (metadataQuery.trim()) return groupedEntries;
    const selectedGroup = metadataGroups.find(([group]) => group === activeGroup);
    return selectedGroup ? [selectedGroup] : metadataGroups.slice(0, 1);
  }, [activeGroup, groupedEntries, metadataGroups, metadataQuery]);

  const clearInspection = useCallback((preserveWorkbench = false) => {
    inspectionRequestRef.current += 1;
    setMetadataEntries([]);
    setSelectedMetadata(new Set());
    setMetadataError(null);
    setMetadataQuery("");
    setPreset("safe");
    setActiveGroup(null);
    setInspectionComplete(false);
    setReport(null);
    setPendingDownload(null);
    setProgress(0);
    setMessage(null);
    setError(null);
    setProcessingState("idle");
    setPreserveWorkbenchDuringInspection(preserveWorkbench);
  }, []);

  useEffect(
    () => () => {
      inspectionRequestRef.current += 1;
    },
    [],
  );

  const applyInspectedEntries = useCallback((entries: MetadataEntry[]) => {
    setMetadataEntries(entries);
    setSelectedMetadata(getPresetSelection(entries, "safe"));
    setPreset("safe");
    setActiveGroup(Array.from(new Set(entries.map((entry) => entry.group))).sort(compareMetadataGroups)[0] || null);
    setInspectionComplete(true);
    setReport(null);
    setPendingDownload(null);
    setPreserveWorkbenchDuringInspection(false);
    setInspectionRevision((revision) => revision + 1);
  }, []);

  const inspectOnDevice = useCallback(
    async (nextFile: File, nextMode: MetadataMode) => {
      const requestId = ++inspectionRequestRef.current;
      setProcessingState("inspecting");
      setMetadataError(null);
      setError(null);
      await waitForInspectionPaint();
      if (requestId !== inspectionRequestRef.current) return;

      try {
        let entries: MetadataEntry[];
        if (nextMode === "image") {
          const support = getLocalImageSupport(nextFile);
          if (!support.supported) throw new Error(support.reason || "This image format is not supported.");
          entries = await inspectLocalImage(nextFile);
          if (requestId !== inspectionRequestRef.current) return;
          if (!support.guaranteed && support.reason) setMessage(support.reason);
        } else {
          const support = getLocalVideoSupport(nextFile);
          if (!support.supported) throw new Error(support.reason || "This video cannot be processed on this device.");
          entries = await inspectLocalVideo(nextFile);
          if (requestId !== inspectionRequestRef.current) return;
        }
        applyInspectedEntries(entries);
        setProcessingState("idle");
      } catch (inspectionError) {
        if (requestId !== inspectionRequestRef.current) return;
        setMetadataEntries([]);
        setSelectedMetadata(new Set());
        setMetadataError(getErrorMessage(inspectionError, "The file could not be inspected on this device."));
        setProcessingState("error");
        setPreserveWorkbenchDuringInspection(false);
      }
    },
    [applyInspectedEntries],
  );

  const setSelectedFile = useCallback(
    (nextFile: File | null) => {
      const shouldPreserveWorkbench = Boolean(
        nextFile &&
          (mode === "image" || processingLocation === "local") &&
          (metadataEntries.length > 0 || report !== null || pendingDownload !== null),
      );
      clearInspection(shouldPreserveWorkbench);
      setFile(nextFile);
      if (!nextFile) return;

      if (mode === "video" && !isSupportedVideoType(nextFile.type) && !isSupportedVideoExtension(nextFile.name)) {
        setMetadataError("This video format is not supported locally or by the server.");
        setProcessingState("error");
        setPreserveWorkbenchDuringInspection(false);
        return;
      }

      if (mode === "image" || processingLocation === "local") {
        void inspectOnDevice(nextFile, mode);
      }
    },
    [clearInspection, inspectOnDevice, metadataEntries.length, mode, pendingDownload, processingLocation, report],
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

  const settleServerConsent = (granted: boolean) => {
    const resolve = serverConsentResolverRef.current;
    serverConsentResolverRef.current = null;
    serverConsentPromiseRef.current = null;

    if (granted) {
      setServerConsentGranted(true);
      try {
        window.sessionStorage.setItem(SERVER_CONSENT_SESSION_KEY, "granted");
      } catch {
        // In-memory consent still applies when session storage is unavailable.
      }
    }
    setServerConsentOpen(false);
    resolve?.(granted);
  };

  const requestServerConsent = () => {
    if (serverConsentGranted) return Promise.resolve(true);
    if (serverConsentPromiseRef.current) return serverConsentPromiseRef.current;

    const request = new Promise<boolean>((resolve) => {
      serverConsentResolverRef.current = resolve;
    });
    serverConsentPromiseRef.current = request;
    setServerConsentOpen(true);
    return request;
  };

  const inspectOnServer = async () => {
    if (!file || mode !== "video" || processingLocation !== "server") return;
    if (serverTooLarge) {
      setMetadataError("This video exceeds the 250 MB server limit and will not be uploaded.");
      return;
    }
    const requestId = ++inspectionRequestRef.current;
    if (!(await requestServerConsent()) || requestId !== inspectionRequestRef.current) return;

    setProcessingState("uploading");
    setMetadataError(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/metadata/inspect", { method: "POST", body: formData });
      const payload = (await response.json()) as { entries?: MetadataEntry[]; error?: string };
      if (requestId !== inspectionRequestRef.current) return;
      if (!response.ok || !payload.entries)
        throw new Error(payload.error || "The server could not inspect this video.");
      applyInspectedEntries(payload.entries);
      setProcessingState("idle");
    } catch (inspectionError) {
      if (requestId !== inspectionRequestRef.current) return;
      setMetadataEntries([]);
      setSelectedMetadata(new Set());
      setMetadataError(getErrorMessage(inspectionError, "The server could not inspect this video."));
      setProcessingState("error");
      setPreserveWorkbenchDuringInspection(false);
    }
  };

  const applyPreset = (nextPreset: Exclude<CleaningPreset, "custom">) => {
    setPreset(nextPreset);
    setSelectedMetadata(getPresetSelection(metadataEntries, nextPreset));
    setReport(null);
    setPendingDownload(null);
    setMessage(null);
  };

  const toggleMetadataSelection = (entry: MetadataEntry) => {
    if (entry.protected) return;
    setPreset("custom");
    setReport(null);
    setPendingDownload(null);
    setMessage(null);
    setSelectedMetadata((previous) => {
      const next = new Set(previous);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.add(entry.id);
      return next;
    });
  };

  const selectGroup = (entries: MetadataEntry[], selected: boolean) => {
    setPreset("custom");
    setReport(null);
    setPendingDownload(null);
    setMessage(null);
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
    setMessage("Verified: no selected fields remain among the metadata fields Design can detect.");
  };

  const cleanOnServer = async (selectedEntries: MetadataEntry[]) => {
    if (!file) return;
    if (serverTooLarge) throw new Error("This video exceeds the 250 MB server limit and will not be uploaded.");
    if (!(await requestServerConsent())) return;

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
              notSelected: metadataEntries.filter((entry) => !selectedMetadata.has(entry.id)),
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
    if (isBusy) return;
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) setSelectedFile(droppedFile);
  };

  const removeFile = () => {
    setFile(null);
    clearInspection();
    if (inputRef.current) inputRef.current.value = "";
  };

  const hasNothingToClean =
    file &&
    inspectionComplete &&
    !isBusy &&
    !metadataError &&
    metadataEntries.length > 0 &&
    removableEntries.length === 0;
  const hasNoDetectedMetadata = file && inspectionComplete && !isBusy && !metadataError && metadataEntries.length === 0;
  const waitingForServerInspection = Boolean(
    file && mode === "video" && processingLocation === "server" && !inspectionComplete && !metadataError && !isBusy,
  );
  const showWorkbench =
    metadataEntries.length > 0 ||
    report !== null ||
    pendingDownload !== null ||
    (preserveWorkbenchDuringInspection && isBusy);
  const isCleaning = isBusy && metadataEntries.length > 0;

  return (
    <>
      <Dialog
        open={serverConsentOpen}
        onOpenChange={(open) => {
          if (open) setServerConsentOpen(true);
          else settleServerConsent(false);
        }}
      >
        <DialogContent size="small">
          <DialogHeader>
            <DialogTitle>Upload this video?</DialogTitle>
            <DialogDescription>
              Design will temporarily upload it for server processing and attempt to remove its temporary files after an
              error or when the response ends. This choice is remembered only for this browser session.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => settleServerConsent(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => settleServerConsent(true)}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NavigationActions>
        <InfoDialog />
        <Button
          onClick={removeSelectedMetadata}
          disabled={isBusy || !file || selectedCount === 0 || (processingLocation === "server" && serverTooLarge)}
          variant="primary"
          className={styles.cleanButton}
          aria-label={isCleaning ? "Cleaning file" : "Clean file"}
          aria-busy={isCleaning}
        >
          <EraserIcon className="h-4 w-4" />
          <span className={styles.cleanButtonLabel}>Clean file</span>
        </Button>
      </NavigationActions>

      <main className={styles.container}>
        <h1 className={styles.visuallyHidden}>Metadata remover</h1>
        <div className={cn(styles.workspace, showWorkbench ? styles.workspaceWorkbench : styles.workspaceSetup)}>
          <aside className={styles.workflowPanel} aria-labelledby="file-panel-title">
            <div className={styles.workflowControls}>
              <div className={styles.panelHeading}>
                <h2 id="file-panel-title">File</h2>
                <div className={styles.modeToggle} role="group" aria-label="File type">
                  <button
                    type="button"
                    onClick={() => changeMode("image")}
                    className={cn(styles.modeButton, mode === "image" && styles.modeButtonActive)}
                    aria-pressed={mode === "image"}
                    disabled={isBusy}
                  >
                    <ImageIcon className="h-4 w-4" /> Image
                  </button>
                  <button
                    type="button"
                    onClick={() => changeMode("video")}
                    className={cn(styles.modeButton, mode === "video" && styles.modeButtonActive)}
                    aria-pressed={mode === "video"}
                    disabled={isBusy}
                  >
                    <FilmStripIcon className="h-4 w-4" /> Video
                  </button>
                </div>
              </div>

              {mode === "video" && (
                <div className={styles.controlBlock}>
                  <span className={styles.controlLabel}>Processing</span>
                  <div className={styles.processingChooser} role="group" aria-label="Video processing location">
                    <button
                      type="button"
                      className={cn(
                        styles.processingOption,
                        processingLocation === "local" && styles.processingOptionActive,
                      )}
                      onClick={() => changeProcessingLocation("local")}
                      aria-pressed={processingLocation === "local"}
                      disabled={isBusy}
                    >
                      On device
                    </button>
                    <button
                      type="button"
                      className={cn(
                        styles.processingOption,
                        processingLocation === "server" && styles.processingOptionActive,
                        processingLocation === "local" &&
                          metadataError &&
                          file &&
                          file.size <= MAX_SERVER_VIDEO_BYTES &&
                          (isSupportedVideoType(file.type) || isSupportedVideoExtension(file.name)) &&
                          styles.processingOptionSuggested,
                      )}
                      onClick={() => changeProcessingLocation("server")}
                      aria-pressed={processingLocation === "server"}
                      disabled={isBusy}
                    >
                      On server
                    </button>
                  </div>
                </div>
              )}

              <div
                ref={dropZoneRef}
                className={cn(styles.dropZone, dragging && styles.dropZoneDragging, file && styles.dropZoneHasFile)}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (!isBusy) setDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  event.preventDefault();
                  if (dropZoneRef.current && !dropZoneRef.current.contains(event.relatedTarget as Node)) {
                    setDragging(false);
                  }
                }}
                onDrop={onDrop}
              >
                <input
                  ref={inputRef}
                  id="metadata-file-input"
                  type="file"
                  accept={mode === "image" ? IMAGE_ACCEPT : VIDEO_ACCEPT}
                  onChange={onFileChange}
                  onClick={(event) => {
                    event.currentTarget.value = "";
                  }}
                  className={styles.hiddenInput}
                  disabled={isBusy}
                  aria-label={`Choose ${mode} file`}
                />

                {file ? (
                  <>
                    <div className={styles.fileIconWrapper}>
                      {mode === "image" ? <ImageIcon className="h-5 w-5" /> : <FilmStripIcon className="h-5 w-5" />}
                    </div>
                    <div className={styles.fileInfo}>
                      <p className={styles.fileName}>{file.name}</p>
                      <p className={styles.fileSize}>
                        {formatBytes(file.size)} · {getOutputFileName(file.name, "clean")}
                      </p>
                    </div>
                    <span className={styles.replaceFile}>Replace</span>
                    <button
                      type="button"
                      className={styles.fileRemove}
                      onClick={removeFile}
                      aria-label="Remove file"
                      disabled={isBusy}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <div className={styles.dropZoneIcon}>
                      <UploadIcon className="h-5 w-5" />
                    </div>
                    <p className={styles.dropZoneLabel}>Drop {mode} or browse</p>
                  </>
                )}
              </div>

              {waitingForServerInspection && (
                <div
                  className={cn(styles.serverCallout, serverTooLarge && styles.serverCalloutError)}
                  role={serverTooLarge ? "alert" : "status"}
                >
                  <span>{serverTooLarge ? "File exceeds the 250 MB limit" : "Server inspection required"}</span>
                  {!serverTooLarge && <Button onClick={inspectOnServer}>Inspect</Button>}
                </div>
              )}

              {isBusy && (!showWorkbench || metadataEntries.length > 0) && (
                <div className={styles.processingPanel} role="status" aria-live="polite">
                  <div className={styles.processingLine}>
                    <div className={styles.spinner} />
                    <p className={styles.processingText}>
                      {processingState === "inspecting"
                        ? "Inspecting metadata…"
                        : processingState === "uploading"
                          ? "Uploading…"
                          : "Cleaning and verifying…"}
                    </p>
                  </div>
                  {progress > 0 && processingState !== "inspecting" && (
                    <div className={styles.uploadProgress}>
                      <div
                        className={styles.progressBar}
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progress}
                      >
                        <div className={styles.progressFill} style={{ width: `${progress}%` }} />
                      </div>
                      <span>{progress}%</span>
                    </div>
                  )}
                </div>
              )}

              {file && metadataError && !isBusy && (
                <div className={cn(styles.feedback, styles.feedbackError)} role="alert">
                  <XMarkCircleIcon className={cn("h-4 w-4", styles.feedbackIcon)} />
                  <span>{metadataError}</span>
                  {mode === "video" &&
                    processingLocation === "local" &&
                    file.size <= MAX_SERVER_VIDEO_BYTES &&
                    (isSupportedVideoType(file.type) || isSupportedVideoExtension(file.name)) && (
                      <button
                        type="button"
                        className={styles.inlineAction}
                        onClick={() => changeProcessingLocation("server")}
                      >
                        Use server
                      </button>
                    )}
                  {mode === "video" && processingLocation === "server" && !serverTooLarge && (
                    <button type="button" className={styles.inlineAction} onClick={inspectOnServer}>
                      Retry
                    </button>
                  )}
                </div>
              )}

              {file && metadataEntries.length > 0 && removableEntries.length > 0 && !isBusy && (
                <section className={styles.cleaningControls} aria-labelledby="cleaning-level-title">
                  <div className={styles.sectionHeading}>
                    <h3 id="cleaning-level-title">Cleaning level</h3>
                    {preset === "custom" && <span className={styles.customBadge}>Custom</span>}
                  </div>
                  <div className={styles.presetButtons} role="group" aria-label="Cleaning level">
                    <button
                      type="button"
                      className={cn(styles.presetButton, preset === "safe" && styles.presetButtonActive)}
                      onClick={() => applyPreset("safe")}
                      aria-pressed={preset === "safe"}
                    >
                      Safe
                    </button>
                    <button
                      type="button"
                      className={cn(styles.presetButton, preset === "maximum" && styles.presetButtonActive)}
                      onClick={() => applyPreset("maximum")}
                      aria-pressed={preset === "maximum"}
                    >
                      Maximum
                    </button>
                  </div>
                </section>
              )}

              {(hasNothingToClean || hasNoDetectedMetadata) && (
                <div className={cn(styles.feedback, styles.feedbackSuccess)} role="status">
                  <CheckCircleIcon className={cn("h-4 w-4", styles.feedbackIcon)} />
                  This file already appears clean
                </div>
              )}

              {message && !report && !hasNothingToClean && !hasNoDetectedMetadata && (
                <div className={cn(styles.feedback, styles.feedbackSuccess)} role="status">
                  <CheckCircleIcon className={cn("h-4 w-4", styles.feedbackIcon)} /> {message}
                </div>
              )}
              {error && (
                <div className={cn(styles.feedback, styles.feedbackError)} role="alert">
                  <XMarkCircleIcon className={cn("h-4 w-4", styles.feedbackIcon)} /> {error}
                </div>
              )}
            </div>

            {showWorkbench && metadataGroups.length > 0 && (
              <nav className={styles.groupRail} aria-label="Metadata groups">
                <span className={styles.groupRailTitle}>Groups</span>
                <div className={styles.groupList}>
                  {metadataGroups.map(([group, entries]) => (
                    <button
                      key={group}
                      type="button"
                      className={cn(
                        styles.groupButton,
                        !metadataQuery.trim() && activeGroup === group && styles.groupButtonActive,
                      )}
                      onClick={() => {
                        setActiveGroup(group);
                        setMetadataQuery("");
                      }}
                      aria-pressed={!metadataQuery.trim() && activeGroup === group}
                      disabled={isBusy}
                    >
                      <span>{group}</span>
                      <span>{entries.length}</span>
                    </button>
                  ))}
                </div>
              </nav>
            )}
          </aside>

          {showWorkbench && (
            <div className={styles.resultsColumn}>
              {report && (
                <section
                  className={cn(styles.report, report.unresolved.length > 0 && styles.reportWarning)}
                  aria-labelledby="verification-title"
                >
                  <div className={styles.reportHeader}>
                    {report.unresolved.length > 0 ? (
                      <WarningIcon className="h-5 w-5" />
                    ) : (
                      <CheckCircleIcon className="h-5 w-5" />
                    )}
                    <div>
                      <p id="verification-title" className={styles.reportTitle}>
                        {report.unresolved.length > 0 ? "Unresolved fields" : "Cleaning verified"}
                      </p>
                      <p className={styles.reportText}>
                        {report.unresolved.length > 0 ? "Download paused" : "Download started"}
                      </p>
                    </div>
                  </div>
                  <div className={styles.reportStats}>
                    <span>
                      <strong>{report.removed.length}</strong> removed
                    </span>
                    <span>
                      <strong>{report.notSelected.length}</strong> not selected
                    </span>
                    <span>
                      <strong>{report.unresolved.length}</strong> unresolved
                    </span>
                  </div>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button type="button" variant="secondary" className={styles.reportDetailsTrigger}>
                        View details <ChevronRightIcon className="h-3.5 w-3.5" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent size="large" className={styles.reportDialog}>
                      <DialogHeader>
                        <DialogTitle>Cleaning report</DialogTitle>
                        <DialogDescription className={styles.visuallyHidden}>
                          Metadata fields removed, not selected, or left unresolved after cleaning.
                        </DialogDescription>
                      </DialogHeader>
                      <div className={styles.reportSections}>
                        {[
                          {
                            label: "Removed",
                            entries: report.removed,
                            tone: styles.reportSectionRemoved,
                          },
                          {
                            label: "Not selected",
                            entries: report.notSelected,
                            tone: styles.reportSectionNotSelected,
                          },
                          {
                            label: "Unresolved",
                            entries: report.unresolved,
                            tone: styles.reportSectionUnresolved,
                          },
                        ]
                          .filter(({ entries }) => entries.length > 0)
                          .map(({ label, entries, tone }) => (
                            <section key={label} className={cn(styles.reportSection, tone)}>
                              <header className={styles.reportSectionHeader}>
                                <h3>{label}</h3>
                                <span>{entries.length}</span>
                              </header>
                              <ul className={styles.reportEntryList}>
                                {entries.map((entry) => (
                                  <li key={entry.id} className={styles.reportEntry}>
                                    <span className={styles.reportEntryName}>{entry.label}</span>
                                    {duplicateMetadataLabels.has(normalizeMetadataLabel(entry.label)) && (
                                      <span className={styles.reportEntryOrigin}>{entry.sourceLabel}</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </section>
                          ))}
                      </div>
                    </DialogContent>
                  </Dialog>
                  {report.unresolved.length > 0 && (
                    <Button
                      variant="secondary"
                      className={styles.reportWarningAction}
                      onClick={() => pendingDownload && downloadBlob(pendingDownload.blob, pendingDownload.fileName)}
                      disabled={!pendingDownload}
                    >
                      <DownloadIcon className="h-4 w-4" /> Download with warning
                    </Button>
                  )}
                </section>
              )}

              <section className={styles.metadataPanel} aria-labelledby="metadata-panel-title">
                <div className={styles.metadataHeader}>
                  <div>
                    <h2 id="metadata-panel-title">Metadata</h2>
                    {metadataEntries.length > 0 && (
                      <p>
                        {removableEntries.length} removable · {protectedCount} protected
                      </p>
                    )}
                  </div>
                  {metadataEntries.length > 0 && (
                    <Input
                      value={metadataQuery}
                      onChange={(event) => setMetadataQuery(event.target.value)}
                      placeholder="Search metadata"
                      aria-label="Search metadata fields or values"
                      variant="soft"
                      className={styles.metadataSearch}
                      disabled={isBusy}
                    >
                      <InputSlot side="left">
                        <MagnifyingGlassIcon className="h-4 w-4" />
                      </InputSlot>
                    </Input>
                  )}
                </div>

                {metadataEntries.length > 0 ? (
                  <div key={inspectionRevision} className={styles.metadataBrowser}>
                    <div className={styles.metadataContent}>
                      <ScrollArea className={styles.metadataScroll}>
                        <div className={styles.metadataScrollInner}>
                          {visibleGroups.length > 0 ? (
                            visibleGroups.map(([group, entries]) => {
                              const selectable = entries.filter((entry) => !entry.protected);
                              return (
                                <section key={group} className={styles.metadataGroup}>
                                  <div className={styles.metadataGroupHeader}>
                                    <div className={styles.metadataGroupTitle}>
                                      <h3>{group}</h3>
                                      <span>
                                        {entries.length} {entries.length === 1 ? "field" : "fields"}
                                      </span>
                                    </div>
                                    {selectable.length > 0 && (
                                      <div className={styles.metadataGroupActions}>
                                        <button
                                          type="button"
                                          onClick={() => selectGroup(selectable, true)}
                                          className={styles.metadataGroupButton}
                                          disabled={isBusy}
                                        >
                                          Select all
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => selectGroup(selectable, false)}
                                          className={styles.metadataGroupButton}
                                          disabled={isBusy}
                                        >
                                          Clear
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <div className={styles.metadataList}>
                                    {entries.map((entry) => {
                                      const MetadataRow = entry.protected ? "div" : "label";
                                      return (
                                        <MetadataRow
                                          key={entry.id}
                                          className={cn(
                                            styles.metadataRow,
                                            entry.protected && styles.metadataRowProtected,
                                            selectedMetadata.has(entry.id) && styles.metadataRowSelected,
                                          )}
                                        >
                                          {entry.protected ? (
                                            <span
                                              className={styles.metadataProtectedControl}
                                              title={entry.protectionReason}
                                              role="img"
                                              aria-label={
                                                entry.protectionReason
                                                  ? `Protected metadata: ${entry.protectionReason}`
                                                  : "Protected metadata"
                                              }
                                            >
                                              <LockIcon aria-hidden="true" />
                                            </span>
                                          ) : (
                                            <input
                                              type="checkbox"
                                              checked={selectedMetadata.has(entry.id)}
                                              disabled={isBusy}
                                              onChange={() => toggleMetadataSelection(entry)}
                                              className={styles.metadataCheckbox}
                                            />
                                          )}
                                          <span className={styles.metadataField}>
                                            <span className={styles.metadataKey}>{entry.label}</span>
                                            {duplicateMetadataLabels.has(normalizeMetadataLabel(entry.label)) && (
                                              <span className={styles.metadataOrigin}>{entry.sourceLabel}</span>
                                            )}
                                          </span>
                                          <span className={styles.metadataValue} title={entry.value}>
                                            {entry.value}
                                          </span>
                                        </MetadataRow>
                                      );
                                    })}
                                  </div>
                                </section>
                              );
                            })
                          ) : (
                            <div className={styles.noResults}>No matching metadata</div>
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyMetadata} role="status" aria-live="polite">
                    <div className={styles.emptyMetadataIcon}>
                      {isBusy ? (
                        <div className={styles.spinner} />
                      ) : mode === "image" ? (
                        <ImageIcon className="h-5 w-5" />
                      ) : (
                        <FilmStripIcon className="h-5 w-5" />
                      )}
                    </div>
                    <p>
                      {!file
                        ? "Select a file to begin"
                        : isBusy
                          ? processingState === "uploading"
                            ? "Uploading file…"
                            : "Inspecting metadata…"
                          : waitingForServerInspection
                            ? serverTooLarge
                              ? "Server limit exceeded"
                              : "Inspect the file to continue"
                            : metadataError
                              ? "Metadata unavailable"
                              : inspectionComplete
                                ? "No metadata found"
                                : "Ready to inspect"}
                    </p>
                  </div>
                )}

                {metadataEntries.length > 0 && (
                  <footer className={styles.metadataFooter} aria-live="polite" aria-atomic="true">
                    <span className={cn(styles.selectionStatus, selectedCount > 0 && styles.selectionStatusActive)}>
                      <CheckCircleIcon className={styles.selectionStatusIcon} aria-hidden="true" />
                      <span className={styles.selectionStatusCopy}>
                        <strong>{selectedCount}</strong>
                        <span>{selectedCount === 1 ? "field selected" : "fields selected"}</span>
                      </span>
                    </span>
                  </footer>
                )}
              </section>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
