import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fontFamilies, radius, shadows, space } from '@/theme';
import type { Characteristic } from '@/data/character';
import { tabular } from './primitives';

interface StatProps {
  c: Characteristic;
  suggested?: boolean;
}

export const Stat: React.FC<StatProps> = ({ c, suggested }) => {
  const cur = c.init + c.adv;
  const bonus = Math.floor(cur / 10);
  return (
    <View style={[styles.box, suggested && styles.suggested]}>
      <View style={styles.bonus}>
        <Text style={styles.bonusText}>{bonus}</Text>
      </View>

      <View style={styles.top}>
        <View style={styles.key}>
          <Text style={styles.keyText}>{c.short}</Text>
        </View>
        <Text style={styles.name}>{c.name}</Text>
      </View>

      <Text style={[styles.num, tabular]}>{cur}</Text>

      <View style={styles.breakdown}>
        <Text style={styles.breakdownText}>
          <Text style={styles.breakdownB}>{c.init}</Text> base
        </Text>
        <Text style={[styles.breakdownText, { color: colors.brass }]}>+{c.adv} adv</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.ivory,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    overflow: 'hidden',
    position: 'relative',
    ...shadows.paper,
  },
  suggested: {
    borderColor: colors.brass,
    shadowColor: colors.brass,
    shadowOpacity: 0.35,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.sm,
  },
  key: {
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  keyText: {
    fontFamily: fontFamilies.monoMedium,
    fontSize: 9.5,
    color: colors.ink3,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  name: {
    fontFamily: fontFamilies.display,
    fontSize: 14.5,
    color: colors.ink2,
    flex: 1,
  },
  num: {
    fontFamily: fontFamilies.display,
    fontSize: 44,
    lineHeight: 42,
    color: colors.ink,
    letterSpacing: -0.4,
  },
  breakdown: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  breakdownText: {
    fontFamily: fontFamilies.mono,
    fontSize: 10,
    color: colors.ink3,
    letterSpacing: 0.2,
  },
  breakdownB: {
    color: colors.ink,
    fontFamily: fontFamilies.monoMedium,
  },
  bonus: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.brassSoft,
    borderWidth: 1,
    borderColor: colors.brass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bonusText: {
    fontFamily: fontFamilies.display,
    fontSize: 13,
    color: '#2a2010',
  },
});
