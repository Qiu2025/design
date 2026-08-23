"use client";

import { MockFrame, DeviceOptions, type DeviceName, type MockFrameProps } from "react-mockframe";
import { DownloadIcon, ImageIcon, RotateClockwiseIcon, TrashIcon } from "@raycast/icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";

import { NavigationActions } from "@/components/navigation";
import { Button } from "@/components/button";
import { cn } from "@/utils/cn";
import { toPng } from "../(code)/lib/image";

import styles from "./mockup-maker.module.css";

const DEVICE_GROUPS: { label: string; devices: DeviceName[] }[] = [
  { label: "Phones", devices: ["iPhone 17", "iPhone X", "Pixel 10", "Galaxy S25", "iPhone 8", "iPhone 8 Plus"] },
  { label: "Tablets", devices: ["iPad Pro", "iPad Mini"] },
  { label: "Laptops", devices: ["MacBook Pro", "MacBook Pro 2020"] },
];

const BACKGROUND_PRESETS = [
  { label: "Ink", value: "#17181c" },
  { label: "Cloud", value: "#e8e9ed" },
  { label: "Lilac", value: "#c9c2f7" },
  { label: "Peach", value: "#f2c5a5" },
  { label: "Mint", value: "#b8e5d1" },
];

const DEFAULT_DEVICE: DeviceName = "iPhone 17";

const DEFAULT_DEVICE_COLORS: Partial<Record<DeviceName, string>> = {
  "iPhone 17": "black",
  "iPhone 8": "black",
  "iPhone 8 Plus": "black",
  "Pixel 10": "obsidian",
  "Galaxy S25": "phantom-black",
  "iPad Pro": "space-gray",
  "iPad Mini": "black",
  "MacBook Pro": "space-gray",
};

const DEVICE_COLOR_VALUES: Record<string, string> = {
  black: "#17181c",
  white: "#f4f4f1",
  silver: "#b9bec6",
  gold: "#d7b38d",
  "mist-blue": "#9db8ce",
  sage: "#aabca7",
  lavender: "#b4a8c7",
  "cosmic-orange": "#c56f4c",
  "deep-blue": "#415776",
  obsidian: "#25282d",
  porcelain: "#e4e3dd",
  mint: "#a9c9b7",
  rose: "#c99ca3",
  "phantom-black": "#202126",
  "icy-blue": "#93afc6",
  navy: "#32465e",
  "space-gray": "#777d85",
};

function getInitialColor(device: DeviceName) {
  const colors = DeviceOptions[device].colors;
  return DEFAULT_DEVICE_COLORS[device] ?? colors[0];
}

function getInitialFrameScale(device: DeviceName) {
  if (device.startsWith("MacBook")) return 0.56;
  if (device.startsWith("iPad")) return 0.56;
  return 0.58;
}

