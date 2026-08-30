import { describe, expect, it } from 'vitest';
import {
  CONTROL_HIT_SLOP,
  MIN_CONTROL_SIZE,
  getButtonAccessibilityLabel,
  getStepperAccessibility,
} from '../../../src/components/controlAccessibility';

describe('native shared-control accessibility', () => {
  it('provides platform-sized targets for compact controls', () => {
    expect(CONTROL_HIT_SLOP).toBeGreaterThanOrEqual(7);
    expect(MIN_CONTROL_SIZE).toBeGreaterThanOrEqual(44);
  });

  it('gives each stepper control contextual labels and boundary state', () => {
    const atMinimum = getStepperAccessibility({
      label: 'Fortune',
      value: 0,
      min: 0,
      max: 3,
    });

    expect(atMinimum).toEqual({
      decreaseLabel: 'Decrease Fortune',
      increaseLabel: 'Increase Fortune',
      valueLabel: 'Fortune, current value 0',
      decreaseDisabled: true,
      increaseDisabled: false,
    });

    expect(getStepperAccessibility({
      label: 'Fortune',
      value: 3,
      min: 0,
      max: 3,
    }).increaseDisabled).toBe(true);
  });

  it('honours custom action labels for context-specific controls', () => {
    const accessibility = getStepperAccessibility({
      label: 'Wounds',
      value: 7,
      min: 0,
      decreaseLabel: 'Apply one wound',
      increaseLabel: 'Heal one wound',
    });

    expect(accessibility.decreaseLabel).toBe('Apply one wound');
    expect(accessibility.increaseLabel).toBe('Heal one wound');
    expect(accessibility.increaseDisabled).toBe(false);
  });

  it('prefers an explicit icon-button label and otherwise uses visible copy', () => {
    expect(getButtonAccessibilityLabel('Cast Dart', '')).toBe('Cast Dart');
    expect(getButtonAccessibilityLabel(undefined, '  Save  ')).toBe('Save');
    expect(getButtonAccessibilityLabel(undefined, '')).toBeUndefined();
  });
});
