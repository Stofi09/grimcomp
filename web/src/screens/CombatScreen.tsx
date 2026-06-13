import { useMemo, useState } from 'react';
import { ScreenContainer } from './ScreenContainer';
import { type Weapon, type Armour } from '@/data/character';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useStoredState } from '@/hooks/useStoredState';
import { useConditions } from '@/hooks/useConditions';
import { useCharacterCollection } from '@/hooks/useCharacterCollection';
import { useFigureLabels, useSystemRules, useCharacteristicDefs, useWeapons } from '@/content/useContent';
import type { CombatRules } from '@/content/types';
import { resolveTest, outcomeLabel, formatTestResult } from '@/utils/roll';
import { charVars, evalFormula } from '@/utils/formula';
import { Alert } from '@/ui/alert';
import { Hero } from '@/components/Hero';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { HitLocationFigure } from '@/components/HitLocationFigure';
import { EditSheet } from '@/components/EditSheet';
import { TextField, NumberField, PickerField, MultiPickerField, QualitiesField } from '@/components/Fields';
import { colors } from '@/theme';
import './CombatScreen.css';

// Fallback weapon-group picker options, used only when the loaded packs ship
// no weapons to derive groups from.
const FALLBACK_WEAPON_GROUPS = [
  'Basic', 'Cavalry', 'Fencing', 'Brawling', 'Flail', 'Parrying', 'Polearm',
  'Two-handed', 'Bow', 'Crossbow', 'Sling', 'Throwing',
].map(g => ({ value: g, label: g }));

const ARMOUR_LOCS = [
  { value: 'Head',  label: 'Head' },
  { value: 'Body',  label: 'Body' },
  { value: 'Arms',  label: 'Arms' },
  { value: 'Legs',  label: 'Legs' },
] as const;

type ArmourLoc = typeof ARMOUR_LOCS[number]['value'];

// Hungarian fallbacks for the hit-location figure annotations — overlaid by the
// JSON figureLabels so the registry can rename them per content pack.
const DEFAULT_FIGURE_LABELS = {
  head: 'FEJ',
  body: 'TEST',
  arm_l: 'B. KAR',
  arm_r: 'J. KAR',
  leg_l: 'B. LÁB',
  leg_r: 'J. LÁB',
} as const;

// Weapon group → test characteristic and skill name, per system.combat config.
const charForWeapon = (w: Weapon, combat: CombatRules): string =>
  new RegExp(combat.rangedGroupPattern, 'i').test(w.group) ? combat.rangedChar : combat.meleeChar;

const skillForWeapon = (w: Weapon, combat: CombatRules): string => {
  const pattern = charForWeapon(w, combat) === combat.rangedChar
    ? combat.rangedSkillPattern
    : combat.meleeSkillPattern;
  return pattern.replace('{group}', w.group);
};

