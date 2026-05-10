import React, { useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { colors, fontFamilies } from '@/theme';

interface ChipProps {
  label: string;
  /** Current count. If `onPress` is provided this is the source of truth (controlled). */
  count?: number;
  /** Whether the chip is "on". If omitted, derived from `count > 0`. */
  on?: boolean;
  /**
   * If provided, the chip is controlled — parent owns state, the chip just
   * fires `onPress` on tap and renders whatever `count`/`on` say. If omitted,
   * the chip self-cycles 0 → 1 → 2 → 0 on tap.
   */
  onPress?: () => void;
}

export const Chip: React.FC<ChipProps> = ({ label, count, on, onPress }) => {
  // Uncontrolled fallback for screens that don't manage their own state.
  const [internalCount, setInternalCount] = useState(count ?? 0);
  const controlled = !!onPress;
  const cur = controlled ? (count ?? 0) : internalCount;
  const isOn = on ?? cur > 0;

  const handle = () => {
    if (onPress) {
      onPress();
      return;
    }
    setInternalCount(c => (c >= 2 ? 0 : c + 1));
  };

  return (
    <Pressable
      onPress={handle}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        isOn && styles.on,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.label, isOn && styles.labelOn]}>{label}</Text>
      {cur > 0 ? (
        <View style={[styles.n, isOn && styles.nOn]}>
          <Text style={[styles.nText, isOn && styles.nTextOn]}>{cur}</Text>
        </View>
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 4,
  },
  on: {
    backgroundColor: colors.empire,
    borderColor: colors.empireDeep,
  },
  label: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 11.5,
    color: colors.ink2,
  },
  labelOn: { color: colors.bone },
  n: {
    backgroundColor: colors.inkSoft08,
    borderRadius: 3,
    paddingHorizontal: 5,
    minWidth: 16,
    alignItems: 'center',
  },
  nOn: { backgroundColor: 'rgba(0,0,0,0.25)' },
  nText: {
    fontFamily: fontFamilies.monoMedium,
    fontSize: 10,
    color: colors.ink2,
  },
  nTextOn: { color: colors.bone },
});
