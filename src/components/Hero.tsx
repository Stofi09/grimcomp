import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { colors, fontFamilies, space } from '@/theme';
import { Eyebrow } from './Section';

interface HeroProps {
  eyebrow?: string;
  title: React.ReactNode;
  trailingTitle?: React.ReactNode;
  subRow?: React.ReactNode;
  actions?: React.ReactNode;
  italic?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const Hero: React.FC<HeroProps> = ({ eyebrow, title, trailingTitle, subRow, actions, italic, style }) => (
  <View style={[styles.hero, style]}>
    <View style={{ flex: 1 }}>
      {eyebrow ? (
        <View style={styles.eye}>
          <Eyebrow>{eyebrow}</Eyebrow>
        </View>
      ) : null}
      <View style={styles.nameRow}>
        <Text style={[styles.h1, italic && styles.h1Italic]}>{title}</Text>
        {trailingTitle ? <View style={styles.trailing}>{trailingTitle}</View> : null}
      </View>
      {subRow ? <View style={styles.subRow}>{subRow}</View> : null}
    </View>
    {actions ? <View style={styles.actions}>{actions}</View> : null}
    {/* brass corner ticks under hero */}
    <View pointerEvents="none" style={styles.brassTickL} />
    <View pointerEvents="none" style={styles.brassTickR} />
  </View>
);

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.s4,
    paddingBottom: 18,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    position: 'relative',
  },
  eye: { marginBottom: 10 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 14,
  },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  h1: {
    fontFamily: fontFamilies.display,
    fontSize: 44,
    color: colors.ink,
    lineHeight: 44,
  },
  h1Italic: { fontFamily: fontFamilies.displayItalic },
  subRow: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 14,
  },
  actions: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  brassTickL: {
    position: 'absolute',
    left: 0,
    bottom: -3,
    width: 80,
    height: 1,
    backgroundColor: colors.brass,
  },
  brassTickR: {
    position: 'absolute',
    right: 0,
    bottom: -3,
    width: 80,
    height: 1,
    backgroundColor: colors.brass,
  },
});