function getFrameBaseWidth(device: DeviceName, landscape: boolean) {
  if (device.startsWith("MacBook")) return 1188;
  if (device.startsWith("iPad")) return landscape ? 948 : 626;
  return 480;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The image could not be read."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}

function formatColorName(color: string) {
  return color
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getSwatchColor(color: string) {
  return DEVICE_COLOR_VALUES[color] ?? color;
}

export function MockupMaker() {
  const [selectedDevice, setSelectedDevice] = useState<DeviceName>(DEFAULT_DEVICE);
  const [selectedColor, setSelectedColor] = useState<string | undefined>(getInitialColor(DEFAULT_DEVICE));
  const [landscape, setLandscape] = useState(false);
  const [hideNotch, setHideNotch] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [imageFit, setImageFit] = useState<"cover" | "contain">("contain");
  const [imageScale, setImageScale] = useState(1);
  const [imagePositionX, setImagePositionX] = useState(0);
  const [imagePositionY, setImagePositionY] = useState(0);
  const [frameScale, setFrameScale] = useState(getInitialFrameScale(DEFAULT_DEVICE));
  const [background, setBackground] = useState(BACKGROUND_PRESETS[0].value);
  const [transparentBackground, setTransparentBackground] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const colorOptions = useMemo(() => Array.from(DeviceOptions[selectedDevice].colors), [selectedDevice]);
  const supportsLandscape = DeviceOptions[selectedDevice].hasLandscape;
  const deviceDimensions =
    landscape && supportsLandscape
      ? `${DeviceOptions[selectedDevice].height} × ${DeviceOptions[selectedDevice].width}`
      : `${DeviceOptions[selectedDevice].width} × ${DeviceOptions[selectedDevice].height}`;
  const maxFrameScale = canvasWidth
    ? Math.max(0.1, (canvasWidth - 32) / getFrameBaseWidth(selectedDevice, landscape))
    : 1;
  const effectiveFrameScale = Math.min(frameScale, maxFrameScale);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;

    const updateCanvasWidth = () => setCanvasWidth(canvasRef.current?.clientWidth ?? 0);
    const observer = new ResizeObserver(updateCanvasWidth);
    observer.observe(canvasRef.current);
    updateCanvasWidth();

    return () => observer.disconnect();
  }, []);

  const loadImage = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Choose a PNG, JPG, WebP or another image file.");
      return;
    }

    setIsReading(true);
    setError(null);

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setImageUrl(dataUrl);
      setImageName(file.name || "Screenshot");
      setImageScale(1);
      setImagePositionX(0);
      setImagePositionY(0);
    } catch {
      setError("The image could not be read. Try another file.");
    } finally {
      setIsReading(false);
    }
  }, []);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((clipboardItem) =>
        clipboardItem.type.startsWith("image/"),
      );
      const file = item?.getAsFile();

      if (file) {
        event.preventDefault();
        void loadImage(file);
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [loadImage]);

  const handleDeviceChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextDevice = event.target.value as DeviceName;
    setSelectedDevice(nextDevice);
    setSelectedColor(getInitialColor(nextDevice));
    setFrameScale(getInitialFrameScale(nextDevice));
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void loadImage(file);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void loadImage(file);
  };

  const handleExport = async () => {
    if (!canvasRef.current || !imageUrl) return;

    setIsExporting(true);
    setError(null);

    try {
      const dataUrl = await toPng(canvasRef.current, {
        pixelRatio: 2,
        style: { background: transparentBackground ? "transparent" : background },
      });
      const link = document.createElement("a");
      const baseName = imageName?.replace(/\.[^/.]+$/, "") || "mockup";
      link.download = `${baseName}-${selectedDevice.toLowerCase().replaceAll(" ", "-")}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      setError("The mockup could not be exported. Try again or use a smaller image.");
    } finally {
      setIsExporting(false);
    }
  };

  const clearImage = () => {
    setImageUrl(null);
    setImageName(null);
    setError(null);
  };

  const frameProps = {
    device: selectedDevice,
    ...(selectedColor ? { color: selectedColor } : {}),
    ...(supportsLandscape ? { landscape } : {}),
    hideNotch,
    className: styles.deviceFrame,
  } as MockFrameProps;

  const screenContent = imageUrl ? (
    // Local data URLs are intentionally rendered without Next image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt={imageName ? `Preview of ${imageName}` : "Screenshot preview"}
      className={styles.screenImage}
      style={{
        objectFit: imageFit,
        objectPosition: `${50 + imagePositionX}% ${50 + imagePositionY}%`,
        transform: `scale(${imageScale})`,
      }}
    />
  ) : (
    <div className={styles.screenPlaceholder}>
      <ImageIcon className="h-5 w-5" />
      <span>Your screenshot</span>
    </div>
  );

  return (
    <>
      <NavigationActions>
        {isMounted && (
          <Button
            variant="primary"
            onClick={handleExport}
            disabled={!imageUrl || isReading || isExporting}
            aria-busy={isExporting}
          >
            <DownloadIcon className="h-4 w-4" />
            {isExporting ? "Exporting" : "Download PNG"}
          </Button>
        )}
      </NavigationActions>

      <main className={styles.container}>
        <header className={styles.header}>
          <div>
            <h1>Mockup Maker</h1>
            <p>Place a screenshot inside a phone, tablet or laptop frame.</p>
          </div>
        </header>

        <div className={styles.workspace}>
          <aside className={styles.sidebar} aria-label="Mockup controls">
            <section className={styles.controlSection} aria-labelledby="image-section-title">
              <div className={styles.sectionHeading}>
                <h2 id="image-section-title">Screenshot</h2>
                {imageUrl && (
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={clearImage}
                    aria-label="Remove screenshot"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
              <label
                htmlFor="mockup-file"
                className={cn(
                  styles.dropZone,
                  isDragging && styles.dropZoneDragging,
                  imageUrl && styles.dropZoneFilled,
                )}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (event.currentTarget === event.target) setIsDragging(false);
                }}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  id="mockup-file"
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className={styles.visuallyHidden}
                />
                <ImageIcon className="h-5 w-5" />
                <span className={styles.dropTitle}>
                  {isReading ? "Reading image…" : imageName || "Drop a screenshot here"}
                </span>
                <span className={styles.dropHint}>Click to browse or paste with ⌘V / Ctrl+V</span>
              </label>
              {error && (
                <p className={styles.errorMessage} role="alert">
                  {error}
                </p>
              )}
            </section>

            <section className={styles.controlSection} aria-labelledby="device-section-title">
              <div className={styles.sectionHeading}>
                <h2 id="device-section-title">Device</h2>
              </div>
              <select
                className={styles.select}
                value={selectedDevice}
                onChange={handleDeviceChange}
                aria-label="Device"
              >
                {DEVICE_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.devices.map((device) => (
                      <option key={device} value={device}>
                        {device}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              <div className={styles.subControl}>
                <span className={styles.controlLabel}>Dimensions</span>
                <span className={styles.controlLabel}>{deviceDimensions} px</span>
              </div>

              {colorOptions.length > 0 && (
                <div className={styles.subControl}>
                  <span className={styles.controlLabel}>Finish</span>
                  <div className={styles.colorRow} role="group" aria-label="Device finish">
                    {colorOptions.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={cn(styles.colorSwatch, selectedColor === color && styles.colorSwatchSelected)}
                        style={{ background: getSwatchColor(color) }}
                        onClick={() => setSelectedColor(color)}
                        aria-label={formatColorName(color)}
                        aria-pressed={selectedColor === color}
                      />
                    ))}
                  </div>
                </div>
              )}

              {supportsLandscape && (
                <div className={styles.optionRow}>
                  <span className={styles.controlLabel}>Orientation</span>
                  <button type="button" className={styles.toggleButton} onClick={() => setLandscape((value) => !value)}>
                    <RotateClockwiseIcon className="h-4 w-4" />
                    {landscape ? "Landscape" : "Portrait"}
                  </button>
                </div>
              )}

              {(selectedDevice === "iPhone 17" ||
                selectedDevice === "iPhone X" ||
                selectedDevice === "MacBook Pro") && (
                <label className={styles.checkboxRow}>
                  <input type="checkbox" checked={hideNotch} onChange={(event) => setHideNotch(event.target.checked)} />
                  Hide notch / camera
                </label>
              )}
            </section>

            <section className={styles.controlSection} aria-labelledby="image-controls-title">
              <div className={styles.sectionHeading}>
                <h2 id="image-controls-title">Image</h2>
              </div>
              <div className={styles.segmentedControl} role="group" aria-label="Image fit">
                {(["contain", "cover"] as const).map((fit) => (
                  <button
                    key={fit}
                    type="button"
                    className={cn(styles.segmentButton, imageFit === fit && styles.segmentButtonActive)}
                    onClick={() => setImageFit(fit)}
                    aria-pressed={imageFit === fit}
                  >
                    {fit === "contain" ? "Fit" : "Fill"}
                  </button>
                ))}
              </div>
              <label className={styles.rangeRow}>
                <span>
                  Image scale <output>{imageScale.toFixed(2)}×</output>
                </span>
                <input
                  type="range"
                  min="0.8"
                  max="2"
                  step="0.01"
                  value={imageScale}
                  onChange={(event) => setImageScale(Number(event.target.value))}
                />
              </label>
              <label className={styles.rangeRow}>
                <span>
                  Horizontal position <output>{imagePositionX}%</output>
                </span>
                <input
                  type="range"
                  min="-40"
                  max="40"
                  step="1"
                  value={imagePositionX}
                  onChange={(event) => setImagePositionX(Number(event.target.value))}
                />
              </label>
              <label className={styles.rangeRow}>
                <span>
                  Vertical position <output>{imagePositionY}%</output>
                </span>
                <input
                  type="range"
                  min="-40"
                  max="40"
                  step="1"
                  value={imagePositionY}
                  onChange={(event) => setImagePositionY(Number(event.target.value))}
                />
              </label>
            </section>

            <section className={styles.controlSection} aria-labelledby="background-title">
              <div className={styles.sectionHeading}>
                <h2 id="background-title">Background</h2>
              </div>
              <div className={styles.backgroundGrid}>
                {BACKGROUND_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    className={cn(
                      styles.backgroundSwatch,
                      !transparentBackground && background === preset.value && styles.backgroundSwatchSelected,
                    )}
                    style={{ background: preset.value }}
                    onClick={() => {
                      setBackground(preset.value);
                      setTransparentBackground(false);
                    }}
                    aria-label={preset.label}
                    aria-pressed={!transparentBackground && background === preset.value}
                  />
                ))}
                <button
                  type="button"
                  className={cn(
                    styles.backgroundSwatch,
                    styles.checkerSwatch,
                    transparentBackground && styles.backgroundSwatchSelected,
                  )}
                  onClick={() => setTransparentBackground((value) => !value)}
                  aria-label="Transparent background"
                  aria-pressed={transparentBackground}
                />
              </div>
              <label className={styles.customColorControl}>
                <span className={styles.customColorSwatch} style={{ background }} aria-hidden="true" />
                <span>Custom color</span>
                <output>{background.toUpperCase()}</output>
                <input
                  type="color"
                  value={background}
                  onChange={(event) => {
                    setBackground(event.target.value);
                    setTransparentBackground(false);
                  }}
                  className={styles.visuallyHidden}
                  aria-label="Custom background color"
                />
              </label>
              <label className={styles.rangeRow}>
                <span>
                  Frame size
                  <output>
                    {Math.round(frameScale * 100)}%{effectiveFrameScale < frameScale ? " · fit" : ""}
                  </output>
                </span>
                <input
                  type="range"
                  min="0.3"
                  max="0.85"
                  step="0.01"
                  value={frameScale}
                  onChange={(event) => setFrameScale(Number(event.target.value))}
                />
              </label>
            </section>
          </aside>

          <section className={styles.previewColumn} aria-label="Mockup preview">
            <div
              ref={canvasRef}
              className={cn(styles.canvas, transparentBackground && styles.canvasTransparent)}
              style={transparentBackground ? undefined : { background }}
            >
              <div className={styles.canvasLabel}>Preview</div>
              <div className={styles.frameCenter}>
                <div
                  className={styles.frameRenderer}
                  style={{ transform: `translate(-50%, -50%) scale(${effectiveFrameScale})` }}
                >
                  <MockFrame {...frameProps}>{screenContent}</MockFrame>
                </div>
              </div>
              {!imageUrl && <p className={styles.canvasHint}>Upload a screenshot to start creating your mockup.</p>}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
