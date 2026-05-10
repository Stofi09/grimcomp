import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { CHARACTER } from '@/data/character';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { colors, fontFamilies } from '@/theme';
import { layoutStyles } from '@/components/primitives';

export const TalentsScreen: React.FC = () => {
  const c = CHARACTER;
  return (
    <ScreenContainer>
      <Hero
        eyebrow="Sheet 4 — Talents"
        title="Talents"
        subRow={
          <>
            <Text style={styles.sub}>{c.talents.length} acquired</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>passive effects and unlocks</Text>
          </>
        }
      />

      <Section title="Active talents" />

      <View style={styles.grid}>
        {c.talents.map((t, i) => (
          <Card key={i} style={styles.cell}>
            <View style={[layoutStyles.row, { alignItems: 'flex-start', justifyContent: 'space-between' }]}>
              <View style={{ flex: 1 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.tName}>{t.name}</Text>
                  {t.career ? <Pill variant="empire" size={9.5}>career</Pill> : null}
                </View>
                <Text style={styles.desc}>{t.desc}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', marginLeft: 14 }}>
                <Text style={styles.miniLabel}>TIMES</Text>
                <Text style={styles.times}>×{t.times}</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={layoutStyles.rowBetween}>
              <Text style={styles.next}>NEXT {100 * (t.times + 1)} XP</Text>
              <Button variant="ghost" onPress={() => Alert.alert(t.name, `Buying another rank costs ${100 * (t.times + 1)} XP.`)}>
                Buy another
              </Button>
            </View>
          </Card>
        ))}

        <Card dashed style={[styles.cell, styles.empty]}>
          <Icon name="plus" size={20} color={colors.ink3} />
          <Text style={styles.emptyTitle}>New talent</Text>
          <Text style={styles.emptySub}>5 available in career</Text>
        </Card>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink2, fontFamily: fontFamilies.body },
  sep: { color: colors.ink4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { flexBasis: '48%', flexGrow: 1, minWidth: 280 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tName: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 18,
    color: colors.ink,
  },
  desc: {
    color: colors.ink3,
    fontSize: 12,
    marginTop: 6,
    lineHeight: 18,
    fontFamily: fontFamilies.body,
  },
  miniLabel: {
    fontFamily: fontFamilies.mono,
    fontSize: 9,
    letterSpacing: 1,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  times: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 24,
    color: colors.brass,
  },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 14 },
  next: {
    fontFamily: fontFamilies.mono,
    fontSize: 10,
    color: colors.ink3,
    letterSpacing: 0.6,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 160,
  },
  emptyTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 16,
    color: colors.ink,
    marginTop: 6,
  },
  emptySub: {
    fontFamily: fontFamilies.mono,
    fontSize: 10.5,
    color: colors.ink3,
    marginTop: 2,
  },
});
