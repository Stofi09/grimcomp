import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fontFamilies, shadows } from '@/theme';

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
        hitSlop={6}
      >
        <Text style={styles.btnText}>−</Text>
      </Pressable>
      <View style={styles.middle}>
        <Text style={styles.value}>{cur}</Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        onPress={() => change(+step)}
        hitSlop={6}
      >
        <Text style={styles.btnText}>+</Text>
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
    width: 30,
    height: 30,
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
    minWidth: 36,
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
