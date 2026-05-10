import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { colors, fontFamilies, space } from '@/theme';

interface SectionProps {
  title: string;
  aside?: string;
  first?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const Section: React.FC<SectionProps> = ({ title, aside, first, style }) => (
  <View style={[styles.row, { marginTop: first ? 4 : space.s5 }, style]}>
    <Text style={styles.title}>{title}</Text>
    <View style={styles.rule}>
      <View style={[styles.diamond, { left: 0 }]} />
      <View style={[styles.diamond, { right: 0 }]} />
    </View>
    {aside ? <Text style={styles.aside}>{aside}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xl,
    marginBottom: space.xxl,
  },
  title: {
    fontFamily: fontFamilies.display,
    fontSize: 20,
    color: colors.ink,
    flexShrink: 0,
  },
  rule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.brass,
    position: 'relative',
    marginHorizontal: 2,
  },
  diamond: {
    position: 'absolute',
    width: 5,
    height: 5,
    backgroundColor: colors.brass,
    top: -2,
    transform: [{ rotate: '45deg' }],
  },
  aside: {
    fontSize: 10,
    color: colors.ink3,
    fontFamily: fontFamilies.mono,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    flexShrink: 0,
  },
});

interface EyebrowProps {
  children: React.ReactNode;
}

export const Eyebrow: React.FC<EyebrowProps> = ({ children }) => (
  <View style={eyeStyles.wrap}>
    <View style={eyeStyles.tick} />
    <Text style={eyeStyles.text}>{children}</Text>
    <View style={eyeStyles.tick} />
  </View>
);

const eyeStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  tick: { width: 14, height: 1, backgroundColor: colors.brass },
  text: {
    fontFamily: fontFamilies.bodySemibold,
    fontSize: 10,
    letterSpacing: 2.2,
    color: colors.brass,
    textTransform: 'uppercase',
  },
});
