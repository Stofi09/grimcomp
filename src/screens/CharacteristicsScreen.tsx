import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { CHARACTER, XP_COSTS } from '@/data/character';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Stat } from '@/components/Stat';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors, fontFamilies } from '@/theme';
import { tabular, layoutStyles } from '@/components/primitives';

export const CharacteristicsScreen: React.FC = () => {
  const c = CHARACTER;
  return (
    <ScreenContainer>
      <Hero
        eyebrow="Sheet 2 — Characteristics"
        title="Ten characteristics"
        subRow={
          <>
            <Text style={styles.sub}>Initial + advances = current.</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>Bonus = the tens digit, used in every test.</Text>
          </>
        }
      />

      <Section title="Profile" />

      <View style={styles.statsGrid}>
        {c.characteristics.map(x => (
          <View key={x.key} style={styles.statCell}>
            <Stat c={x} suggested={x.key === 'ws'} />
          </View>
        ))}
      </View>

      <Section title="Buy advances" aside="XP cost tables" />

      <View style={styles.purchaseRow}>
        <Card flush style={styles.costCard}>
          <CardHead title="Cost bands" meta="advance · xp" />
          <Table>
            <TableRow header>
              <Cell header flex={1}>Advance</Cell>
              <Cell header num flex={0.6}>XP</Cell>
              <Cell header flex={1.4}>Note</Cell>
            </TableRow>
            {XP_COSTS.map((x, i) => {
              const highlight = i === 2;
              return (
                <TableRow key={x.range} last={i === XP_COSTS.length - 1} style={highlight ? styles.rowHl : null}>
                  <Cell flex={1}>{x.range}</Cell>
                  <Cell num flex={0.6} textStyle={highlight ? { color: colors.brass, fontFamily: fontFamilies.bodySemibold } : null}>
                    {x.cost}
                  </Cell>
                  <Cell flex={1.4} textStyle={{ color: colors.ink3, fontSize: 11 }}>
                    {highlight ? '← Weapon Skill is here' : ''}
                  </Cell>
                </TableRow>
              );
            })}
          </Table>
        </Card>

        <Card bordered style={styles.suggestCard}>
          <View style={{ marginBottom: 6 }}>
            <Text style={styles.eyebrow}>Suggested purchase</Text>
          </View>
          <View style={[layoutStyles.rowBetween, { alignItems: 'baseline' }]}>
            <Text style={styles.suggestTitle}>
              Weapon Skill <Text style={{ color: colors.brass }}>+5</Text>
            </Text>
            <Pill variant="success" iconLeft={<Icon name="check" size={11} color={colors.success} />}>
              in career path
            </Pill>
          </View>
          <Text style={[styles.muted, { marginTop: 6 }]}>
            Roadwarden 2 → 3 needs at least +10 WS. You're at +10 already; another +5 builds a buffer.
          </Text>
          <View style={styles.divider} />
          <View style={styles.suggestRow}>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.miniLabel}>NOW</Text>
              <Text style={[styles.bigNum, tabular]}>43</Text>
            </View>
            <Text style={styles.arrow}>→</Text>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.miniLabel}>AFTER +5</Text>
              <Text style={[styles.bigNum, { color: colors.brass }, tabular]}>48</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.miniLabel}>COST</Text>
              <Text style={[styles.bigNum, tabular]}>40<Text style={{ fontSize: 14, color: colors.ink3 }}> xp</Text></Text>
            </View>
          </View>
          <View style={[layoutStyles.row, { marginTop: 14, gap: 8 }]}>
            <Button
              variant="primary"
              large
              style={{ flex: 1, justifyContent: 'center' }}
              onPress={() => Alert.alert('Purchase', 'Weapon Skill +5 — 40 XP spent (mock).')}
            >
              Buy · 40 XP
            </Button>
            <Button variant="ghost" onPress={() => Alert.alert('Other', 'Pick another characteristic to advance.')}>
              Other…
            </Button>
          </View>
        </Card>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink2, fontFamily: fontFamilies.body },
  sep: { color: colors.ink4 },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
    marginBottom: -12,
  },
  statCell: {
    width: '20%',
    paddingHorizontal: 6,
    paddingBottom: 12,
  },
  purchaseRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  costCard: { flex: 1, minWidth: 320 },
  suggestCard: { flex: 1.1, minWidth: 320 },
  rowHl: { backgroundColor: colors.brassHighlight },
  eyebrow: {
    fontFamily: fontFamilies.bodySemibold,
    fontSize: 10,
    letterSpacing: 2.2,
    color: colors.brass,
    textTransform: 'uppercase',
  },
  suggestTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 24,
    color: colors.ink,
  },
  muted: { color: colors.ink3, fontSize: 12, fontFamily: fontFamilies.body, lineHeight: 18 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 14 },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  miniLabel: {
    fontFamily: fontFamilies.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.ink3,
  },
  bigNum: {
    fontFamily: fontFamilies.display,
    fontSize: 32,
    color: colors.ink,
    marginTop: 4,
  },
  arrow: {
    fontFamily: fontFamilies.display,
    fontSize: 24,
    color: colors.brass,
  },
});
