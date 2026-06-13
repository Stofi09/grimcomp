import React from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { useCareer } from '@/hooks/useCareer';
import { useXp } from '@/hooks/useXp';
import { useStoredState } from '@/hooks/useStoredState';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors, fontFamilies } from '@/theme';
import { tabular, layoutStyles } from '@/components/primitives';

// Per-character career-rank requirements. Sigmund's are modelled in detail
// (Roadwarden → Mounted Sergeant from the WFRP4e core book); other characters
// fall back to an empty list and the screen surfaces a placeholder.
const REQS_BY_CHAR: Record<string, Array<{ name: string; min: number }>> = {
  c1: [
    { name: 'Ride (Horse)', min: 10 },
    { name: 'Perception', min: 10 },
    { name: 'Melee (Basic)', min: 10 },
    { name: 'Ranged (Bow)', min: 10 },
    { name: 'Outdoor Survival', min: 5 },
    { name: 'Intimidate', min: 5 },
    { name: 'Track', min: 5 },
    { name: 'Lore (Heraldry)', min: 5 },
  ],
};

// XP to advance to the next level of the CURRENT career. WFRP 4e core p.49:
// 100 XP to enter the next level (or a career in the same class); 200 only for
// a brand-new career — not modelled here, since this screen only does
// same-career rank-ups.
const ADVANCE_COST = 100;

export const CareerScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const career = useCareer();
  const xp = useXp();

  // Live skill advances per character.
  const [skillAdv] = useStoredState<Record<string, number>>(
    characterKey(id, 'skills.adv'),
    Object.fromEntries(c.skills.map(s => [s.name, s.adv]))
  );

  const reqsForChar = REQS_BY_CHAR[id] ?? [];
  const required = reqsForChar.map(r => ({ ...r, adv: skillAdv[r.name] ?? 0 }));
  const ready = required.filter(s => s.adv >= s.min).length;
  // When a character's per-rank requirements aren't modelled, don't hard-block
  // advancement — let them spend the XP rather than be stuck forever.
  const ok = required.length > 0 ? ready === required.length : true;

  // Per-rank picked talents — kept simple: the first N talents in the
  // character template are considered "taken" at the current rank.
  const talents = c.talents.slice(0, 4).map((t, i) => ({
    name: t.name,
    done: i < career.level - 1 || t.times > 1,
  }));

  const tryAdvance = () => {
    if (!ok) return;
    if (!career.canAdvance) {
      Alert.alert('Top of career', `${c.name} is already at the highest rank.`);
      return;
    }
    const nextRank = career.ranks[career.level]; // 0-indexed; career.level is the *current* rank
    const reason = `${nextRank.name} (rank ${career.level + 1})`;
    const r = xp.spend(ADVANCE_COST, reason, 'career');
    if (!r.ok) {
      Alert.alert('Not enough XP', r.message);
      return;
    }
    career.advance();
    Alert.alert('Advanced!', `You are now a ${nextRank.name} (${nextRank.status}).`);
  };

  const nextRankName = career.ranks[Math.min(career.ranks.length - 1, career.level)]?.name ?? '';

  return (
    <ScreenContainer>
      <Hero
        title="Career"
        subRow={
          <>
            <Text style={styles.sub}>{c.career} · {career.ranks.length}-rank {c.class.toLowerCase()} career</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>Currently {career.name} (rank {career.level})</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>{xp.current} XP available</Text>
          </>
        }
      />

      <Section title="Career path" />

      <View style={styles.path}>
        {career.ranks.map((rank, i) => {
          const done = rank.level < career.level;
          const current = rank.level === career.level;
          const dotColor = current ? colors.empire : done ? colors.brass : colors.borderStrong;
          const dotBg = current ? colors.empire : done ? colors.brass : colors.surface;
          const lineColor = done || current ? colors.brass : colors.divider;
          const cumulativeXp = i * ADVANCE_COST;
          return (
            <View key={rank.level} style={styles.pathCell}>
              <View
                style={[
                  styles.line,
                  {
                    backgroundColor: lineColor,
                    left: i === 0 ? '50%' : 0,
                    right: i === career.ranks.length - 1 ? '50%' : 0,
                  },
                ]}
              />
              <View style={[styles.dot, { borderColor: dotColor, backgroundColor: dotBg }]}>
                <Text style={[styles.dotText, { color: current || done ? '#fff' : colors.ink3 }]}>
                  {rank.level}
                </Text>
              </View>
              <Text style={[styles.levelName, current ? { color: colors.empire } : null]}>
                {rank.name}
              </Text>
              <Text style={styles.levelMeta}>{rank.status}</Text>
              <Text style={styles.levelMeta}>{cumulativeXp} XP earned</Text>
            </View>
          );
        })}
      </View>

      <Section
        title={career.canAdvance ? `Advance to rank ${career.level + 1}` : 'Top of career'}
        aside={required.length > 0 ? `${ready}/${required.length} skills ready` : 'requirements not yet modelled'}
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
