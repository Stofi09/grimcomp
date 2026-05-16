import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { type Weapon, type Armour } from '@/data/character';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useStoredState } from '@/hooks/useStoredState';
import { useConditions } from '@/hooks/useConditions';
import { useCharacterCollection } from '@/hooks/useCharacterCollection';
import { resolveTest, outcomeLabel, formatTestResult } from '@/utils/roll';
import { Hero } from '@/components/Hero';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { HitLocationFigure } from '@/components/HitLocationFigure';
import { EditSheet } from '@/components/EditSheet';
import { TextField, NumberField, PickerField, MultiPickerField, QualitiesField } from '@/components/Fields';
import { colors, fontFamilies } from '@/theme';
import { layoutStyles } from '@/components/primitives';

const WEAPON_GROUPS = [
  { value: 'Basic',       label: 'Basic' },
  { value: 'Cavalry',     label: 'Cavalry' },
  { value: 'Fencing',     label: 'Fencing' },
  { value: 'Brawling',    label: 'Brawling' },
  { value: 'Flail',       label: 'Flail' },
  { value: 'Parrying',    label: 'Parrying' },
  { value: 'Polearm',     label: 'Polearm' },
  { value: 'Two-handed',  label: 'Two-handed' },
  { value: 'Bow',         label: 'Bow' },
  { value: 'Crossbow',    label: 'Crossbow' },
  { value: 'Sling',       label: 'Sling' },
  { value: 'Throwing',    label: 'Throwing' },
] as const;

const ARMOUR_LOCS = [
  { value: 'Head',  label: 'Head' },
  { value: 'Body',  label: 'Body' },
  { value: 'Arms',  label: 'Arms' },
  { value: 'Legs',  label: 'Legs' },
] as const;

type WeaponGroup = typeof WEAPON_GROUPS[number]['value'];
type ArmourLoc = typeof ARMOUR_LOCS[number]['value'];

const charForWeapon = (w: Weapon): 'ws' | 'bs' => {
  const g = w.group.toLowerCase();
  return /bow|cross|sling|throw|gun|fire/.test(g) ? 'bs' : 'ws';
};

const skillForWeapon = (w: Weapon): string =>
  charForWeapon(w) === 'bs' ? `Ranged (${w.group})` : `Melee (${w.group})`;

const computeDamage = (formula: string, sb: number): number => {
  const m = formula.match(/(SB)?\s*([+-]?\d+)?/i);
  if (!m) return 0;
  const useSb = !!m[1];
  const flat = m[2] ? parseInt(m[2], 10) : 0;
  return (useSb ? sb : 0) + flat;
};

const blankWeapon = (): Weapon => ({
  name: '', group: 'Basic', enc: 1, reach: 'Average', dmg: 'SB+0', qual: [],
});

const blankArmour = (): Armour => ({
  name: '', locs: ['Body'], enc: 1, ap: 1, qual: [],
});

