"use client";

import { MockFrame, DeviceOptions, type DeviceName, type MockFrameProps } from "react-mockframe";
import { DownloadIcon, ImageIcon, RotateClockwiseIcon, TrashIcon } from "@raycast/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

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

const DEFAULT_GRADIENT_START = "#7c3aed";
const DEFAULT_GRADIENT_END = "#f59e0b";

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

type HsvColor = {
  hue: number;
  saturation: number;
  value: number;
};

type BackgroundMode = "solid" | "gradient";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isHexColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function isGradientBackground(value: string) {
  return value.includes("gradient(");
}

function hexToHsv(hex: string): HsvColor {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = ((value >> 16) & 255) / 255;
  const green = ((value >> 8) & 255) / 255;
  const blue = (value & 255) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }

  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation: max ? delta / max : 0,
    value: max,
  };
}

function hsvToHex({ hue, saturation, value }: HsvColor) {
  const chroma = value * saturation;
  const match = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = value - chroma;
  const [red, green, blue] =
    hue < 60
      ? [chroma, match, 0]
      : hue < 120
        ? [match, chroma, 0]
        : hue < 180
          ? [0, chroma, match]
          : hue < 240
            ? [0, match, chroma]
            : hue < 300
              ? [match, 0, chroma]
              : [chroma, 0, match];
  const toHex = (channel: number) =>
    Math.round((channel + offset) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
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
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>("solid");
  const [customColorValue, setCustomColorValue] = useState(BACKGROUND_PRESETS[0].value);
  const [colorPickerHsv, setColorPickerHsv] = useState(() => hexToHsv(BACKGROUND_PRESETS[0].value));
  const [gradientStart, setGradientStart] = useState(DEFAULT_GRADIENT_START);
  const [gradientEnd, setGradientEnd] = useState(DEFAULT_GRADIENT_END);
  const [gradientAngle, setGradientAngle] = useState(135);
  const [activeGradientStop, setActiveGradientStop] = useState<"start" | "end">("start");
  const [transparentBackground, setTransparentBackground] = useState(true);
  const [isCustomColorOpen, setIsCustomColorOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const customColorRef = useRef<HTMLDivElement>(null);
  const customColorPopoverRef = useRef<HTMLDivElement>(null);
  const customColorDragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [customColorPosition, setCustomColorPosition] = useState<{ top: number; left: number } | null>(null);
  const [isCustomColorDragging, setIsCustomColorDragging] = useState(false);

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
  const isCustomBackground =
    !transparentBackground &&
    (backgroundMode === "gradient" ||
      !BACKGROUND_PRESETS.some((preset) => preset.value.toLowerCase() === background.toLowerCase()));

  const activeGradientColor = activeGradientStop === "start" ? gradientStart : gradientEnd;
  const gradientBackground = `linear-gradient(${gradientAngle}deg, ${gradientStart} 0%, ${gradientEnd} 100%)`;

  const updateBackground = (value: string) => {
    setBackground(value);
    setBackgroundMode("solid");
    setCustomColorValue(value);
    setTransparentBackground(false);
  };

  const updateGradient = (start: string, end: string, angle = gradientAngle) => {
    setBackground(`linear-gradient(${angle}deg, ${start} 0%, ${end} 100%)`);
    setBackgroundMode("gradient");
    setTransparentBackground(false);
  };

  const activateGradient = () => {
    const start = isHexColor(background) ? background : gradientStart;
    setGradientStart(start);
    setActiveGradientStop("start");
    setCustomColorValue(start);
    setColorPickerHsv(hexToHsv(start));
    updateGradient(start, gradientEnd);
  };

  const activateSolid = () => {
    if (backgroundMode === "solid") return;
    updateBackground(activeGradientColor);
    setColorPickerHsv(hexToHsv(activeGradientColor));
  };

  const updateGradientStop = (value: string) => {
    const start = activeGradientStop === "start" ? value : gradientStart;
    const end = activeGradientStop === "end" ? value : gradientEnd;
    if (activeGradientStop === "start") setGradientStart(value);
    else setGradientEnd(value);
    setCustomColorValue(value);
    updateGradient(start, end);
  };

  const handleCustomColorTextChange = (value: string) => {
    setCustomColorValue(value);
    if (isHexColor(value)) {
      if (backgroundMode === "gradient") updateGradientStop(value);
      else updateBackground(value);
      setColorPickerHsv(hexToHsv(value));
    }
  };

  const applyColorPickerValue = (value: HsvColor) => {
    setColorPickerHsv(value);
    const hex = hsvToHex(value);
    if (backgroundMode === "gradient") updateGradientStop(hex);
    else updateBackground(hex);
  };

  const handleColorPickerOpen = () => {
    if (!isCustomColorOpen) {
      const color = backgroundMode === "gradient" ? activeGradientColor : background;
      setColorPickerHsv(hexToHsv(color));
    }
    setIsCustomColorOpen((value) => !value);
  };

  const handleCustomColorWindowPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button") || !customColorPosition) return;

    customColorDragRef.current = {
      offsetX: event.clientX - customColorPosition.left,
      offsetY: event.clientY - customColorPosition.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsCustomColorDragging(true);
  };

  const handleCustomColorWindowPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = customColorDragRef.current;
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;

    const popoverWidth = 230;
    const popoverHeight = 280;
    setCustomColorPosition({
      top: clamp(event.clientY - drag.offsetY, 12, Math.max(12, window.innerHeight - popoverHeight - 12)),
      left: clamp(event.clientX - drag.offsetX, 12, Math.max(12, window.innerWidth - popoverWidth - 12)),
    });
  };

  const handleCustomColorWindowPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    customColorDragRef.current = null;
    setIsCustomColorDragging(false);
  };

  const updateSaturationAndValue = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    applyColorPickerValue({
      ...colorPickerHsv,
      saturation: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      value: clamp(1 - (event.clientY - bounds.top) / bounds.height, 0, 1),
    });
  };

  const updateHue = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    applyColorPickerValue({
      ...colorPickerHsv,
      hue: clamp(((event.clientX - bounds.left) / bounds.width) * 360, 0, 360),
    });
  };

  const handleSaturationAndValueKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = 0.05;
    const next = { ...colorPickerHsv };

    if (event.key === "ArrowLeft") next.saturation -= step;
    else if (event.key === "ArrowRight") next.saturation += step;
    else if (event.key === "ArrowDown") next.value -= step;
    else if (event.key === "ArrowUp") next.value += step;
    else return;

    event.preventDefault();
    applyColorPickerValue({
      ...next,
      saturation: clamp(next.saturation, 0, 1),
      value: clamp(next.value, 0, 1),
    });
  };

  const handleHueKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = 5;
    let hue = colorPickerHsv.hue;

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") hue -= step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") hue += step;
    else return;

    event.preventDefault();
    applyColorPickerValue({ ...colorPickerHsv, hue: (hue + 360) % 360 });
  };

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isCustomColorOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!customColorRef.current?.contains(target) && !customColorPopoverRef.current?.contains(target)) {
        setIsCustomColorOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsCustomColorOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCustomColorOpen]);

  useEffect(() => {
    if (!isCustomColorOpen) {
      setCustomColorPosition(null);
      return;
    }

    const updateCustomColorPosition = () => {
      const preview = canvasRef.current;
      if (!preview) return;

      const bounds = preview.getBoundingClientRect();
      const popoverWidth = 230;
      const popoverHeight = 280;
      const inset = 16;
      setCustomColorPosition({
        top: clamp(bounds.top + inset, 12, Math.max(12, window.innerHeight - popoverHeight - 12)),
        left: clamp(bounds.right - popoverWidth - inset, 12, Math.max(12, window.innerWidth - popoverWidth - 12)),
      });
    };

    updateCustomColorPosition();
    window.addEventListener("resize", updateCustomColorPosition);
    document.addEventListener("scroll", updateCustomColorPosition, true);
    return () => {
      window.removeEventListener("resize", updateCustomColorPosition);
      document.removeEventListener("scroll", updateCustomColorPosition, true);
    };
  }, [isCustomColorOpen]);

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
              <div className={styles.backgroundControls} ref={customColorRef}>
                <div className={styles.backgroundGrid}>
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
                  {BACKGROUND_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      className={cn(
                        styles.backgroundSwatch,
                        !transparentBackground && background === preset.value && styles.backgroundSwatchSelected,
                      )}
                      style={{ background: preset.value }}
                      onClick={() => updateBackground(preset.value)}
                      aria-label={preset.label}
                      aria-pressed={!transparentBackground && background === preset.value}
                    />
                  ))}
                  <button
                    type="button"
                    className={cn(styles.customColorTrigger, isCustomBackground && styles.customColorTriggerSelected)}
                    onClick={handleColorPickerOpen}
                    aria-expanded={isCustomColorOpen}
                    aria-controls="custom-background-popover"
                    aria-pressed={isCustomBackground}
                  >
                    <span>Custom</span>
                    <span
                      className={cn(
                        styles.customColorTriggerIcon,
                        isCustomBackground && styles.customColorTriggerSwatch,
                      )}
                      style={
                        isCustomBackground
                          ? { background: backgroundMode === "gradient" ? gradientBackground : background }
                          : undefined
                      }
                      aria-hidden="true"
                    >
                      {!isCustomBackground && "+"}
                    </span>
                  </button>
                </div>
                {isCustomColorOpen &&
                  customColorPosition &&
                  createPortal(
                    <div
                      ref={customColorPopoverRef}
                      id="custom-background-popover"
                      className={cn(
                        styles.customColorPopover,
                        isCustomColorDragging && styles.customColorPopoverDragging,
                      )}
                      role="dialog"
                      aria-label="Custom background color"
                      style={{ top: customColorPosition.top, left: customColorPosition.left }}
                    >
                      <div
                        className={styles.customColorPopoverHeader}
                        onPointerDown={handleCustomColorWindowPointerDown}
                        onPointerMove={handleCustomColorWindowPointerMove}
                        onPointerUp={handleCustomColorWindowPointerUp}
                        onPointerCancel={handleCustomColorWindowPointerUp}
                      >
                        <span>Custom background</span>
                        <button
                          type="button"
                          className={styles.customColorClose}
                          onClick={() => setIsCustomColorOpen(false)}
                          aria-label="Close custom color"
                        >
                          ×
                        </button>
                      </div>
                      <div className={styles.customColorModes} role="tablist" aria-label="Background type">
                        <button
                          type="button"
                          className={cn(
                            styles.customColorMode,
                            backgroundMode === "solid" && styles.customColorModeActive,
                          )}
                          onClick={activateSolid}
                          role="tab"
                          aria-selected={backgroundMode === "solid"}
                        >
                          Solid
                        </button>
                        <button
                          type="button"
                          className={cn(
                            styles.customColorMode,
                            backgroundMode === "gradient" && styles.customColorModeActive,
                          )}
                          onClick={activateGradient}
                          role="tab"
                          aria-selected={backgroundMode === "gradient"}
                        >
                          Gradient
                        </button>
                      </div>
                      {backgroundMode === "gradient" && (
                        <div className={styles.gradientOptions}>
                          <div
                            className={styles.gradientPreview}
                            style={{ backgroundImage: gradientBackground }}
                            aria-label="Gradient preview"
                          />
                          <div className={styles.gradientStops} aria-label="Gradient colors">
                            <button
                              type="button"
                              className={cn(
                                styles.gradientStop,
                                activeGradientStop === "start" && styles.gradientStopActive,
                              )}
                              onClick={() => {
                                setActiveGradientStop("start");
                                setCustomColorValue(gradientStart);
                                setColorPickerHsv(hexToHsv(gradientStart));
                              }}
                              aria-label="First gradient color"
                              aria-pressed={activeGradientStop === "start"}
                            >
                              <span>Start</span>
                              <span className={styles.gradientStopSwatch} style={{ background: gradientStart }} />
                            </button>
                            <span className={styles.gradientStopsArrow} aria-hidden="true">
                              →
                            </span>
                            <button
                              type="button"
                              className={cn(
                                styles.gradientStop,
                                activeGradientStop === "end" && styles.gradientStopActive,
                              )}
                              onClick={() => {
                                setActiveGradientStop("end");
                                setCustomColorValue(gradientEnd);
                                setColorPickerHsv(hexToHsv(gradientEnd));
                              }}
                              aria-label="Second gradient color"
                              aria-pressed={activeGradientStop === "end"}
                            >
                              <span>End</span>
                              <span className={styles.gradientStopSwatch} style={{ background: gradientEnd }} />
                            </button>
                          </div>
                          <label className={styles.gradientAngle}>
                            <span>
                              Angle <output>{gradientAngle}°</output>
                            </span>
                            <input
                              type="range"
                              min="0"
                              max="360"
                              value={gradientAngle}
                              onChange={(event) => {
                                const angle = Number(event.target.value);
                                setGradientAngle(angle);
                                updateGradient(gradientStart, gradientEnd, angle);
                              }}
                            />
                          </label>
                        </div>
                      )}
                      <div
                        className={styles.customColorArea}
                        role="slider"
                        tabIndex={0}
                        aria-label="Saturation and brightness"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(colorPickerHsv.saturation * 100)}
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId);
                          updateSaturationAndValue(event);
                        }}
                        onPointerMove={(event) => {
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSaturationAndValue(event);
                        }}
                        onKeyDown={handleSaturationAndValueKeyDown}
                        style={{
                          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${colorPickerHsv.hue} 100% 50%))`,
                        }}
                      >
                        <span
                          className={styles.customColorAreaCursor}
                          style={{
                            left: `${colorPickerHsv.saturation * 100}%`,
                            top: `${(1 - colorPickerHsv.value) * 100}%`,
                          }}
                          aria-hidden="true"
                        />
                      </div>
                      <div
                        className={styles.customColorHue}
                        role="slider"
                        tabIndex={0}
                        aria-label="Hue"
                        aria-valuemin={0}
                        aria-valuemax={360}
                        aria-valuenow={Math.round(colorPickerHsv.hue)}
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId);
                          updateHue(event);
                        }}
                        onPointerMove={(event) => {
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) updateHue(event);
                        }}
                        onKeyDown={handleHueKeyDown}
                      >
                        <span
                          className={styles.customColorHueCursor}
                          style={{ left: `${(colorPickerHsv.hue / 360) * 100}%` }}
                          aria-hidden="true"
                        />
                      </div>
                      <div className={styles.customColorFields}>
                        <span
                          className={styles.customColorPreview}
                          style={{ background: backgroundMode === "gradient" ? activeGradientColor : background }}
                          aria-hidden="true"
                        />
                        <label className={styles.hexField}>
                          <span>HEX</span>
                          <input
                            type="text"
                            value={customColorValue}
                            maxLength={7}
                            spellCheck={false}
                            onChange={(event) => handleCustomColorTextChange(event.target.value)}
                            onBlur={() => {
                              if (!/^#[0-9a-f]{6}$/i.test(customColorValue)) setCustomColorValue(background);
                            }}
                            aria-label="Hex color value"
                          />
                        </label>
                      </div>
                    </div>,
                    document.body,
                  )}
              </div>
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
            <div className={styles.canvasLabel}>Preview</div>
            <div
              ref={canvasRef}
              className={cn(styles.canvas, transparentBackground && styles.canvasTransparent)}
              style={
                transparentBackground
                  ? undefined
                  : {
                      backgroundColor: isGradientBackground(background) ? undefined : background,
                      backgroundImage: isGradientBackground(background) ? background : undefined,
                    }
              }
            >
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