// Damage strings ("SB+4") are formulas over the characteristic vars. Malformed
// strings fall back to their first flat number rather than blocking the roll.
const computeDamage = (formula: string, vars: Record<string, number>): number => {
  try {
    return Math.round(evalFormula(formula, vars));
  } catch {
    const m = formula.match(/([+-]?\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
};

const blankWeapon = (): Weapon => ({
  name: '', group: 'Basic', enc: 1, reach: 'Average', dmg: 'SB+0', qual: [],
});

const blankArmour = (): Armour => ({
  name: '', locs: ['Body'], enc: 1, ap: 1, qual: [],
});

export const CombatScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const { list: charList } = useCharacteristics();
  const { modifier: condMod } = useConditions();
  const system = useSystemRules();
  const combat = system.combat;
  const charDefs = useCharacteristicDefs();
  const weaponDefs = useWeapons();
  const figureLabels = { ...DEFAULT_FIGURE_LABELS, ...useFigureLabels() };
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
  const vars = charVars(charList);

  const targetForWeapon = (w: Weapon): number => {
    const ch = charList.find(x => x.key === charForWeapon(w, combat));
    const adv = skillAdv[skillForWeapon(w, combat)] ?? 0;
    return (ch?.current ?? 0) + adv;
  };

  const attack = (w: Weapon) => {
    const target = targetForWeapon(w);
    const r = resolveTest({ target, modifier: condMod.total, label: w.name }, system.test);
    const dmg = r.success ? computeDamage(w.dmg, vars) + Math.max(0, r.sl) : 0;
    const dmgLine = r.success
      ? `\n\nDamage: ${dmg}  (${w.dmg}${r.hasSl ? ` + ${Math.max(0, r.sl)} SL` : ''})`
      : '';
    const condLine = condMod.parts.length
      ? '\n\nFrom conditions:\n' + condMod.parts.map(p => `  • ${p.name} ×${p.stacks} → ${p.modifier > 0 ? '+' : ''}${p.modifier}`).join('\n')
      : '';
    Alert.alert(`${w.name} — ${outcomeLabel(r.outcome)}`, formatTestResult(r) + dmgLine + condLine);
  };

  // Group picker options come from the loaded packs' weapons; the draft's own
  // group is kept selectable even if no pack weapon carries it.
  const groupOptions = useMemo(() => {
    const groups = [...new Set(weaponDefs.map(w => w.group))];
    return groups.length > 0
      ? groups.map(g => ({ value: g, label: g }))
      : FALLBACK_WEAPON_GROUPS;
  }, [weaponDefs]);

  const meleeShort = charDefs.find(d => d.key === combat.meleeChar)?.short ?? combat.meleeChar.toUpperCase();
  const rangedShort = charDefs.find(d => d.key === combat.rangedChar)?.short ?? combat.rangedChar.toUpperCase();

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
        subRow={<span className="cmb-sub">Weapons, armour, and hit locations.</span>}
      />

      <div className="cmb-row">
        <Card flush style={{ width: 320, flexShrink: 0 }}>
          <CardHead title="Hit Locations" />
          <div className="cmb-figure-box">
            <HitLocationFigure ap={ap} labels={figureLabels} />
          </div>
          <div className="cmb-figure-foot">
            <div className="cmb-row-between">
              <span className="cmb-meta-mono">TOTAL AP</span>
              <span className="cmb-total-mono">{totalAP}</span>
            </div>
          </div>
        </Card>

        <div className="cmb-right">
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
                    <button
                      type="button"
                      className="btn-reset cmb-weapon-name"
                      onClick={() => openEditWeapon(i)}
                    >
                      {w.name}
                    </button>
                  </Cell>
                  <Cell flex={1.1} textStyle={{ color: colors.ink3 }}>{w.group}</Cell>
                  <Cell num flex={0.6}>{w.enc}</Cell>
                  <Cell flex={1} textStyle={{ fontFamily: 'var(--font-mono)' }}>{w.reach || w.range || '—'}</Cell>
                  <Cell flex={0.9} textStyle={{ fontFamily: 'var(--font-mono)' }}>{w.dmg}</Cell>
                  <Cell flex={1.4}>
                    <div className="cmb-qual-row">
                      {w.qual.map(q => <Pill key={q} size={10}>{q}</Pill>)}
                    </div>
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
                  <Cell flex={2} textStyle={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{a.name}</Cell>
                  <Cell flex={1.6} textStyle={{ color: colors.ink3 }}>{a.locs.join(', ')}</Cell>
                  <Cell num flex={0.6}>{a.enc}</Cell>
                  <Cell num flex={0.6} textStyle={{ color: colors.brass, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{a.ap}</Cell>
                  <Cell flex={1.4}>
                    <div className="cmb-qual-row">
                      {a.qual.map(q => <Pill key={q} size={10}>{q}</Pill>)}
                    </div>
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
        </div>
      </div>

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
            <PickerField<string>
              label="Group"
              value={wEdit.draft.group}
              onChange={(v) => setWEdit(s => s && ({ ...s, draft: { ...s.draft, group: v } }))}
              options={wEdit.draft.group && !groupOptions.some(o => o.value === wEdit.draft.group)
                ? [...groupOptions, { value: wEdit.draft.group, label: wEdit.draft.group }]
                : groupOptions}
              hint={`Groups matching “${combat.rangedGroupPattern}” test ${rangedShort}; everything else tests ${meleeShort}.`}
            />
            <NumberField
              label="Encumbrance"
              value={wEdit.draft.enc}
              onChangeNumber={n => setWEdit(s => s && ({ ...s, draft: { ...s.draft, enc: n } }))}
              min={0}
              max={20}
            />
            <TextField
              label={charForWeapon(wEdit.draft, combat) === combat.rangedChar ? 'Range' : 'Reach'}
              value={(charForWeapon(wEdit.draft, combat) === combat.rangedChar ? wEdit.draft.range : wEdit.draft.reach) ?? ''}
              onChangeText={t => setWEdit(s => {
                if (!s) return s;
                const ranged = charForWeapon(s.draft, combat) === combat.rangedChar;
                return { ...s, draft: { ...s.draft, [ranged ? 'range' : 'reach']: t } };
              })}
              placeholder={charForWeapon(wEdit.draft, combat) === combat.rangedChar ? 'e.g. 90' : 'e.g. Average'}
              autoCapitalize="none"
            />
            <TextField
              label="Damage"
              value={wEdit.draft.dmg}
              onChangeText={t => setWEdit(s => s && ({ ...s, draft: { ...s.draft, dmg: t } }))}
              placeholder="SB+4"
              hint="A formula over characteristic bonuses by short name (e.g. SB+4), computed live."
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
