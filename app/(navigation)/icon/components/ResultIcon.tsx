import React, { useId } from "react";

import noisePicture from "../assets/noise.inline.png";

import { SettingsType } from "../lib/types";

type PropTypes = {
  settings: SettingsType;
  size?: number;
  isPreview?: boolean;
  // TODO: fix icon type?
  IconComponent?: React.FC<React.SVGProps<SVGSVGElement>>;
};

const getFiniteNumber = (value: unknown, fallback = 0) => {
  const parsedValue = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsedValue) ? parsedValue : fallback;
};

const ResultIcon = React.forwardRef<SVGSVGElement, PropTypes>(
  ({ settings, size = 512, isPreview, IconComponent }, svgRef) => {
    const strokeSize = isPreview ? 0 : getFiniteNumber(settings.backgroundStrokeSize);
    const strokeWidth = Math.max(0, Math.trunc(strokeSize));
    const backgroundRadius = getFiniteNumber(settings.backgroundRadius);
    const backgroundStrokeOpacity = getFiniteNumber(settings.backgroundStrokeOpacity);
    const backgroundNoiseTextureOpacity = getFiniteNumber(settings.backgroundNoiseTextureOpacity);
    const backgroundSpread = getFiniteNumber(settings.backgroundSpread);
    const backgroundAngle = getFiniteNumber(settings.backgroundAngle);
    const iconSize = getFiniteNumber(settings.iconSize);
    const iconOffsetX = getFiniteNumber(settings.iconOffsetX);
    const iconOffsetY = getFiniteNumber(settings.iconOffsetY);

    const rectId = useId().replace(/:/g, "");
    const gradientId = useId().replace(/:/g, "");
    const radialGlareGradientId = useId().replace(/:/g, "");
    const gradientX = settings.backgroundPosition?.split(",")[0];
    const gradientY = settings.backgroundPosition?.split(",")[1];

    return (
      <svg
        ref={svgRef}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        xmlnsXlink="http://www.w3.org/1999/xlink"
      >
        <rect
          id={rectId}
          width={size - strokeSize}
          height={size - strokeSize}
          x={strokeSize / 2}
          y={strokeSize / 2}
          rx={backgroundRadius}
          fill={settings.backgroundFillType === "Solid" ? settings.backgroundStartColor : `url(#${gradientId})`}
          stroke={settings.backgroundStrokeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={`${backgroundStrokeOpacity}%`}
          paintOrder="stroke"
        />

        {settings.backgroundRadialGlare ? (
          <rect
            width={size - strokeSize}
            height={size - strokeSize}
            x={strokeSize / 2}
            y={strokeSize / 2}
            fill={`url(#${radialGlareGradientId})`}
            rx={backgroundRadius}
            style={{ mixBlendMode: "overlay" }}
          />
        ) : null}

        {settings.backgroundNoiseTexture && !isPreview ? (
          <image
            href={noisePicture as unknown as string}
            width={size - strokeSize}
            height={size - strokeSize}
            x={strokeSize / 2}
            y={strokeSize / 2}
            clipPath="url(#clip)"
            opacity={`${backgroundNoiseTextureOpacity}%`}
          />
        ) : null}
        <clipPath id="clip">
          <use xlinkHref={`#${rectId}`} />
        </clipPath>

        <defs>
          {settings.backgroundFillType === "Radial" ? (
            <radialGradient
              id={gradientId}
              cx="50%"
              cy="50%"
              r="100%"
              fx={gradientX}
              fy={gradientY}
              gradientUnits="objectBoundingBox"
            >
              <stop stopColor={settings.backgroundStartColor} />
              <stop offset={backgroundSpread / 100} stopColor={settings.backgroundEndColor} />
            </radialGradient>
          ) : (
            <linearGradient
              id={gradientId}
              gradientUnits="userSpaceOnUse"
              gradientTransform={`rotate(${backgroundAngle})`}
              style={{ transformOrigin: "center" }}
            >
              <stop stopColor={settings.backgroundStartColor} />
              <stop offset="1" stopColor={settings.backgroundEndColor} />
            </linearGradient>
          )}
          <radialGradient
            id={radialGlareGradientId}
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform={`translate(${size / 2}) rotate(90) scale(${size})`}
          >
            <stop stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
        </defs>

        {IconComponent ? (
          <IconComponent
            width={iconSize}
            height={iconSize}
            x={(size - iconSize) / 2 + iconOffsetX}
            y={(size - iconSize) / 2 + iconOffsetY}
            style={{ color: settings.iconColor, width: iconSize, height: iconSize }}
            alignmentBaseline="middle"
          />
        ) : null}
      </svg>
    );
  },
);

ResultIcon.displayName = "ResultIcon";

export default ResultIcon;
