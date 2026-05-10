import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle, StyleProp } from 'react-native';
import { colors, fontFamilies, radius, shadows, space } from '@/theme';
import { tabular } from './primitives';

type CounterVariant = 'default' | 'fate' | 'empire' | 'corr' | 'feature';

interface CounterProps {
  label: string;
  sub?: string;
  value: React.ReactNode;
  variant?: CounterVariant;
  style?: StyleProp<ViewStyle>;
  valueStyle?: StyleProp<TextStyle>;
}

const VALUE_COLOR: Record<CounterVariant, string> = {
  default: colors.ink,
  fate: colors.brass,
  empire: colors.empire,
  corr: colors.corruption,
  feature: colors.ink,
};

export const Counter: React.FC<CounterProps> = ({ label, sub, value, variant = 'default', style, valueStyle }) => (
  <View style={[styles.box, variant === 'feature' && styles.feature, style]}>
    <View style={{ flex: 1 }}>
      <Text style={[styles.label, variant === 'fate' ? { color: colors.brass } : null, variant === 'empire' ? { color: colors.empire } : null]}>
        {label}
      </Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
    <Text style={[styles.value, { color: VALUE_COLOR[variant] }, tabular, valueStyle]}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: space.xxl,
    backgroundColor: colors.ivory,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    ...shadows.paper,
  },
  feature: { paddingHorizontal: 20, paddingVertical: space.xxxl },
  label: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  sub: {
    fontFamily: fontFamilies.mono,
    fontSize: 10.5,
    color: colors.ink3,
    marginTop: 3,
    letterSpacing: 0.2,
  },
  value: {
    fontFamily: fontFamilies.display,
    fontSize: 48,
    lineHeight: 48,
    color: colors.ink,
  },
});
