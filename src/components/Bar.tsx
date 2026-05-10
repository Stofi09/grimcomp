import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '@/theme';

type BarVariant = 'empire' | 'brass' | 'success' | 'corr';

interface BarProps {
  value: number; // 0..1
  variant?: BarVariant;
  large?: boolean;
  style?: StyleProp<ViewStyle>;
  fillColorOverride?: string;
}

const FILL: Record<BarVariant, [string, string]> = {
  empire: [colors.empireBright, colors.empireDeep],
  brass: [colors.brassSoft, colors.brass],
  success: ['#4d7a3a', colors.success],
  corr: [colors.corruptionBright, colors.corruption],
};

export const Bar: React.FC<BarProps> = ({ value, variant = 'empire', large, style, fillColorOverride }) => {
  const stops = fillColorOverride ? [fillColorOverride, fillColorOverride] : FILL[variant];
  return (
    <View style={[styles.bar, large && styles.barLg, style]}>
      <View
        style={[
          styles.fillWrap,
          { width: `${Math.max(0, Math.min(100, value * 100))}%` },
        ]}
      >
        <LinearGradient
          colors={stops}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      </View>
    </View>
  );
};

interface SegBarProps {
  total: number;
  filled: number;
}

export const SegBar: React.FC<SegBarProps> = ({ total, filled }) => (
  <View style={styles.seg}>
    {Array.from({ length: total }, (_, i) => {
      const on = i < filled;
      return (
        <View key={i} style={[styles.segCell, on && styles.segCellOn]}>
          {on ? (
            <LinearGradient
              colors={[colors.empireBright, colors.empireDeep]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          ) : null}
        </View>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  bar: {
    height: 8,
    backgroundColor: colors.surface3,
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  barLg: { height: 14 },
  fillWrap: { height: '100%', borderRadius: 3, overflow: 'hidden' },
  seg: { flexDirection: 'row', gap: 2, height: 18 },
  segCell: {
    flex: 1,
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 2,
    overflow: 'hidden',
  },
  segCellOn: {
    borderColor: colors.empireDeep,
  },
});
