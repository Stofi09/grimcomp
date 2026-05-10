import { Platform, StyleSheet, TextStyle, ViewStyle } from 'react-native';
import { colors, fontFamilies, radius, shadows, space } from '@/theme';

// Reusable text styles that mirror styles.css typography utilities.
export const textStyles = StyleSheet.create({
  h1: {
    fontFamily: fontFamilies.display,
    fontSize: 44,
    lineHeight: 44,
    color: colors.ink,
  } as TextStyle,
  h1Italic: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 44,
    lineHeight: 44,
    color: colors.ink,
  } as TextStyle,
  h2: {
    fontFamily: fontFamilies.display,
    fontSize: 26,
    lineHeight: 29,
    color: colors.ink,
  } as TextStyle,
  h3: {
    fontFamily: fontFamilies.display,
    fontSize: 19,
    lineHeight: 22,
    color: colors.ink,
  } as TextStyle,
  body: {
    fontFamily: fontFamilies.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.ink,
  } as TextStyle,
  bodySm: {
    fontFamily: fontFamilies.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.ink2,
  } as TextStyle,
  muted: { color: colors.ink3 } as TextStyle,
  mono: { fontFamily: fontFamilies.mono } as TextStyle,
  label: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.5,
    color: colors.ink3,
    textTransform: 'uppercase',
  } as TextStyle,
  eyebrow: {
    fontFamily: fontFamilies.bodySemibold,
    fontSize: 10,
    letterSpacing: 2.2,
    color: colors.brass,
    textTransform: 'uppercase',
  } as TextStyle,
});

export const layoutStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg } as ViewStyle,
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } as ViewStyle,
  col: { flexDirection: 'column', gap: space.lg } as ViewStyle,
  hr: { height: 1, backgroundColor: colors.divider, marginVertical: space.xxl } as ViewStyle,
  vr: { width: 1, alignSelf: 'stretch', backgroundColor: colors.divider } as ViewStyle,
});

// Approximation of the tabular-numbers feature used everywhere.
export const tabular: TextStyle = Platform.select({
  ios: { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] },
  default: {},
})!;

// Card surface — used by Card, Stat, Counter.
export const cardSurface: ViewStyle = {
  backgroundColor: colors.ivory,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.md,
  ...shadows.paper,
};
