import React from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { type CharacteristicKey } from '@/data/character';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useXp } from '@/hooks/useXp';
import { useConditions } from '@/hooks/useConditions';
import { useXpCosts } from '@/content/useContent';
import { resolveTest, outcomeLabel, formatTestResult } from '@/utils/roll';
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

// XP cost band given current adv. WFRP 4e core p.49.
const bracket = (adv: number) =>
  adv < 5 ? 25 : adv < 10 ? 30 : adv < 15 ? 40 : adv < 20 ? 50 : adv < 25 ? 70 : adv < 30 ? 90 : adv < 35 ? 120 : 150;

// The screen's "suggested" focus is always Weapon Skill — the design picked it
// for the Roadwarden, and it remains the cheapest path to rank 3 requirements.
const SUGGEST_KEY: CharacteristicKey = 'ws';

export const CharacteristicsScreen: React.FC = () => {
  const { list, get, adjust } = useCharacteristics();
  const xp = useXp();
  const { modifier: condMod } = useConditions();
  const xpCosts = useXpCosts();

  const test = (key: CharacteristicKey) => {
    const c = list.find(x => x.key === key)!;
    const r = resolveTest({ target: c.current, modifier: condMod.total, label: c.name });
    const condLine = condMod.parts.length
      ? '\n\nFrom conditions:\n' + condMod.parts.map(p => `  • ${p.name} ×${p.stacks} → ${p.modifier > 0 ? '+' : ''}${p.modifier}`).join('\n')
      : '';
    Alert.alert(
      `${c.name} — ${outcomeLabel(r.outcome)}`,
      formatTestResult(r) + condLine,
    );
  };

  const suggest = list.find(c => c.key === SUGGEST_KEY)!;
  const advNow = get(SUGGEST_KEY);
  const cost = bracket(advNow);
  const highlightIdx = xpCosts.findIndex(b => b.cost === cost);

  const buy = (key: CharacteristicKey) => {
    const c = list.find(x => x.key === key)!;
    const cur = get(key);
    const next = cur + 5;
    const cost = bracket(cur);
    const reason = `${c.name} +${cur} → +${next}`;
    const r = xp.spend(cost, reason, 'char');
    if (!r.ok) {
      Alert.alert('Not enough XP', r.message);
      return;
    }
    adjust(key, +5);
    Alert.alert('Bought advance', r.message);
  };

  const pickOther = () => {
    // Quick "buy any characteristic +5" picker. Lists each one with current
    // adv + bracket cost; tapping a button fires the buy.
    const buttons = list
      .filter(c => c.key !== SUGGEST_KEY)
      .map(c => ({
        text: `${c.name} (+${c.adv} → +${c.adv + 5}) · ${bracket(c.adv)} XP`,
        onPress: () => buy(c.key),
      }));
    Alert.alert(
      'Buy another characteristic',
      'Pick one to advance by +5.',
      [...buttons, { text: 'Cancel', style: 'cancel' }],
    );
  };

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
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>{xp.current} XP available</Text>
          </>
        }
      />

      <Section title="Profile" />

      <View style={styles.statsGrid}>
        {list.map(x => (
          <Pressable
            key={x.key}
            style={({ pressed }) => [styles.statCell, pressed && { opacity: 0.7 }]}
            onPress={() => test(x.key)}
            hitSlop={4}
          >
            <Stat c={x} suggested={x.key === SUGGEST_KEY} />
          </Pressable>
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
            {xpCosts.map((x, i) => {
              const highlight = i === highlightIdx;
              return (
                <TableRow key={x.range} last={i === xpCosts.length - 1} style={highlight ? styles.rowHl : null}>
                  <Cell flex={1}>{x.range}</Cell>
                  <Cell num flex={0.6} textStyle={highlight ? { color: colors.brass, fontFamily: fontFamilies.bodySemibold } : null}>
                    {x.cost}
                  </Cell>
                  <Cell flex={1.4} textStyle={{ color: colors.ink3, fontSize: 11 }}>
                    {highlight ? `← ${suggest.name} is here` : ''}
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
              {suggest.name} <Text style={{ color: colors.brass }}>+5</Text>
            </Text>
            <Pill variant="success" iconLeft={<Icon name="check" size={11} color={colors.success} />}>
              in career path
            </Pill>
          </View>
          <Text style={[styles.muted, { marginTop: 6 }]}>
            Roadwarden 2 → 3 needs at least +10 WS. You're at +{suggest.adv}; another +5 builds a buffer.
          </Text>
          <View style={styles.divider} />
          <View style={styles.suggestRow}>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.miniLabel}>NOW</Text>
              <Text style={[styles.bigNum, tabular]}>{suggest.current}</Text>
            </View>
            <Text style={styles.arrow}>→</Text>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.miniLabel}>AFTER +5</Text>
              <Text style={[styles.bigNum, { color: colors.brass }, tabular]}>{suggest.current + 5}</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.miniLabel}>COST</Text>
              <Text style={[styles.bigNum, tabular]}>{cost}<Text style={{ fontSize: 14, color: colors.ink3 }}> xp</Text></Text>
            </View>
          </View>
          <View style={[layoutStyles.row, { marginTop: 14, gap: 8 }]}>
            <Button
              variant="primary"
              large
              style={{ flex: 1, justifyContent: 'center' }}
              onPress={() => buy(SUGGEST_KEY)}
            >
              Buy · {cost} XP
            </Button>
            <Button variant="ghost" onPress={pickOther}>
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
