import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { type Weapon } from '@/data/character';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useStoredState } from '@/hooks/useStoredState';
import { useConditions } from '@/hooks/useConditions';
import { resolveTest, outcomeLabel, formatTestResult } from '@/utils/roll';
import { Hero } from '@/components/Hero';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { HitLocationFigure } from '@/components/HitLocationFigure';
import { colors, fontFamilies } from '@/theme';
import { layoutStyles } from '@/components/primitives';

// Pick the test characteristic from the weapon's group. Bow / crossbow / etc.
// → BS; everything else → WS.
const charForWeapon = (w: Weapon): 'ws' | 'bs' => {
  const g = w.group.toLowerCase();
  return /bow|cross|sling|throw|gun|fire/.test(g) ? 'bs' : 'ws';
};

// Pick the matching skill name from the weapon group, so we can read the
// correct skill advance from the live skill-advances map.
const skillForWeapon = (w: Weapon): string =>
  charForWeapon(w) === 'bs' ? `Ranged (${w.group})` : `Melee (${w.group})`;

// Compute final damage. WFRP damage strings are like "SB+4", "4", "SB+2".
// SB = Strength bonus.
const computeDamage = (formula: string, sb: number): number => {
  const m = formula.match(/(SB)?\s*([+-]?\d+)?/i);
  if (!m) return 0;
  const useSb = !!m[1];
  const flat = m[2] ? parseInt(m[2], 10) : 0;
  return (useSb ? sb : 0) + flat;
};

