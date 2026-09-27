import { useRecordTest } from '@/hooks/useRecordTest';
import { addCriticalConditions, criticalFromDefinition, criticalEffectNotice } from '@/utils/criticalEffects';
import type { AttackHistory } from '@/utils/rollHistory';
import { useDerived } from '@/hooks/useDerived';
import { useMemo, useRef, useState } from 'react';
import { ScreenContainer } from './ScreenContainer';
import { type Weapon, type Armour, type Critical } from '@/data/character';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { runStoredTransaction, useStoredState } from '@/hooks/useStoredState';
import { useConditions } from '@/hooks/useConditions';
import {
  useCharacterCollection,
  type CollectionItemIdentity,
} from '@/hooks/useCharacterCollection';
import { useContent, useFigureLabels, useSystemRules, useCharacteristicDefs, useWeapons, useCapabilities, useHitLocations, useCriticals } from '@/content/useContent';
import type { CombatRules } from '@/content/types';
import { critFromTable } from '@/content/tables';
import { resolveTest, formatTestResult, isDouble, rollExploding, resultLabel, slText } from '@/utils/roll';
import { charVars, evalFormula } from '@/utils/formula';
import { testSafeRegex } from '@/utils/safeRegex';
import {
  apByLocation, apAt, hitLocationFromRoll, applyDamage,
  advantageBonus, resolveAttackOutcome, computeHitDamage, weaponQualityNotes, hasQuality,
  normalizeWeaponDistance, weaponDistance,
  type ApLocation,
} from '@/utils/combat';
import { Alert } from '@/ui/alertStore';
import { Hero } from '@/components/Hero';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Stepper } from '@/components/Stepper';
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

// Fallbacks for the hit-location figure annotations — overlaid by the JSON
// figureLabels so the registry can rename them per content pack.
const DEFAULT_FIGURE_LABELS = {
  head: 'HEAD',
  body: 'BODY',
  arm_l: 'L. ARM',
  arm_r: 'R. ARM',
  leg_l: 'L. LEG',
  leg_r: 'R. LEG',
} as const;

// Friendly labels for the six hit locations a "Take a hit" can strike.
const HIT_LOCATION_OPTIONS: ReadonlyArray<{ value: ApLocation; label: string }> = [
  { value: 'head', label: 'Head' },
  { value: 'body', label: 'Body' },
  { value: 'arm_l', label: 'Left Arm' },
  { value: 'arm_r', label: 'Right Arm' },
  { value: 'leg_l', label: 'Left Leg' },
  { value: 'leg_r', label: 'Right Leg' },
];
const hitLocLabel = (key: ApLocation): string =>
  HIT_LOCATION_OPTIONS.find(o => o.value === key)?.label ?? 'Body';

