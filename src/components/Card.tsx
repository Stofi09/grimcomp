import React from 'react';
import { View, Text, ViewStyle, StyleSheet, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, shadows, space, fontFamilies } from '@/theme';
import { tabular } from './primitives';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tight?: boolean;
  flush?: boolean;
  bordered?: boolean;
  dashed?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, style, tight, flush, bordered, dashed }) => {
  return (
    <View
      style={[
        styles.base,
        tight && styles.tight,
        flush && styles.flush,
        bordered && styles.bordered,
        dashed && styles.dashed,
        style,
      ]}
    >
      {/* parchment surface gradient — ivory → bone vertical */}
      {!dashed ? (
        <LinearGradient
          pointerEvents="none"
          colors={[colors.ivory, colors.bone]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: radius.md }]}
        />
      ) : null}
      {children}
      {bordered ? <BorderedCorners /> : null}
    </View>
  );
};

const BorderedCorners: React.FC = () => (
  <>
    <View style={[styles.corner, styles.cornerTL]} />
    <View style={[styles.corner, styles.cornerBR]} />
  </>
);

interface CardHeadProps {
  title: string;
  meta?: string;
  right?: React.ReactNode;
}

export const CardHead: React.FC<CardHeadProps> = ({ title, meta, right }) => (
  <View style={styles.head}>
    <Text style={styles.headTitle}>{title}</Text>
    {meta ? <Text style={[styles.headMeta, tabular]}>{meta}</Text> : null}
    {right ? <View style={{ marginLeft: 'auto' }}>{right}</View> : null}
  </View>
);

interface CardBodyProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export const CardBody: React.FC<CardBodyProps> = ({ children, style }) => (
  <View style={[styles.body, style]}>{children}</View>
);

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.ivory,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.xxxl,
    position: 'relative',
    overflow: 'hidden',
    ...shadows.paper,
  },
  tight: { padding: space.xxl },
  flush: { padding: 0, overflow: 'hidden' },
  bordered: { padding: 22 },
  dashed: { borderStyle: 'dashed', borderColor: colors.border },
  corner: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderColor: colors.brass,
  },
  cornerTL: { top: 6, left: 6, borderTopWidth: 1, borderLeftWidth: 1 },
  cornerBR: { bottom: 6, right: 6, borderBottomWidth: 1, borderRightWidth: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: 16,
    paddingVertical: space.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: 'transparent',
  },
  headTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 16,
    color: colors.ink,
  },
  headMeta: {
    marginLeft: 'auto',
    fontFamily: fontFamilies.mono,
    fontSize: 10,
    color: colors.ink3,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  body: {
    paddingHorizontal: 16,
    paddingVertical: space.xxl,
  },
});
