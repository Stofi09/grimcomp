import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { computeMaxWounds, SMALL_SPECIES, type Critical } from '@/data/character';
import { useStoredState } from '@/hooks/useStoredState';
import { useConditions } from '@/hooks/useConditions';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useTalents } from '@/hooks/useTalents';
import { useCharacterCollection } from '@/hooks/useCharacterCollection';
import {
  advanceNativeCriticalHealingDay,
  clearNativeSceneEndConditions,
  locateCriticalOccurrence,
  removeCriticalOccurrence,
  type NativeSceneEndResult,
} from './nativeWoundsState';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card, CardHead } from '@/components/Card';
import { Bar } from '@/components/Bar';
import { Chip } from '@/components/Chip';
import { Stepper } from '@/components/Stepper';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors, fontFamilies } from '@/theme';
import { tabular, layoutStyles } from '@/components/primitives';

// Hit-location table for new critical rolls. Per WFRP 4e p.166 the body chart
// uses tens-digit lookup; the simplified version below is good enough for the
// prototype's "spawn a critical with a random location" flow.
const LOC_FROM_ROLL = (roll: number): string => {
  if (roll <= 10) return 'Head';
  if (roll <= 20) return 'Right Leg';
  if (roll <= 35) return 'Left Leg';
  if (roll <= 50) return 'Body';
  if (roll <= 70) return 'Right Arm';
  if (roll <= 85) return 'Left Arm';
  return 'Body';
};

const PREFAB_CRITICALS: Array<Omit<Critical, 'loc' | 'roll'>> = [
  { name: 'Bruised Muscle', effect: 'Painful throb. −10 to physical tests for 1 round.', days: 2 },
  { name: 'Crushed Bone',   effect: 'A grinding crack. −10 to all tests using that location.', days: 7 },
  { name: 'Torn Tendon',    effect: 'Movement halved when the location is used.', days: 14 },
  { name: 'Severed Artery', effect: 'Bleeding ×2 until staunched.', days: 21 },
  { name: 'Deep Cut',       effect: 'Bleeding 1; cosmetic scar.', days: 5 },
];

const rollD100 = () => Math.floor(Math.random() * 100) + 1;

const newCritical = (): Critical => {
  const r = rollD100();
  const tpl = PREFAB_CRITICALS[Math.floor(Math.random() * PREFAB_CRITICALS.length)];
  return { loc: LOC_FROM_ROLL(r), roll: r, ...tpl };
};