// Weapon group → test characteristic and skill name, per system.combat config.
const charForWeapon = (w: Weapon, combat: CombatRules): string => {
  // Invalid or backtracking-prone pack patterns fail closed to melee.
  const ranged = testSafeRegex(combat.rangedGroupPattern, w.group);
  return ranged ? combat.rangedChar : combat.meleeChar;
};

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
  const content = useContent();
  const { list: charList } = useCharacteristics();
  const { modifier: condMod, conds, setConds } = useConditions();
  const { maxWounds } = useDerived();
  const recordTest = useRecordTest();
  const system = useSystemRules();
  const combat = system.combat;
  const caps = useCapabilities();
  const charDefs = useCharacteristicDefs();
  const weaponDefs = useWeapons();
  const hitLocations = useHitLocations();
  const prefabCriticals = useCriticals();
  const figureLabels = { ...DEFAULT_FIGURE_LABELS, ...useFigureLabels() };
  const [skillAdv] = useStoredState<Record<string, number>>(
    characterKey(id, 'skills.adv'),
    Object.fromEntries(c.skills.map(s => [s.name, s.adv]))
  );

  const weapons = useCharacterCollection<Weapon>('weapons', c.weapons);
  const armour = useCharacterCollection<Armour>('armour', c.armour);

  // Wounds + criticals share their storage keys with the Wounds screen, so a
  // hit resolved here updates that screen live (useStoredState syncs by key).
  const [wounds, setWounds] = useStoredState(characterKey(id, 'wounds'), c.wounds.current);
  const crits = useCharacterCollection<Critical>('criticals', c.criticals);

  // Advantage (CRB p.163): +10 per point to your combat tests. Persisted so it
  // survives navigation; taking Wounds resets it (handled in resolveHit).
  const [advantage, setAdvantage] = useStoredState(characterKey(id, 'advantage'), 0);

  // AP per location from the live armour collection (shared, tested helper).
  const ap = useMemo(() => apByLocation(armour.items), [armour.items]);

  const totalAP = ap.head + ap.body + ap.arm_l + ap.arm_r + ap.leg_l + ap.leg_r;
  const vars = charVars(charList);
  const toughnessBonus = vars.tb ?? 0;

  const targetForWeapon = (w: Weapon): number => {
    const ch = charList.find(x => x.key === charForWeapon(w, combat));
    const adv = skillAdv[skillForWeapon(w, combat)] ?? 0;
    return (ch?.current ?? 0) + adv;
  };

  // Attack sheet: pick opposed-vs-unopposed before rolling. `defence` 0 = a
  // straight (unopposed) test; > 0 rolls the defender and resolves an Opposed
  // Test (WFRP 4e melee).
  const [atk, setAtk] = useState<{ weapon: Weapon; defence: number; difficulty: number } | null>(null);
  const [attackSettings, setAttackSettings] = useStoredState(characterKey(id, 'combat.attackSettings'), { defence: 0, difficulty: 0 });
  // The remembered defence is a melee Opposed Test setting: a ranged shot opens
  // unopposed, and saving it must not wipe the melee defence.
  const isRangedWeapon = (w: Weapon) => charForWeapon(w, combat) === combat.rangedChar;
  const openAttack = (w: Weapon) => setAtk({
    weapon: w,
    difficulty: attackSettings.difficulty,
    defence: isRangedWeapon(w) ? 0 : attackSettings.defence,
  });

  const fmtSL = (res: { sl: number; success: boolean }) => `${slText(res)} SL`;

  const resolveAttack = () => {
    if (!atk) return;
    const w = atk.weapon;
    const target = targetForWeapon(w);
    const advBonus = advantageBonus(advantage);
    const r = resolveTest({ target, modifier: condMod.total + advBonus + atk.difficulty, label: w.name }, system.test);

    // Opposed melee (defence > 0): higher SL wins even if both tests fail, and
    // the winner's net opposed SL feeds damage. Unopposed attacks still require
    // the attacker's own test to succeed and use that test's SL.
    const opposed = atk.defence > 0;
    let opposedLine = '';
    let landed: boolean;
    let dmgSl: number;
    let defender: AttackHistory['defender'];
    if (opposed) {
      const dr = resolveTest({ target: atk.defence, label: 'Defender' }, system.test);
      defender = { target: atk.defence, roll: dr.roll, sl: dr.sl };
      const attack = resolveAttackOutcome(r.success, r.sl, dr.sl);
      const res = attack.opposed!;
      landed = attack.landed;
      dmgSl = attack.damageSl;
      const verdict = res.winner === 'attacker' ? `you win by ${res.netSL} SL`
        : res.winner === 'defender' ? 'defender turns it aside' : 'draw — nothing lands';
      opposedLine = `\n\nOpposed: you ${fmtSL(r)} vs defender ${fmtSL(dr)} ` +
        `(rolled ${dr.roll} vs ${atk.defence}) → ${verdict}.`;
    } else {
      const attack = resolveAttackOutcome(r.success, r.sl);
      landed = attack.landed;
      dmgSl = attack.damageSl;
    }

    // Damage with quality tweaks (Damaging / Impale fold into the number). The
    // Impale die explodes (WFRP 4e); matched the same way computeHitDamage gates it.
    const impaleRoll = landed && isDouble(r.roll) && hasQuality(w.qual, 'Impale')
      ? rollExploding(10) : 0;
    const dmg = landed
      ? computeHitDamage({ baseDamage: computeDamage(w.dmg, vars), sl: dmgSl, toHitRoll: r.roll, qualities: w.qual, impaleRoll })
      : null;

    const loc = caps.combatHitLocations && landed ? hitLocationFromRoll(r.roll, hitLocations) : null;
    const locLine = loc ? `\n\nHit location: ${loc.label}  (${r.roll} → ${loc.locRoll})` : '';
    const dmgLine = dmg
      ? `\n\nDamage dealt: ${dmg.total}  (${w.dmg}` +
        `${dmg.damagingApplied ? ` + ${dmg.slBonus} units die` : dmg.slBonus ? ` + ${dmg.slBonus} SL` : ''}` +
        `${dmg.impaleExtra ? ` + ${dmg.impaleExtra} Impale` : ''})` +
        `\nThe target subtracts its Toughness Bonus + AP.`
      : '';
    const qualLines = landed ? weaponQualityNotes(w.qual) : [];
    const qualLine = qualLines.length ? '\n\n' + qualLines.map(q => `• ${q}`).join('\n') : '';
    const condLine = condMod.parts.length
      ? '\n\nFrom conditions:\n' + condMod.parts.map(p => `  • ${p.name} ×${p.stacks} → ${p.modifier > 0 ? '+' : ''}${p.modifier}`).join('\n')
      : '';
    const advLine = advBonus > 0 ? `\n\nAdvantage: +${advBonus} to hit (${advantage} × 10).` : '';
    // WFRP 4e: only a double is a critical or fumble; 01–05 / 96–00 are just
    // automatic. A critical needs the attack to land (an opposed test can still
    // be lost after a successful double).
    const critLine = r.outcome === 'crit-success' && landed
      ? '\n\nCRITICAL HIT (a double): the target also suffers a Critical Wound.'
      : r.outcome === 'fumble'
        ? '\n\nFUMBLE (a failed double): resolve the fumble.'
        : '';

    const difficultyLine = `\n\nDifficulty modifier: ${atk.difficulty >= 0 ? '+' : ''}${atk.difficulty}`;
    const settingsTicket = setAttackSettings({
      defence: isRangedWeapon(w) ? attackSettings.defence : atk.defence,
      difficulty: atk.difficulty,
    });
    void settingsTicket.completion.then(result => {
      if (!result.ok) Alert.alert('Attack settings not saved', result.error.message);
    });
    recordTest(r, critLine + advLine + opposedLine + locLine + dmgLine + qualLine + condLine + difficultyLine,
      `${w.name} — ${landed ? 'HIT' : 'NO HIT'}`, { landed, ...(defender ? { defender } : {}), ...(dmg ? { damage: dmg.total } : {}) });
    setAtk(null);
    const canGain = landed && !!dmg && dmg.total > 0;
    Alert.alert(
      `${w.name} — ${opposed ? (landed ? 'HIT' : 'NO HIT') : resultLabel(r)}`,
      formatTestResult(r) + critLine + advLine + opposedLine + locLine + dmgLine + qualLine + condLine + difficultyLine,
      canGain
        ? [{
            text: 'Gain +1 Advantage',
            onPress: () => {
              const ticket = setAdvantage(a => a + 1);
              void ticket.completion.then((durability) => {
                if (!durability.ok) Alert.alert('Could not save Advantage', durability.error.message);
              });
            },
          }, { text: 'Close' }]
        : undefined,
    );
  };

  // "Take a hit": resolve incoming damage against THIS character's Toughness
  // Bonus + Armour Points at the struck location, apply the net to Wounds, and
  // raise a Critical Wound if it drops them to (or strikes them at) 0.
  const [hit, setHit] = useState<{ damage: number; locKey: ApLocation; locRoll: number } | null>(null);
  const hitActionRef = useRef(false);
  const [hitApplying, setHitApplying] = useState(false);

  const rollHitLocation = () => {
    const roll = Math.floor(Math.random() * 100) + 1;
    const loc = hitLocationFromRoll(roll, hitLocations);
    const key = (HIT_LOCATION_OPTIONS.some(o => o.value === loc.key) ? loc.key : 'body') as ApLocation;
    return { key, locRoll: loc.locRoll };
  };

  const openHit = () => {
    const { key, locRoll } = rollHitLocation();
    setHit({ damage: 0, locKey: key, locRoll });
  };

  const resolveHit = async () => {
    if (!hit || hitActionRef.current) return;
    const appliedHit = hit;
    hitActionRef.current = true;
    setHitApplying(true);
    try {
      const apVal = apAt(ap, appliedHit.locKey);
      const res = applyDamage({ damage: appliedHit.damage, toughnessBonus, ap: apVal, currentWounds: wounds });
      // WFRP 4e p.164: taking one or more Wounds loses all your Advantage.
      const lostAdvantage = res.woundsLost > 0 && advantage > 0;

      let critLine = '';
      let freshCritical: Critical | null = null;
      if (res.critical) {
        const locLabel = hitLocLabel(appliedHit.locKey);
        // WFRP 4e: a critical rolls d100 on the struck location's own table.
        const table = caps.combatHitLocations ? content.criticalTableFor(appliedHit.locKey) : undefined;
        const critRoll = Math.floor(Math.random() * 100) + 1;
        const row = critFromTable(table, critRoll);
        if (row) {
          freshCritical = criticalFromDefinition(row, caps.combatHitLocations ? locLabel : '', critRoll);
          critLine = `\n\nCRITICAL WOUND — ${row.name}${caps.combatHitLocations ? ` (${locLabel})` : ''}.\n` +
            `d100 ${critRoll} on the ${locLabel} critical table:\n${row.effect}`;
        } else if (prefabCriticals.length > 0) {
          const tpl = prefabCriticals[Math.floor(Math.random() * prefabCriticals.length)];
          freshCritical = criticalFromDefinition(tpl, caps.combatHitLocations ? locLabel : '', appliedHit.locRoll);
          critLine = `\n\nCRITICAL WOUND — ${tpl.name}${caps.combatHitLocations ? ` (${locLabel})` : ''}.\nAdded to the Wounds screen.`;
        }
      }

      const transaction = runStoredTransaction(() => {
        setWounds(res.newWounds);
        if (lostAdvantage) setAdvantage(0);
        if (freshCritical) {
          const critical = freshCritical;
          if (critical.conditions) setConds(current => addCriticalConditions(current, critical.conditions));
          crits.add({ ...critical, conditionsApplied: true });
        }
      });
      const durability = await transaction.completion;
      if (!durability.ok) {
        Alert.alert('Could not apply hit', durability.error.message);
        return;
      }

      const locPart = caps.combatHitLocations ? ` to the ${hitLocLabel(appliedHit.locKey)}` : '';
      const advLine = lostAdvantage ? `\nAdvantage lost — reset to 0 (you took Wounds).` : '';
      setHit(null);
      Alert.alert(
        res.woundsLost > 0 ? `Hit${locPart} — ${res.woundsLost} Wound${res.woundsLost === 1 ? '' : 's'} lost` : `Hit${locPart} — fully soaked`,
        (res.minimumApplied
          ? `Damage ${res.damage} − TB ${res.toughnessBonus} − AP ${res.ap} is below 1, but a hit always costs at least 1 Wound.\n`
          : `Damage ${res.damage} − TB ${res.toughnessBonus} − AP ${res.ap} = ${res.woundsLost} Wound${res.woundsLost === 1 ? '' : 's'}.\n`) +
        `Wounds ${res.currentWounds} → ${res.newWounds}.${advLine}${critLine}` + (freshCritical ? `\n\n${criticalEffectNotice(freshCritical)}` : ''),
      );
    } finally {
      hitActionRef.current = false;
      setHitApplying(false);
    }
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
  const [wEdit, setWEdit] = useState<{
    identity: CollectionItemIdentity | null;
    draft: Weapon;
  } | null>(null);
  const [aEdit, setAEdit] = useState<{
    identity: CollectionItemIdentity | null;
    draft: Armour;
  } | null>(null);
  const weaponActionRef = useRef(false);
  const armourActionRef = useRef(false);
  const [weaponAction, setWeaponAction] = useState<'save' | 'remove' | null>(null);
  const [armourAction, setArmourAction] = useState<'save' | 'remove' | null>(null);

  const openNewWeapon = () => setWEdit({ identity: null, draft: blankWeapon() });
  const openEditWeapon = (i: number) => {
    const identity = weapons.identify(i);
    if (!identity) {
      Alert.alert('Weapon changed', 'That weapon is no longer available. Review the current list and retry.');
      return;
    }
    setWEdit({ identity, draft: { ...weapons.items[i] } });
  };
  const openNewArmour = () => setAEdit({ identity: null, draft: blankArmour() });
  const openEditArmour = (i: number) => {
    const identity = armour.identify(i);
    if (!identity) {
      Alert.alert('Armour changed', 'That armour is no longer available. Review the current list and retry.');
      return;
    }
    setAEdit({ identity, draft: { ...armour.items[i] } });
  };

  const saveWeapon = async () => {
    if (!wEdit || weaponActionRef.current) return;
    const edit = wEdit;
    if (!edit.draft.name.trim()) {
      Alert.alert('Name required', 'Give the weapon a name.');
      return;
    }
    const ranged = charForWeapon(edit.draft, combat) === combat.rangedChar;
    const weapon = normalizeWeaponDistance(edit.draft, ranged);
    weaponActionRef.current = true;
    setWeaponAction('save');
    let found = true;
    const durability = await (async () => {
      try {
        const ticket = edit.identity == null
          ? weapons.add(weapon)
          : (() => {
              const mutation = weapons.updateIdentified(edit.identity, weapon);
              found = mutation.found;
              return mutation.ticket;
            })();
        return await ticket.completion;
      } finally {
        weaponActionRef.current = false;
        setWeaponAction(null);
      }
    })();
    if (!durability.ok) {
      Alert.alert('Could not save weapon', durability.error.message);
      return;
    }
    if (!found) {
      Alert.alert('Weapon changed', 'That weapon changed or was removed in another tab. Review the current list and retry.');
      return;
    }
    setWEdit(null);
  };

  const dropWeapon = async () => {
    if (!wEdit || wEdit.identity == null || weaponActionRef.current) return;
    const edit = wEdit;
    const name = edit.draft.name;
    weaponActionRef.current = true;
    setWeaponAction('remove');
    let found = false;
    const durability = await (async () => {
      try {
        const mutation = weapons.removeIdentified(edit.identity!);
        found = mutation.found;
        return await mutation.ticket.completion;
      } finally {
        weaponActionRef.current = false;
        setWeaponAction(null);
      }
    })();
    if (!durability.ok) {
      Alert.alert('Could not drop weapon', durability.error.message);
      return;
    }
    if (!found) {
      Alert.alert('Weapon changed', 'That weapon changed or was removed in another tab. Review the current list and retry.');
      return;
    }
    setWEdit(null);
    Alert.alert('Dropped', `${name} removed from inventory.`);
  };

  const saveArmour = async () => {
    if (!aEdit || armourActionRef.current) return;
    const edit = aEdit;
    if (!edit.draft.name.trim()) {
      Alert.alert('Name required', 'Give the armour a name.');
      return;
    }
    if (edit.draft.locs.length === 0) {
      Alert.alert('Pick locations', 'Armour must cover at least one location.');
      return;
    }
    armourActionRef.current = true;
    setArmourAction('save');
    let found = true;
    const durability = await (async () => {
      try {
        const ticket = edit.identity == null
          ? armour.add(edit.draft)
          : (() => {
              const mutation = armour.updateIdentified(edit.identity, edit.draft);
              found = mutation.found;
              return mutation.ticket;
            })();
        return await ticket.completion;
      } finally {
        armourActionRef.current = false;
        setArmourAction(null);
      }
    })();
    if (!durability.ok) {
      Alert.alert('Could not save armour', durability.error.message);
      return;
    }
    if (!found) {
      Alert.alert('Armour changed', 'That armour changed or was removed in another tab. Review the current list and retry.');
      return;
    }
    setAEdit(null);
  };

  const dropArmour = async () => {
    if (!aEdit || aEdit.identity == null || armourActionRef.current) return;
    const edit = aEdit;
    const name = edit.draft.name;
    armourActionRef.current = true;
    setArmourAction('remove');
    let found = false;
    const durability = await (async () => {
      try {
        const mutation = armour.removeIdentified(edit.identity!);
        found = mutation.found;
        return await mutation.ticket.completion;
      } finally {
        armourActionRef.current = false;
        setArmourAction(null);
      }
    })();
    if (!durability.ok) {
      Alert.alert('Could not remove armour', durability.error.message);
      return;
    }
    if (!found) {
      Alert.alert('Armour changed', 'That armour changed or was removed in another tab. Review the current list and retry.');
      return;
    }
    setAEdit(null);
    Alert.alert('Removed', `${name} removed from inventory.`);
  };

  return (
    <ScreenContainer>
      <Hero
        eyebrow={c.name}
        title="Combat"
        subRow={<span className="cmb-sub">Weapons, wounds, and active conditions.</span>}
      />

      <div className="cmb-status">
        <div className={`cmb-wounds${wounds === 0 ? ' cmb-wounds--critical' : ''}`}>
          <div><span className="cmb-label">Wounds</span><strong>{wounds}<small> / {maxWounds}</small></strong></div>
          <Button iconLeft={<Icon name="heart" size={14} color={colors.ink2} />} onPress={openHit}>Take a hit</Button>
        </div>
        <div className="cmb-advantage">
          <div><span className="cmb-label">Advantage</span><span className="cmb-advantage-bonus">+{advantageBonus(advantage)} to combat tests</span></div>
          <Stepper value={advantage} min={0} max={30} decreaseLabel="Decrease Advantage" increaseLabel="Increase Advantage" onChange={setAdvantage} />
          <Button variant="ghost" onPress={() => {
            const ticket = setAdvantage(0);
            void ticket.completion.then(durability => {
              if (!durability.ok) Alert.alert('Could not reset Advantage', durability.error.message);
            });
          }}>Reset</Button>
        </div>
      </div>
      {Object.entries(conds).some(([, stacks]) => stacks > 0) && <div className="cmb-active-conditions" aria-label="Active conditions">
        {Object.entries(conds).filter(([, stacks]) => stacks > 0).map(([name, stacks]) =>
          <Pill key={name} variant="empire">{name} ×{stacks}</Pill>)}
        <span>Conditions: {condMod.total > 0 ? '+' : ''}{condMod.total} to tests</span>
      </div>}

      <div className="cmb-row">
        <div className="cmb-weapons">
          <Card flush>
            <CardHead title="Weapons" meta={`${weapons.items.length} in your inventory`}
              right={<Button variant="ghost" iconLeft={<Icon name="plus" size={12} color={colors.ink2} />}
                onPress={openNewWeapon}>New</Button>} />
            {weapons.items.map((w, i) => {
              const base = targetForWeapon(w);
              const target = resolveTest({ target: base, modifier: condMod.total + advantageBonus(advantage), forceRoll: 1 }, system.test).effectiveTarget;
              return <article className="cmb-weapon-card" key={`${w.name}-${i}`}>
                <div className="cmb-weapon-top">
                  <div>
                    <button type="button" className="btn-reset cmb-weapon-name" onClick={() => openEditWeapon(i)}>{w.name}</button>
                    <span className="cmb-weapon-group">{w.group}</span>
                  </div>
                  <div className="cmb-target"><span>Test target</span><strong>{target}</strong></div>
                </div>
                <div className="cmb-weapon-stats">
                  <div><span>Damage</span><strong>{w.dmg}</strong></div>
                  <div><span>{charForWeapon(w, combat) === combat.rangedChar ? 'Range' : 'Reach'}</span><strong>{weaponDistance(w, charForWeapon(w, combat) === combat.rangedChar) || '—'}</strong></div>
                  <div><span>Enc.</span><strong>{w.enc}</strong></div>
                </div>
                <div className="cmb-weapon-bottom">
                  <div className="cmb-qual-row">{w.qual.length ? w.qual.map(q => <Pill key={q} size={11}>{q}</Pill>) : <span className="cmb-sub">No special qualities</span>}</div>
                  <Button variant="primary" ariaLabel={`Roll attack with ${w.name}`}
                    iconLeft={<Icon name="dice" size={14} color={colors.ivory} />} onPress={() => openAttack(w)}>Attack</Button>
                </div>
              </article>;
            })}
            {!weapons.items.length && <p className="cmb-empty">No weapons yet. Add one to make your first attack.</p>}
          </Card>
        </div>
        <aside className="cmb-defence">
          <Card flush>
            <details className="cmb-armour-map">
              <summary><span>{caps.combatHitLocations ? 'Armour & hit locations' : 'Armour coverage'}</span><span>{totalAP} total AP</span></summary>
              {caps.combatHitLocations && <div className="cmb-figure-box"><HitLocationFigure ap={ap} labels={figureLabels} /></div>}
            </details>
          </Card>
          <Card flush>
            <CardHead title="Armour" right={<Button variant="ghost"
              iconLeft={<Icon name="plus" size={12} color={colors.ink2} />} onPress={openNewArmour}>New</Button>} />
            {armour.items.map((a, i) => <button type="button" className="btn-reset cmb-armour-item"
              key={`${a.name}-${i}`} onClick={() => openEditArmour(i)}>
              <span><strong>{a.name}</strong><span>{a.locs.join(', ')} · Enc. {a.enc}</span>
                {a.qual.length > 0 && <span>{a.qual.join(' · ')}</span>}</span>
              <span className="cmb-armour-ap">{a.ap}<small>AP</small></span>
            </button>)}
            {!armour.items.length && <p className="cmb-empty">No armour equipped. Add a piece to track protection.</p>}
          </Card>
        </aside>
      </div>

      {/* Weapon edit sheet */}
      <EditSheet
        visible={!!wEdit}
        title={wEdit?.identity == null ? 'New weapon' : 'Edit weapon'}
        subtitle={wEdit?.identity == null ? 'Add a weapon to this character\'s inventory.' : 'Tap Save to commit, or Drop to remove from inventory.'}
        onClose={() => { if (!weaponActionRef.current) setWEdit(null); }}
        onSave={saveWeapon}
        saveLabel={weaponAction === 'remove' ? 'Removing…' : weaponAction === 'save' ? 'Saving…' : 'Save'}
        saveDisabled={weaponAction !== null}
        destructive={wEdit?.identity != null && weaponAction === null ? { label: 'Drop', onPress: dropWeapon } : undefined}
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
              onChange={(v) => setWEdit(s => {
                if (!s) return s;
                const draft = { ...s.draft, group: v };
                const ranged = charForWeapon(draft, combat) === combat.rangedChar;
                return { ...s, draft: normalizeWeaponDistance(draft, ranged) };
              })}
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
              value={weaponDistance(wEdit.draft, charForWeapon(wEdit.draft, combat) === combat.rangedChar) ?? ''}
              onChangeText={t => setWEdit(s => {
                if (!s) return s;
                const ranged = charForWeapon(s.draft, combat) === combat.rangedChar;
                const draft = normalizeWeaponDistance(s.draft, ranged);
                return { ...s, draft: { ...draft, [ranged ? 'range' : 'reach']: t } };
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
        title={aEdit?.identity == null ? 'New armour' : 'Edit armour'}
        subtitle={aEdit?.identity == null ? 'Add a piece of armour. AP stacks per location.' : 'Tap Save to commit, or Remove to drop from inventory.'}
        onClose={() => { if (!armourActionRef.current) setAEdit(null); }}
        onSave={saveArmour}
        saveLabel={armourAction === 'remove' ? 'Removing…' : armourAction === 'save' ? 'Saving…' : 'Save'}
        saveDisabled={armourAction !== null}
        destructive={aEdit?.identity != null && armourAction === null ? { label: 'Remove', onPress: dropArmour } : undefined}
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

      {/* Attack resolver: to-hit roll (+ Advantage), optional Opposed melee */}
      <EditSheet
        visible={!!atk}
        title="Attack"
        subtitle="Roll to hit. Set a defence value to resolve an Opposed melee test."
        onClose={() => setAtk(null)}
        onSave={resolveAttack}
        saveLabel="Roll attack"
      >
        {atk ? (() => {
          const w = atk.weapon;
          const target = targetForWeapon(w);
          const advBonus = advantageBonus(advantage);
          const ranged = charForWeapon(w, combat) === combat.rangedChar;
          return (
            <>
              <div className="cmb-hit-preview">
                <span className="cmb-meta-mono">{w.name} · {w.dmg}</span>{' '}
                target <strong>{resolveTest({ target, modifier: condMod.total + advBonus + atk.difficulty, forceRoll: 1 }, system.test).effectiveTarget}</strong>
                {advBonus ? <span className="cmb-meta-mono">  ·  Advantage +{advBonus}</span> : null}
              </div>
              <p className="cmb-sub">Base {target} · Advantage +{advBonus} · conditions {condMod.total} · difficulty {atk.difficulty > 0 ? '+' : ''}{atk.difficulty}</p>
              <p className="cmb-sub"><strong>{atk.defence > 0 ? `Opposed attack · defence ${atk.defence}` : 'Unopposed attack'}</strong> · Settings are remembered for this character after rolling.</p>
              <Button variant="ghost" onPress={() => setAtk(s => s && ({ ...s, defence: 0, difficulty: 0 }))}>Reset attack settings</Button>
              <NumberField label="Difficulty modifier" value={atk.difficulty} min={-100} max={100}
                onChangeNumber={n => setAtk(s => s && ({ ...s, difficulty: n }))}
                hint="Positive helps; negative makes the attack harder." />
              <NumberField
                label={ranged ? 'Opposed defence (melee only — 0 for ranged)' : "Defender's defence (0 = unopposed)"}
                value={atk.defence}
                onChangeNumber={n => setAtk(s => s && ({ ...s, defence: n }))}
                min={0}
                max={100}
                hint="The defender's Melee or Dodge target. Leave at 0 for a straight test."
              />
              {w.qual.length ? (
                <div className="cmb-qual-row">
                  {w.qual.map(q => <Pill key={q} size={10}>{q}</Pill>)}
                </div>
              ) : null}
            </>
          );
        })() : null}
      </EditSheet>

      {/* Take-a-hit resolver: incoming damage vs this character's TB + AP */}
      <EditSheet
        visible={!!hit}
        title="Take a hit"
        subtitle="Resolve incoming damage against this character's Toughness and armour."
        onClose={() => { if (!hitActionRef.current) setHit(null); }}
        onSave={resolveHit}
        saveLabel={hitApplying ? 'Applying…' : 'Apply'}
        saveDisabled={!hit || hit.damage <= 0 || hitApplying}
      >
        {hit ? (() => {
          const apVal = apAt(ap, hit.locKey);
          const preview = applyDamage({ damage: hit.damage, toughnessBonus, ap: apVal, currentWounds: wounds });
          const net = preview.woundsLost;
          const after = preview.newWounds;
          const crit = preview.critical;
          return (
            <>
              <NumberField
                label="Incoming damage"
                value={hit.damage}
                onChangeNumber={n => setHit(s => s && ({ ...s, damage: n }))}
                min={0}
                max={200}
                hint="Weapon Damage + SL of the hit, before your Toughness Bonus and AP."
              />
              {caps.combatHitLocations ? (
                <>
                  <PickerField<ApLocation>
                    label="Hit location"
                    value={hit.locKey}
                    onChange={v => setHit(s => s && ({ ...s, locKey: v }))}
                    options={HIT_LOCATION_OPTIONS.map(o => ({ value: o.value, label: `${o.label} — AP ${apAt(ap, o.value)}` }))}
                    hint={`Reversed-digit location roll → ${hit.locRoll}.`}
                  />
                  <Button
                    variant="ghost"
                    iconLeft={<Icon name="dice" size={12} color={colors.ink2} />}
                    onPress={() => setHit(s => s && ({ ...s, ...rollHitLocation() }))}
                  >
                    Roll location
                  </Button>
                </>
              ) : null}
              <div className="cmb-hit-preview">
                <span className="cmb-meta-mono">
                  {hit.damage} − TB {toughnessBonus} − AP {apVal} =
                </span>{' '}
                <strong>{net}</strong> Wound{net === 1 ? '' : 's'}
                {preview.minimumApplied ? <span className="cmb-meta-mono"> (minimum 1)</span> : null}
                <span className="cmb-meta-mono">  ·  Wounds {wounds} → {after}</span>
                {crit ? <span className="cmb-hit-crit">  ·  CRITICAL WOUND</span> : null}
              </div>
            </>
          );
        })() : null}
      </EditSheet>
    </ScreenContainer>
  );
};
