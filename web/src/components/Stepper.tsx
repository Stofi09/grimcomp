import type * as React from 'react';
import { useCallback, useState } from 'react';
import './Stepper.css';

interface StepperProps {
  /** Initial value, used when uncontrolled. */
  value: number;
  /** Optional clamp. Default min=0. */
  min?: number;
  max?: number;
  step?: number;
  /** Optional controlled callback. If omitted the Stepper manages its own state. */
  onChange?: (next: number) => void;
}

export const Stepper: React.FC<StepperProps> = ({ value, onChange, min = 0, max, step = 1 }) => {
  const [internal, setInternal] = useState(value);
  const cur = onChange ? value : internal;

  const change = useCallback(
    (delta: number) => {
      let next = cur + delta;
      if (typeof min === 'number') next = Math.max(min, next);
      if (typeof max === 'number') next = Math.min(max, next);
      if (next === cur) return;
      if (onChange) onChange(next);
      else setInternal(next);
    },
    [cur, min, max, onChange],
  );

  return (
    <div className="gc-stepper">
      <button
        type="button"
        className="btn-reset gc-stepper-btn"
        aria-label="Decrease"
        onClick={() => change(-step)}
      >
        −
      </button>
      <div className="gc-stepper-mid">
        <span className="gc-stepper-value">{cur}</span>
      </div>
      <button
        type="button"
        className="btn-reset gc-stepper-btn"
        aria-label="Increase"
        onClick={() => change(+step)}
      >
        +
      </button>
    </div>
  );
};
