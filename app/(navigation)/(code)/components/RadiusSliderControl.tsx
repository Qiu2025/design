import React from "react";
import { PrimitiveAtom, useAtom } from "jotai";

import ControlContainer from "./ControlContainer";
import styles from "./RadiusSliderControl.module.css";

type Props = {
  atom: PrimitiveAtom<number>;
  max: number;
  min: number;
  step?: number;
  title: string;
};

const RadiusSliderControl: React.FC<Props> = ({ atom, max, min, step = 1, title }) => {
  const [value, setValue] = useAtom(atom);

  return (
    <ControlContainer title={title}>
      <input
        aria-label={title}
        className={styles.range}
        max={max}
        min={min}
        step={step}
        type="range"
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
      />
    </ControlContainer>
  );
};

export default RadiusSliderControl;