export const CombatScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const { get: getChar } = useCharacteristics();
  const { modifier: condMod } = useConditions();
  const [skillAdv] = useStoredState<Record<string, number>>(
    characterKey(id, 'skills.adv'),
    Object.fromEntries(c.skills.map(s => [s.name, s.adv]))
  );
  const totalAP = c.ap.head + c.ap.body + c.ap.arm_l + c.ap.arm_r + c.ap.leg_l + c.ap.leg_r;
  const sb = Math.floor((c.characteristics.find(x => x.key === 's')!.init + getChar('s')) / 10);

  // Test target = base char value + skill advance for the matching skill.
  const targetForWeapon = (w: Weapon): number => {
    const ch = c.characteristics.find(x => x.key === charForWeapon(w))!;
    const adv = skillAdv[skillForWeapon(w)] ?? 0;
    return ch.init + getChar(charForWeapon(w)) + adv;
  };

  const attack = (w: Weapon) => {
    const target = targetForWeapon(w);
    const r = resolveTest({ target, modifier: condMod.total, label: w.name });
    const dmg = r.success ? computeDamage(w.dmg, sb) + Math.max(0, r.sl) : 0;
    const dmgLine = r.success ? `\n\nDamage: ${dmg}  (${w.dmg} + ${Math.max(0, r.sl)} SL)` : '';
    const condLine = condMod.parts.length
      ? '\n\nFrom conditions:\n' + condMod.parts.map(p => `  • ${p.name} ×${p.stacks} → ${p.modifier > 0 ? '+' : ''}${p.modifier}`).join('\n')
      : '';
    Alert.alert(
      `${w.name} — ${outcomeLabel(r.outcome)}`,
      formatTestResult(r) + dmgLine + condLine,
    );
  };

  return (
    <ScreenContainer>
      <Hero
        title="Combat"
        subRow={<Text style={styles.sub}>Weapons, armour, and hit locations.</Text>}
      />

      <View style={styles.row}>
        <Card flush style={styles.figureCard}>
          <CardHead title="Hit Locations" />
          <View style={styles.figureBox}>
            <HitLocationFigure ap={c.ap} />
          </View>
          <View style={styles.figureFoot}>
            <View style={layoutStyles.rowBetween}>
              <Text style={styles.metaMono}>TOTAL AP</Text>
              <Text style={styles.totalMono}>{totalAP}</Text>
            </View>
          </View>
        </Card>

        <View style={{ flex: 1, gap: 16, minWidth: 360 }}>
          <Card flush>
            <CardHead
              title="Weapons"
              right={
                <Button
                  variant="ghost"
                  iconLeft={<Icon name="plus" size={12} color={colors.ink2} />}
                  onPress={() => Alert.alert('New weapon', 'Adding new weapons is not wired up.')}
                >
                  New
                </Button>
              }
            />
            <Table>
              <TableRow header>
                <Cell header flex={2}>Weapon</Cell>
                <Cell header flex={1.1}>Group</Cell>
                <Cell header num flex={0.6}>Enc.</Cell>
                <Cell header flex={1}>Reach/Range</Cell>
                <Cell header flex={0.9}>Damage</Cell>
                <Cell header flex={1.4}>Qualities</Cell>
                <Cell header flex={0.5}> </Cell>
              </TableRow>
              {c.weapons.map((w, i) => (
                <TableRow key={i} last={i === c.weapons.length - 1}>
                  <Cell flex={2} textStyle={{ fontFamily: fontFamilies.bodySemibold }}>{w.name}</Cell>
                  <Cell flex={1.1} textStyle={{ color: colors.ink3 }}>{w.group}</Cell>
                  <Cell num flex={0.6}>{w.enc}</Cell>
                  <Cell flex={1} textStyle={{ fontFamily: fontFamilies.mono }}>{w.reach || w.range || '—'}</Cell>
                  <Cell flex={0.9} textStyle={{ fontFamily: fontFamilies.mono }}>{w.dmg}</Cell>
                  <Cell flex={1.4}>
                    <View style={styles.qualRow}>
                      {w.qual.map(q => <Pill key={q} size={10}>{q}</Pill>)}
                    </View>
                  </Cell>
                  <Cell flex={0.5} align="right">
                    <Button
                      variant="ghost"
                      iconLeft={<Icon name="dice" size={13} color={colors.ink2} />}
                      onPress={() => attack(w)}
                    >{''}</Button>
                  </Cell>
                </TableRow>
              ))}
            </Table>
          </Card>

          <Card flush>
            <CardHead
              title="Armour"
              right={
                <Button
                  variant="ghost"
                  iconLeft={<Icon name="plus" size={12} color={colors.ink2} />}
                  onPress={() => Alert.alert('New armour', 'Adding new armour is not wired up.')}
                >
                  New
                </Button>
              }
            />
            <Table>
              <TableRow header>
                <Cell header flex={2}>Piece</Cell>
                <Cell header flex={1.6}>Locations</Cell>
                <Cell header num flex={0.6}>Enc.</Cell>
                <Cell header num flex={0.6}>AP</Cell>
                <Cell header flex={1.4}>Qualities</Cell>
              </TableRow>
              {c.armour.map((a, i) => (
                <TableRow key={i} last={i === c.armour.length - 1}>
                  <Cell flex={2} textStyle={{ fontFamily: fontFamilies.bodySemibold }}>{a.name}</Cell>
                  <Cell flex={1.6} textStyle={{ color: colors.ink3 }}>{a.locs.join(', ')}</Cell>
                  <Cell num flex={0.6}>{a.enc}</Cell>
                  <Cell num flex={0.6} textStyle={{ color: colors.brass, fontFamily: fontFamilies.monoMedium }}>{a.ap}</Cell>
                  <Cell flex={1.4}>
                    <View style={styles.qualRow}>
                      {a.qual.map(q => <Pill key={q} size={10}>{q}</Pill>)}
                    </View>
                  </Cell>
                </TableRow>
              ))}
            </Table>
          </Card>
        </View>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  row: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginTop: 8 },
  figureCard: { width: 320, flexShrink: 0 },
  figureBox: { padding: 20, alignItems: 'center', justifyContent: 'center' },
  figureFoot: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  metaMono: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    color: colors.ink3,
    letterSpacing: 0.6,
  },
  totalMono: {
    fontFamily: fontFamilies.monoMedium,
    fontSize: 13,
    color: colors.ink,
  },
  qualRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
});