export const WoundsScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const [wounds, setWounds] = useStoredState(characterKey(id, 'wounds'), c.wounds.current);
  const { conds, cycle, names } = useConditions();
  const { list: chars } = useCharacteristics();
  const { list: talentList } = useTalents();
  const tb = chars.find(x => x.key === 't')?.bonus ?? 0;
  const sb = chars.find(x => x.key === 's')?.bonus ?? 0;
  const wpb = chars.find(x => x.key === 'wp')?.bonus ?? 0;
  // Max Wounds recomputed live from current bonuses (Halflings omit SB; Hardy
  // adds TB per rank).
  const small = SMALL_SPECIES.includes(c.species);
  const hardyRanks = talentList.find(t => t.name === 'Hardy')?.times ?? 0;
  const woundsMax = computeMaxWounds(sb, tb, wpb, c.species, hardyRanks);

  // Live critical wounds and conditions use separate clocks: healing advances
  // by day, while only explicitly scene-scoped conditions clear at scene end.
  const crits = useCharacterCollection<Critical>('criticals', c.criticals);
  const [, setCondMap] = useStoredState<Record<string, number>>(
    characterKey(id, 'conditions'),
    Object.fromEntries(names.map(t => [t, 0])),
  );
  const endOfSceneRef = useRef(false);
  const criticalActionRef = useRef(false);
  const [endingScene, setEndingScene] = useState(false);
  const [criticalActionPending, setCriticalActionPending] = useState(false);

  const endOfScene = async () => {
    if (endOfSceneRef.current) return;
    let summary: NativeSceneEndResult = {
      conditions: {},
      clearedConditions: 0,
      clearedStacks: 0,
    };
    endOfSceneRef.current = true;
    setEndingScene(true);
    const durability = await (async () => {
      try {
        return await setCondMap((previous) => {
          summary = clearNativeSceneEndConditions(previous);
          return summary.conditions;
        });
      } finally {
        endOfSceneRef.current = false;
        setEndingScene(false);
      }
    })();
    if (!durability.ok) {
      Alert.alert('Could not end scene', durability.error.message);
      return;
    }

    Alert.alert(
      'End of scene',
      summary.clearedConditions > 0
        ? `Cleared ${summary.clearedStacks} Surprised stack${summary.clearedStacks === 1 ? '' : 's'}. Other conditions, Fortune, and healing days were not changed.`
        : 'No active conditions use the scene-end clock. Fortune and healing days were not changed.',
    );
  };

  const advanceHealingDay = async () => {
    if (criticalActionRef.current) return;
    if (crits.items.length === 0) {
      Alert.alert('Advance healing day', 'No active critical wounds to advance.');
      return;
    }
    criticalActionRef.current = true;
    setCriticalActionPending(true);
    let result = advanceNativeCriticalHealingDay(crits.items);
    try {
      const durability = await crits.replace((current) => {
        result = advanceNativeCriticalHealingDay(current);
        return result.criticals;
      });
      if (!durability.ok) {
        Alert.alert('Could not advance healing', durability.error.message);
        return;
      }
      Alert.alert(
        'Healing day advanced',
        `${result.criticals.length} critical${result.criticals.length === 1 ? '' : 's'} still healing; ${result.healed} resolved. Scene conditions and Fortune were not changed.`,
      );
    } finally {
      criticalActionRef.current = false;
      setCriticalActionPending(false);
    }
  };

  const addCritical = async () => {
    if (criticalActionRef.current) return;
    criticalActionRef.current = true;
    setCriticalActionPending(true);
    try {
      const fresh = newCritical();
      const durability = await crits.add(fresh);
      if (!durability.ok) {
        Alert.alert('Could not add critical', durability.error.message);
        return;
      }
      Alert.alert(
        `Critical: ${fresh.name}`,
        `Location: ${fresh.loc}\nRoll: ${fresh.roll}\n\n${fresh.effect}\n\nHeals in ${fresh.days} day${fresh.days === 1 ? '' : 's'}.`,
      );
    } finally {
      criticalActionRef.current = false;
      setCriticalActionPending(false);
    }
  };

  const resolveCritical = async (index: number) => {
    if (criticalActionRef.current) return;
    const located = locateCriticalOccurrence(crits.items, index);
    if (!located) return;
    const { critical: cr, occurrence } = located;
    criticalActionRef.current = true;
    setCriticalActionPending(true);
    let removed = false;
    try {
      const durability = await crits.replace((current) => {
        const result = removeCriticalOccurrence(current, cr, occurrence);
        removed = result.removed;
        return result.criticals;
      });
      if (!durability.ok) {
        Alert.alert('Could not resolve critical', durability.error.message);
        return;
      }
      if (!removed) {
        Alert.alert('Critical changed', 'That critical wound changed before it could be resolved. Review the current list and retry.');
        return;
      }
      Alert.alert('Resolved', `${cr.name} marked as healed.`);
    } finally {
      criticalActionRef.current = false;
      setCriticalActionPending(false);
    }
  };

  const rest = async () => {
    const durability = await setWounds(w => Math.min(woundsMax, w + tb));
    if (!durability.ok) {
      Alert.alert('Could not save rest', durability.error.message);
      return;
    }
    Alert.alert('Rest', `Recovered ${tb} wounds (TB).`);
  };

  const useHealingDraught = async () => {
    const durability = await setWounds(w => Math.min(woundsMax, w + 4));
    if (!durability.ok) {
      Alert.alert('Could not use draught', durability.error.message);
      return;
    }
    Alert.alert('Healing Draught', 'Recovered 4 wounds.');
  };

  return (
    <ScreenContainer>
      <Hero
        title="Wounds & Conditions"
        subRow={<Text style={styles.sub}>Track combat health, critical wounds, and recovery.</Text>}
      />

      <View style={styles.row}>
        <Card style={[styles.flexBig]}>
          <View style={layoutStyles.rowBetween}>
            <Text style={styles.label}>Current wounds</Text>
            <Text style={styles.metaMono}>max {woundsMax} = {small ? '' : 'SB + '}2×TB + WPB{hardyRanks > 0 ? ' + Hardy' : ''}</Text>
          </View>
          <View style={[layoutStyles.row, { gap: 16, marginTop: 10, alignItems: 'baseline' }]}>
            <Text style={[styles.bigEmpire, tabular]}>{wounds}</Text>
            <Text style={styles.bigFrac}>/ {woundsMax}</Text>
            <View style={{ flex: 1 }} />
            <Stepper accessibilityLabel="Current wounds" value={wounds} min={0} max={woundsMax} onChange={setWounds} />
          </View>
          <Bar value={woundsMax > 0 ? wounds / woundsMax : 0} variant="empire" large style={{ marginTop: 14 }} />
          <View style={[layoutStyles.rowBetween, { marginTop: 8 }]}>
            <Text style={styles.metaMono}>0 · roll critical</Text>
            <Text style={styles.metaMono}>max · full health</Text>
          </View>
        </Card>

        <Card style={styles.flexSmall}>
          <Text style={styles.label}>Quick actions</Text>
          <View style={{ gap: 6, marginTop: 10 }}>
            <Button
              iconLeft={<Icon name="heart" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={rest}
            >
              Rest (recover TB)
            </Button>
            <Button
              iconLeft={<Icon name="dice" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={useHealingDraught}
            >
              Use healing draught
            </Button>
            <Button
              iconLeft={<Icon name="flame" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={endOfScene}
              disabled={endingScene}
            >
              {endingScene ? 'Ending scene…' : 'End of scene (scene conditions)'}
            </Button>
            <Button
              iconLeft={<Icon name="heart" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={advanceHealingDay}
              disabled={criticalActionPending}
            >
              {criticalActionPending ? 'Saving critical wounds…' : 'Advance healing day'}
            </Button>
          </View>
        </Card>
      </View>

      <Section title="Conditions" aside="tap to add a stack · long-press for the rule" />
      <View style={styles.chips}>
        {names.map(t => {
          const n = conds[t] ?? 0;
          return <Chip key={t} label={t} count={n} on={n > 0} onPress={() => cycle(t)} />;
        })}
      </View>

      <Section title="Critical Wounds" aside="d100 + hit location" />
      <Card flush>
        <CardHead
          title="Active critical wounds"
          right={
            <Button
              variant="primary"
              iconLeft={<Icon name="dice" size={12} color={colors.ivory} />}
              onPress={addCritical}
              disabled={criticalActionPending}
            >
              New critical
            </Button>
          }
        />
        <Table>
          <TableRow header>
            <Cell header flex={1}>Location</Cell>
            <Cell header num flex={0.7}>Roll</Cell>
            <Cell header flex={2}>Wound</Cell>
            <Cell header flex={3}>Effect</Cell>
            <Cell header num flex={1}>Heal days</Cell>
            <Cell header flex={0.5}> </Cell>
          </TableRow>
          {crits.items.map((cr, i) => (
            <TableRow key={i} last={i === crits.items.length - 1}>
              <Cell flex={1}>{cr.loc}</Cell>
              <Cell num flex={0.7} textStyle={{ fontFamily: fontFamilies.mono }}>{cr.roll}</Cell>
              <Cell flex={2} textStyle={{ fontFamily: fontFamilies.bodySemibold }}>{cr.name}</Cell>
              <Cell flex={3} textStyle={{ color: colors.ink3 }}>{cr.effect}</Cell>
              <Cell num flex={1} textStyle={{ fontFamily: fontFamilies.mono }}>{cr.days}</Cell>
              <Cell flex={0.5} align="right">
                <Button
                  variant="ghost"
                  iconLeft={<Icon name="check" size={13} color={colors.success} />}
                  accessibilityLabel={`Resolve ${cr.name} critical wound`}
                  onPress={() => resolveCritical(i)}
                  disabled={criticalActionPending}
                >{''}</Button>
              </Cell>
            </TableRow>
          ))}
          {crits.items.length === 0 ? (
            <TableRow last>
              <Cell flex={1} textStyle={{ color: colors.ink3, fontStyle: 'italic' }}>
                No active criticals. "Advance healing day" ticks down healing days.
              </Cell>
            </TableRow>
          ) : null}
        </Table>
      </Card>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  flexBig: { flex: 2, minWidth: 360 },
  flexSmall: { flex: 1, minWidth: 240 },
  label: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  metaMono: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    color: colors.ink3,
  },
  bigEmpire: {
    fontFamily: fontFamilies.display,
    fontSize: 56,
    color: colors.empire,
    lineHeight: 56,
  },
  bigFrac: { fontSize: 16, color: colors.ink3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 20 },
});
