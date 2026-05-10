import React from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { useCareer } from '@/hooks/useCareer';
import { useXp } from '@/hooks/useXp';
import { useStoredState } from '@/hooks/useStoredState';
import { CHARACTER } from '@/data/character';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors, fontFamilies } from '@/theme';
import { tabular, layoutStyles } from '@/components/primitives';

interface Level {
  n: number;
  name: string;
  status: string;
  xp: number;
}

const LEVELS: Level[] = [
  { n: 1, name: 'Roadwarden', status: 'Silver 2', xp: 0 },
  { n: 2, name: 'Road Sergeant', status: 'Silver 3', xp: 200 },
  { n: 3, name: 'Mounted Sergeant', status: 'Silver 4', xp: 400 },
  { n: 4, name: 'Captain', status: 'Gold 1', xp: 600 },
];

const REQUIRED_TEMPLATE: Array<{ name: string; min: number }> = [
  { name: 'Ride (Horse)', min: 10 },
  { name: 'Perception', min: 10 },
  { name: 'Melee (Basic)', min: 10 },
  { name: 'Ranged (Bow)', min: 10 },
  { name: 'Outdoor Survival', min: 5 },
  { name: 'Intimidate', min: 5 },
  { name: 'Track', min: 5 },
  { name: 'Lore (Heraldry)', min: 5 },
];

// Cost to buy the next career rank. WFRP 4e core p.49: 100 XP × the new rank.
const ADVANCE_COST = 200;

