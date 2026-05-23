import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { type Critical } from '@/data/character';
import { useStoredState } from '@/hooks/useStoredState';
import { useConditions } from '@/hooks/useConditions';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useCharacterCollection } from '@/hooks/useCharacterCollection';
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
  const tb = chars.find(x => x.key === 't')?.bonus ?? 0;

  // Live critical wounds + the shared conditions map (so "End of scene" can
  // tick conditions down too).
  const crits = useCharacterCollection<Critical>('criticals', c.criticals);
  const [condMap, setCondMap] = useStoredState<Record<string, number>>(
    characterKey(id, 'conditions'),
    Object.fromEntries(names.map(t => [t, 0])),
  );

  const endOfScene = () => {
    // Tick every active critical's heal-days down by 1; remove any that reach 0.
    const before = crits.items.length;
    const next = crits.items
      .map(cr => ({ ...cr, days: Math.max(0, cr.days - 1) }))
      .filter(cr => cr.days > 0);
    const healed = before - next.length;
    crits.replace(next);

    // Tick down most conditions by 1 (per WFRP 4e p.169 — they fade unless
    // sustained). Surprised always clears at scene-end.
    let removed = 0;
    setCondMap(prev => {
      const out: Record<string, number> = { ...prev };
      for (const k of Object.keys(out)) {
        const v = out[k] ?? 0;
        if (v <= 0) continue;
        const dec = k === 'Surprised' ? v : 1;
        const after = Math.max(0, v - dec);
        if (after === 0 && v > 0) removed += 1;
        out[k] = after;
      }
      return out;
    });

    Alert.alert(
      'End of scene',
      `Fortune refreshed.\n` +
      `${healed} critical${healed === 1 ? '' : 's'} healed.\n` +
      `${removed} condition${removed === 1 ? '' : 's'} cleared, the rest tick down by 1.`,
    );
    // Silence unused-var lint
    void condMap;
  };

  const addCritical = () => {
    const fresh = newCritical();
    crits.add(fresh);
    Alert.alert(
      `Critical: ${fresh.name}`,
      `Location: ${fresh.loc}\nRoll: ${fresh.roll}\n\n${fresh.effect}\n\nHeals in ${fresh.days} day${fresh.days === 1 ? '' : 's'}.`,
    );
  };

  const resolveCritical = (index: number) => {
    const cr = crits.items[index];
    crits.remove(index);
    Alert.alert('Resolved', `${cr.name} marked as healed.`);
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
            <Text style={styles.metaMono}>max {c.wounds.max} = SB + 2×TB + WPB</Text>
          </View>
          <View style={[layoutStyles.row, { gap: 16, marginTop: 10, alignItems: 'baseline' }]}>
            <Text style={[styles.bigEmpire, tabular]}>{wounds}</Text>
            <Text style={styles.bigFrac}>/ {c.wounds.max}</Text>
            <View style={{ flex: 1 }} />
            <Stepper value={wounds} min={0} max={c.wounds.max} onChange={setWounds} />
          </View>
          <Bar value={wounds / c.wounds.max} variant="empire" large style={{ marginTop: 14 }} />
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
              onPress={() => {
                setWounds(w => Math.min(c.wounds.max, w + tb));
                Alert.alert('Rest', `Recovered ${tb} wounds (TB).`);
              }}
            >
              Rest (recover TB)
            </Button>
            <Button
              iconLeft={<Icon name="dice" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={() => {
                setWounds(w => Math.min(c.wounds.max, w + 4));
                Alert.alert('Healing Draught', 'Recovered 4 wounds.');
              }}
            >
              Use healing draught
            </Button>
            <Button
              iconLeft={<Icon name="flame" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={endOfScene}
            >
              End of scene
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
                  onPress={() => resolveCritical(i)}
                >{''}</Button>
              </Cell>
            </TableRow>
          ))}
          {crits.items.length === 0 ? (
            <TableRow last>
              <Cell flex={1} textStyle={{ color: colors.ink3, fontStyle: 'italic' }}>
                No active criticals. End of scene ticks down healing days.
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
