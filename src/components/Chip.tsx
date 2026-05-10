import React, { useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { colors, fontFamilies } from '@/theme';

interface ChipProps {
  label: string;
  /** initial count (uncontrolled) */
  count?: number;
  /** initial on (uncontrolled) */
  on?: boolean;
  /** optional controlled callback */
  onPress?: () => void;
}

export const Chip: React.FC<ChipProps> = ({ label, count, on, onPress }) => {
  // Uncontrolled toggle: tapping cycles 0 → 1 → 2 → 0 and flips on accordingly.
  const [localCount, setLocalCount] = useState(count ?? 0);
  const [localOn, setLocalOn] = useState(on ?? (count != null && count > 0));

  const handlePress = () => {
    if (onPress) {
      onPress();
      return;
    }
    const next = localCount >= 2 ? 0 : localCount + 1;
    setLocalCount(next);
    setLocalOn(next > 0);
  };

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        localOn && styles.on,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.label, localOn && styles.labelOn]}>{label}</Text>
      {localCount > 0 ? (
        <View style={[styles.n, localOn && styles.nOn]}>
          <Text style={[styles.nText, localOn && styles.nTextOn]}>{localCount}</Text>
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
