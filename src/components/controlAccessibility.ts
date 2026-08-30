export interface StepperAccessibilityInput {
  label: string;
  value: number;
  min: number;
  max?: number;
  decreaseLabel?: string;
  increaseLabel?: string;
}

/** Adds 16 px across each axis without changing the rendered control size. */
export const CONTROL_HIT_SLOP = 8;

/** Platform-standard minimum touch target for controls with a bounded parent. */
export const MIN_CONTROL_SIZE = 44;

export interface StepperAccessibility {
  decreaseLabel: string;
  increaseLabel: string;
  valueLabel: string;
  decreaseDisabled: boolean;
  increaseDisabled: boolean;
}

/** Accessibility copy/state shared by the Stepper's three announced elements. */
export function getStepperAccessibility({
  label,
  value,
  min,
  max,
  decreaseLabel,
  increaseLabel,
}: StepperAccessibilityInput): StepperAccessibility {
  return {
    decreaseLabel: decreaseLabel ?? `Decrease ${label}`,
    increaseLabel: increaseLabel ?? `Increase ${label}`,
    valueLabel: `${label}, current value ${value}`,
    decreaseDisabled: value <= min,
    increaseDisabled: typeof max === 'number' && value >= max,
  };
}

/** Prefer explicit action copy, otherwise use the Button's visible text. */
export function getButtonAccessibilityLabel(
  explicitLabel: string | undefined,
  visibleText: string,
): string | undefined {
  return explicitLabel?.trim() || visibleText.trim() || undefined;
}
