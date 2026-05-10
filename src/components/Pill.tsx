import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle, StyleProp } from 'react-native';
import { colors, fontFamilies } from '@/theme';

export type PillVariant = 'default' | 'empire' | 'brass' | 'corr' | 'success' | 'warn' | 'ghost';

interface PillProps {
  children: React.ReactNode;
  variant?: PillVariant;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  size?: number;
  iconLeft?: React.ReactNode;
}

const VARIANT: Record<PillVariant, { bg: string; border: string; text: string }> = {
  default: { bg: colors.surface2, border: colors.borderSoft, text: colors.ink2 },
  empire: { bg: colors.empireTint, border: colors.empireTintBorder, text: colors.empire },
  brass: { bg: colors.brassTint, border: colors.brassTintBorder, text: colors.brassTintInk },
  corr: { bg: colors.corrTint, border: colors.corrTintBorder, text: colors.corruption },
  success: { bg: colors.successTint, border: colors.successTintBorder, text: colors.success },
  warn: { bg: colors.warnTint, border: colors.warnTintBorder, text: colors.warning },
  ghost: { bg: 'transparent', border: colors.divider, text: colors.ink2 },
};

export const Pill: React.FC<PillProps> = ({ children, variant = 'default', style, textStyle, size = 10.5, iconLeft }) => {
  const v = VARIANT[variant];
  return (
    <View style={[styles.base, { backgroundColor: v.bg, borderColor: v.border }, style]}>
      {iconLeft}
      <Text style={[{ color: v.text, fontSize: size }, styles.text, textStyle]}>{children}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: fontFamilies.bodyMedium,
    letterSpacing: 0.2,
    lineHeight: 16,
  },
});
