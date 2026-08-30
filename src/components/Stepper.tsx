import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fontFamilies, shadows } from '@/theme';
import { MIN_CONTROL_SIZE, getStepperAccessibility } from './controlAccessibility';

interface StepperProps {
  /** Initial value, used when uncontrolled. */
  value: number;
  /** Optional clamp. Default min=0. */
  min?: number;
  max?: number;
  step?: number;
  /** Name of the value being changed, such as "Fortune" or "Wounds". */
  accessibilityLabel: string;
  decreaseLabel?: string;
  increaseLabel?: string;
  /** Optional controlled callback. If omitted the Stepper manages its own state. */
  onChange?: (next: number) => void;
}

export const Stepper: React.FC<StepperProps> = ({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  accessibilityLabel,
  decreaseLabel,
  increaseLabel,
}) => {
  const [internal, setInternal] = useState(value);
  const cur = onChange ? value : internal;
  const accessibility = getStepperAccessibility({
    label: accessibilityLabel,
    value: cur,
    min,
    max,
    decreaseLabel,
    increaseLabel,
  });

  const change = useCallback((delta: number) => {
    let next = cur + delta;
    if (typeof min === 'number') next = Math.max(min, next);
    if (typeof max === 'number') next = Math.min(max, next);
    if (next === cur) return;
    if (onChange) onChange(next);
    else setInternal(next);
  }, [cur, min, max, onChange]);

  return (
    <View style={styles.box}>
      <Pressable
        style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        onPress={() => change(-step)}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibility.decreaseLabel}
        accessibilityState={{ disabled: accessibility.decreaseDisabled }}
        disabled={accessibility.decreaseDisabled}
      >
        <Text accessible={false} style={styles.btnText}>−</Text>
      </Pressable>
      <View style={styles.middle}>
        <Text
          style={styles.value}
          accessibilityLabel={accessibility.valueLabel}
          accessibilityLiveRegion="polite"
        >
          {cur}
        </Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        onPress={() => change(+step)}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibility.increaseLabel}
        accessibilityState={{ disabled: accessibility.increaseDisabled }}
        disabled={accessibility.increaseDisabled}
      >
        <Text accessible={false} style={styles.btnText}>+</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    borderRadius: 4,
    overflow: 'hidden',
    ...shadows.paper,
  },
  btn: {
    width: MIN_CONTROL_SIZE,
    height: MIN_CONTROL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: { backgroundColor: colors.surface2 },
  btnText: {
    fontFamily: fontFamilies.display,
    fontSize: 16,
    color: colors.ink2,
  },
  middle: {
    minWidth: MIN_CONTROL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.ivory,
  },
  value: {
    fontFamily: fontFamilies.monoMedium,
    fontSize: 13,
    color: colors.ink,
  },
});