export const CareerScreen: React.FC = () => {
  const career = useCareer();
  const xp = useXp();

  // Pull live skill advances so the requirements table is accurate after the
  // player buys advances on the Skills screen.
  const [skillAdv] = useStoredState<Record<string, number>>(
    'gc.skills.adv',
    Object.fromEntries(CHARACTER.skills.map(s => [s.name, s.adv]))
  );

  const required = REQUIRED_TEMPLATE.map(r => ({
    ...r,
    adv: skillAdv[r.name] ?? 0,
  }));
  const ready = required.filter(s => s.adv >= s.min).length;
  const ok = ready === required.length;

  // Per-rank picked talents (mocked for the prototype; in a real build this
  // would come from a talents-by-rank table).
  const [talents] = useStoredState<Array<{ name: string; done: boolean }>>(
    'gc.career.talents',
    [
      { name: 'Sharp', done: true },
      { name: 'Sure Shot', done: true },
      { name: 'Hardy', done: true },
      { name: 'Menacing', done: false },
    ],
  );

  const tryAdvance = () => {
    if (!ok) return;
    if (!career.canAdvance) {
      Alert.alert('Top of career', 'Sigmund is already at the highest rank.');
      return;
    }
    const nextLevel = LEVELS[career.level];
    const reason = `${nextLevel.name} (rank ${career.level + 1})`;
    const r = xp.spend(ADVANCE_COST, reason, 'career');
    if (!r.ok) {
      Alert.alert('Not enough XP', r.message);
      return;
    }
    career.advance();
    Alert.alert('Advanced!', `You are now a ${nextLevel.name} (${nextLevel.status}).`);
  };

  const nextRankName = LEVELS[Math.min(LEVELS.length - 1, career.level)].name;

  return (
    <ScreenContainer>
      <Hero
        title="Career"
        subRow={
          <>
            <Text style={styles.sub}>Roadwarden · 4-rank warrior career</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>Currently {career.name} (rank {career.level})</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>{xp.current} XP available</Text>
          </>
        }
      />

      <Section title="Career path" />

      <View style={styles.path}>
        {LEVELS.map((l, i) => {
          const done = l.n < career.level;
          const current = l.n === career.level;
          const dotColor = current ? colors.empire : done ? colors.brass : colors.borderStrong;
          const dotBg = current ? colors.empire : done ? colors.brass : colors.surface;
          const lineColor = done || current ? colors.brass : colors.divider;
          return (
            <View key={l.n} style={styles.pathCell}>
              <View
                style={[
                  styles.line,
                  {
                    backgroundColor: lineColor,
                    left: i === 0 ? '50%' : 0,
                    right: i === LEVELS.length - 1 ? '50%' : 0,
                  },
                ]}
              />
              <View
                style={[
                  styles.dot,
                  { borderColor: dotColor, backgroundColor: dotBg },
                ]}
              >
                <Text
                  style={[
                    styles.dotText,
                    { color: current || done ? '#fff' : colors.ink3 },
                  ]}
                >
                  {l.n}
                </Text>
              </View>
              <Text
                style={[
                  styles.levelName,
                  current ? { color: colors.empire } : null,
                ]}
              >
                {l.name}
              </Text>
              <Text style={styles.levelMeta}>{l.status}</Text>
              <Text style={styles.levelMeta}>{l.xp} XP earned</Text>
            </View>
          );
        })}
      </View>

      <Section
        title={career.canAdvance ? `Advance to rank ${career.level + 1}` : 'Top of career'}
        aside={`${ready}/${required.length} skills ready`}
      />

      <Card flush>
        <CardHead
          title={`${nextRankName} requirements`}
          right={
            <Pill variant={ok ? 'success' : 'warn'}>
              {ok ? 'Ready to advance' : 'Not yet met'}
            </Pill>
          }
        />
        <Table>
          <TableRow header>
            <Cell header flex={2}>Required skill</Cell>
            <Cell header num flex={1}>Minimum</Cell>
            <Cell header num flex={1}>Current</Cell>
            <Cell header flex={1.2}>Status</Cell>
          </TableRow>
          {required.map((s, i) => {
            const met = s.adv >= s.min;
            return (
              <TableRow key={s.name} last={i === required.length - 1}>
                <Cell flex={2}>{s.name}</Cell>
                <Cell num flex={1} textStyle={[styles.mono]}>+{s.min}</Cell>
                <Cell num flex={1} textStyle={[styles.mono, { color: met ? colors.success : colors.warning }]}>+{s.adv}</Cell>
                <Cell flex={1.2}>
                  {met ? (
                    <Pill variant="success" iconLeft={<Icon name="check" size={10} color={colors.success} />}>
                      ready
                    </Pill>
                  ) : (
                    <Pill variant="warn">{s.min - s.adv} more</Pill>
                  )}
                </Cell>
              </TableRow>
            );
          })}
        </Table>
        <View style={styles.advanceFoot}>
          <View style={layoutStyles.rowBetween}>
            <View>
              <Text style={styles.label}>Advance cost</Text>
              <Text style={[styles.cost, tabular]}>{ADVANCE_COST} XP</Text>
            </View>
            <Button
              variant="primary"
              disabled={!ok || !career.canAdvance}
              onPress={tryAdvance}
            >
              {career.canAdvance ? `Advance to rank ${career.level + 1}` : 'Maxed'}
            </Button>
          </View>
        </View>
      </Card>

      <Section title="Rank talents (4)" />
      <View style={styles.talentRow}>
        {talents.map((t) => (
          <Pressable
            key={t.name}
            style={({ pressed }) => [styles.talentCell, pressed && { opacity: 0.7 }]}
            onPress={() =>
              Alert.alert(
                t.name,
                t.done ? 'Already taken at this rank.' : 'Buy this on the Talents screen.'
              )
            }
            hitSlop={4}
          >
            <Card tight style={{ flex: 1 }}>
              <View style={layoutStyles.rowBetween}>
                <Text style={styles.talentName}>{t.name}</Text>
                {t.done ? (
                  <Icon name="check" size={14} color={colors.success} />
                ) : (
                  <Pill variant="brass" size={10}>buyable</Pill>
                )}
              </View>
            </Card>
          </Pressable>
        ))}
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  sep: { color: colors.ink4 },
  path: { flexDirection: 'row', position: 'relative' },
  pathCell: {
    flex: 1,
    paddingHorizontal: 10,
    alignItems: 'center',
    position: 'relative',
  },
  line: {
    height: 2,
    position: 'absolute',
    top: 16,
  },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    zIndex: 2,
  },
  dotText: {
    fontFamily: fontFamilies.display,
    fontSize: 15,
  },
  levelName: {
    fontFamily: fontFamilies.display,
    fontSize: 15,
    color: colors.ink,
    textAlign: 'center',
  },
  levelMeta: {
    fontFamily: fontFamilies.mono,
    fontSize: 10,
    color: colors.ink3,
    marginTop: 2,
  },
  mono: { fontFamily: fontFamilies.monoMedium },
  advanceFoot: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  label: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  cost: {
    fontFamily: fontFamilies.display,
    fontSize: 22,
    color: colors.ink,
    marginTop: 4,
  },
  talentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  talentCell: { flexBasis: '23%', flexGrow: 1, minWidth: 160 },
  talentName: {
    fontFamily: fontFamilies.display,
    fontSize: 14,
    color: colors.ink,
  },
});