export const CombatScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const { get: getChar } = useCharacteristics();
  const { modifier: condMod } = useConditions();
  const [skillAdv] = useStoredState<Record<string, number>>(
    characterKey(id, 'skills.adv'),
    Object.fromEntries(c.skills.map(s => [s.name, s.adv]))
  );

  const weapons = useCharacterCollection<Weapon>('weapons', c.weapons);
  const armour = useCharacterCollection<Armour>('armour', c.armour);

  // AP is the sum across the live armour collection by location.
  const ap = useMemo(() => {
    const sums = { head: 0, body: 0, arm_l: 0, arm_r: 0, leg_l: 0, leg_r: 0, shield: 0 };
    for (const a of armour.items) {
      for (const loc of a.locs) {
        if (loc === 'Head') sums.head += a.ap;
        else if (loc === 'Body') sums.body += a.ap;
        else if (loc === 'Arms') { sums.arm_l += a.ap; sums.arm_r += a.ap; }
        else if (loc === 'Legs') { sums.leg_l += a.ap; sums.leg_r += a.ap; }
      }
    }
    return sums;
  }, [armour.items]);

  const totalAP = ap.head + ap.body + ap.arm_l + ap.arm_r + ap.leg_l + ap.leg_r;
  const sb = Math.floor((c.characteristics.find(x => x.key === 's')!.init + getChar('s')) / 10);

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
    Alert.alert(`${w.name} — ${outcomeLabel(r.outcome)}`, formatTestResult(r) + dmgLine + condLine);
  };

  // Edit-sheet state for both weapons + armour.
  const [wEdit, setWEdit] = useState<{ index: number | null; draft: Weapon } | null>(null);
  const [aEdit, setAEdit] = useState<{ index: number | null; draft: Armour } | null>(null);

  const openNewWeapon = () => setWEdit({ index: null, draft: blankWeapon() });
  const openEditWeapon = (i: number) => setWEdit({ index: i, draft: { ...weapons.items[i] } });
  const openNewArmour = () => setAEdit({ index: null, draft: blankArmour() });
  const openEditArmour = (i: number) => setAEdit({ index: i, draft: { ...armour.items[i] } });

  const saveWeapon = () => {
    if (!wEdit) return;
    if (!wEdit.draft.name.trim()) {
      Alert.alert('Name required', 'Give the weapon a name.');
      return;
    }
    if (wEdit.index == null) weapons.add(wEdit.draft);
    else weapons.update(wEdit.index, wEdit.draft);
    setWEdit(null);
  };

  const dropWeapon = () => {
    if (!wEdit || wEdit.index == null) return;
    const name = wEdit.draft.name;
    weapons.remove(wEdit.index);
    setWEdit(null);
    Alert.alert('Dropped', `${name} removed from inventory.`);
  };

  const saveArmour = () => {
    if (!aEdit) return;
    if (!aEdit.draft.name.trim()) {
      Alert.alert('Name required', 'Give the armour a name.');
      return;
    }
    if (aEdit.draft.locs.length === 0) {
      Alert.alert('Pick locations', 'Armour must cover at least one location.');
      return;
    }
    if (aEdit.index == null) armour.add(aEdit.draft);
    else armour.update(aEdit.index, aEdit.draft);
    setAEdit(null);
  };

  const dropArmour = () => {
    if (!aEdit || aEdit.index == null) return;
    const name = aEdit.draft.name;
    armour.remove(aEdit.index);
    setAEdit(null);
    Alert.alert('Removed', `${name} removed from inventory.`);
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
            <HitLocationFigure ap={ap} />
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
                  onPress={openNewWeapon}
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
              {weapons.items.map((w, i) => (
                <TableRow key={`${w.name}-${i}`} last={i === weapons.items.length - 1}>
                  <Cell flex={2}>
                    <Pressable onPress={() => openEditWeapon(i)} hitSlop={4}>
                      <Text style={[styles.weaponName, { fontFamily: fontFamilies.bodySemibold }]}>{w.name}</Text>
                    </Pressable>
                  </Cell>
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
              {weapons.items.length === 0 ? (
                <TableRow last>
                  <Cell flex={1} textStyle={{ color: colors.ink3, fontStyle: 'italic' }}>
                    No weapons. Tap "New" to add one.
                  </Cell>
                </TableRow>
              ) : null}
            </Table>
          </Card>

          <Card flush>
            <CardHead
              title="Armour"
              right={
                <Button
                  variant="ghost"
                  iconLeft={<Icon name="plus" size={12} color={colors.ink2} />}
                  onPress={openNewArmour}
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
              {armour.items.map((a, i) => (
                <TableRow key={`${a.name}-${i}`} last={i === armour.items.length - 1} onPress={() => openEditArmour(i)}>
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
              {armour.items.length === 0 ? (
                <TableRow last>
                  <Cell flex={1} textStyle={{ color: colors.ink3, fontStyle: 'italic' }}>
                    No armour. Tap "New" to add a piece.
                  </Cell>
                </TableRow>
              ) : null}
            </Table>
          </Card>
        </View>
      </View>

      {/* Weapon edit sheet */}
      <EditSheet
        visible={!!wEdit}
        title={wEdit?.index == null ? 'New weapon' : 'Edit weapon'}
        subtitle={wEdit?.index == null ? 'Add a weapon to this character\'s inventory.' : 'Tap Save to commit, or Drop to remove from inventory.'}
        onClose={() => setWEdit(null)}
        onSave={saveWeapon}
        destructive={wEdit?.index != null ? { label: 'Drop', onPress: dropWeapon } : undefined}
      >
        {wEdit ? (
          <>
            <TextField
              label="Name"
              value={wEdit.draft.name}
              onChangeText={t => setWEdit(s => s && ({ ...s, draft: { ...s.draft, name: t } }))}
              placeholder="e.g. Hand Weapon (Sword)"
            />
            <PickerField<WeaponGroup>
              label="Group"
              value={wEdit.draft.group as WeaponGroup}
              onChange={(v) => setWEdit(s => s && ({ ...s, draft: { ...s.draft, group: v } }))}
              options={[...WEAPON_GROUPS]}
              hint="Bow/Crossbow/Sling/Throwing use BS; everything else uses WS."
            />
            <NumberField
              label="Encumbrance"
              value={wEdit.draft.enc}
              onChangeNumber={n => setWEdit(s => s && ({ ...s, draft: { ...s.draft, enc: n } }))}
              min={0}
              max={20}
            />
            <TextField
              label={charForWeapon(wEdit.draft) === 'bs' ? 'Range' : 'Reach'}
              value={(charForWeapon(wEdit.draft) === 'bs' ? wEdit.draft.range : wEdit.draft.reach) ?? ''}
              onChangeText={t => setWEdit(s => {
                if (!s) return s;
                const ranged = charForWeapon(s.draft) === 'bs';
                return { ...s, draft: { ...s.draft, [ranged ? 'range' : 'reach']: t } };
              })}
              placeholder={charForWeapon(wEdit.draft) === 'bs' ? 'e.g. 90' : 'e.g. Average'}
              autoCapitalize="none"
            />
            <TextField
              label="Damage"
              value={wEdit.draft.dmg}
              onChangeText={t => setWEdit(s => s && ({ ...s, draft: { ...s.draft, dmg: t } }))}
              placeholder="SB+4"
              hint="Use SB for Strength Bonus (computed live)."
              autoCapitalize="none"
            />
            <QualitiesField
              label="Qualities"
              value={wEdit.draft.qual}
              onChange={q => setWEdit(s => s && ({ ...s, draft: { ...s.draft, qual: q } }))}
            />
          </>
        ) : null}
      </EditSheet>

      {/* Armour edit sheet */}
      <EditSheet
        visible={!!aEdit}
        title={aEdit?.index == null ? 'New armour' : 'Edit armour'}
        subtitle={aEdit?.index == null ? 'Add a piece of armour. AP stacks per location.' : 'Tap Save to commit, or Remove to drop from inventory.'}
        onClose={() => setAEdit(null)}
        onSave={saveArmour}
        destructive={aEdit?.index != null ? { label: 'Remove', onPress: dropArmour } : undefined}
      >
        {aEdit ? (
          <>
            <TextField
              label="Name"
              value={aEdit.draft.name}
              onChangeText={t => setAEdit(s => s && ({ ...s, draft: { ...s.draft, name: t } }))}
              placeholder="e.g. Mail Shirt"
            />
            <MultiPickerField<ArmourLoc>
              label="Locations"
              selected={aEdit.draft.locs as ArmourLoc[]}
              onChange={(locs) => setAEdit(s => s && ({ ...s, draft: { ...s.draft, locs } }))}
              options={[...ARMOUR_LOCS]}
            />
            <NumberField
              label="Encumbrance"
              value={aEdit.draft.enc}
              onChangeNumber={n => setAEdit(s => s && ({ ...s, draft: { ...s.draft, enc: n } }))}
              min={0}
              max={20}
            />
            <NumberField
              label="AP per location"
              value={aEdit.draft.ap}
              onChangeNumber={n => setAEdit(s => s && ({ ...s, draft: { ...s.draft, ap: n } }))}
              min={0}
              max={6}
              hint="Armour points absorb damage before it hits wounds."
            />
            <QualitiesField
              label="Qualities"
              value={aEdit.draft.qual}
              onChange={q => setAEdit(s => s && ({ ...s, draft: { ...s.draft, qual: q } }))}
            />
          </>
        ) : null}
      </EditSheet>
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
  weaponName: {
    fontSize: 13,
    color: colors.ink,
  },
});
