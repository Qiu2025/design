import React from "react";

import styles from "./Controls.module.css";
import BackgroundControl from "./BackgroundControl";
import DarkModeControl from "./DarkModeControl";
import ExportButton from "./ExportButton";
import LanguageControl from "./LanguageControl";
import PaddingControl from "./PaddingControl";
import RadiusSliderControl from "./RadiusSliderControl";
import ThemeControl from "./ThemeControl";
import LineNumberControl from "./LineNumberControl";
import { FRAME_BORDER_RADIUS_MAX, FRAME_BORDER_RADIUS_MIN, frameBorderRadiusAtom } from "../store/border-radius";
import { BACKGROUND_RADIUS_MAX, BACKGROUND_RADIUS_MIN, backgroundRadiusAtom } from "../store/background-radius";

const Controls: React.FC = () => {
  return (
    <div className={styles.controls}>
      <ThemeControl />
      <BackgroundControl />
      <DarkModeControl />
      <LineNumberControl />
      <PaddingControl />
      <RadiusSliderControl
        atom={frameBorderRadiusAtom}
        max={FRAME_BORDER_RADIUS_MAX}
        min={FRAME_BORDER_RADIUS_MIN}
        title="Code Radius"
      />
      <RadiusSliderControl
        atom={backgroundRadiusAtom}
        max={BACKGROUND_RADIUS_MAX}
        min={BACKGROUND_RADIUS_MIN}
        title="Background Radius"
      />
      <LanguageControl />
    </div>
  );
};

export default Controls;
