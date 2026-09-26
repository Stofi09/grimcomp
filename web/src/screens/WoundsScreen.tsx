import { useMemo, useRef, useState } from 'react';
import { ScreenContainer } from './ScreenContainer';
import { type Critical, type Trapping } from '@/data/character';
import { runStoredTransaction, useStoredState } from '@/hooks/useStoredState';
import { useConditions } from '@/hooks/useConditions';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useDerived } from '@/hooks/useDerived';
import { useVitals } from '@/hooks/useVitals';
import { useCharacterCollection } from '@/hooks/useCharacterCollection';
import { useContent, useHitLocations, useCriticals, useConditionList, useSystemRules, useCapabilities } from '@/content/useContent';
import { critFromTable } from '@/content/tables';
import type { HitLocationRow, HitLocationKey, CriticalDef, CriticalTableDef } from '@/content/types';
import { advanceCriticalHealingDay, clearSceneEndConditions } from '@/utils/recovery';
import { addCriticalConditions, criticalFromDefinition, criticalEffectNotice } from '@/utils/criticalEffects';
import { Alert } from '@/ui/alertStore';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card, CardHead } from '@/components/Card';
import { Bar } from '@/components/Bar';
import { Chip } from '@/components/Chip';
import { Stepper } from '@/components/Stepper';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors } from '@/theme';
import './WoundsScreen.css';

// Roll a fresh critical: pick a hit location, then roll d100 on that location's
// own critical table when the packs ship one (WFRP 4e p.180+), otherwise draw a
// random prefab from the flat `criticals` list.
const newCritical = (
  rows: HitLocationRow[],
  prefabs: CriticalDef[],
  tableFor: (k: HitLocationKey) => CriticalTableDef | undefined,
): Critical => {
  const maxRoll = rows.reduce((m, row) => Math.max(m, row.max), 0) || 100;
  const locRoll = Math.floor(Math.random() * maxRoll) + 1;
  const band = rows.find(r => locRoll >= r.min && locRoll <= r.max);
  const label = band?.label ?? 'Body';
  const table = band ? tableFor(band.key) : undefined;
  const critRoll = Math.floor(Math.random() * 100) + 1;
  const row = critFromTable(table, critRoll);
  if (row) return criticalFromDefinition(row, label, critRoll);
  const tpl = prefabs[Math.floor(Math.random() * prefabs.length)]
    ?? { name: 'Critical Wound', effect: 'A serious injury — the GM describes its effect.', days: 10 };
  return criticalFromDefinition(tpl, label, locRoll);
};

const sameCritical = (left: Critical, right: Critical): boolean => (
  left.loc === right.loc
  && left.roll === right.roll
  && left.name === right.name
  && left.effect === right.effect
  && left.days === right.days
);

export const WoundsScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const [wounds, setWounds] = useStoredState(characterKey(id, 'wounds'), c.wounds.current);
  const { conds, setConds, cycle, names } = useConditions();
  const vitals = useVitals();

  const content = useContent();
  const hitLocations = useHitLocations();
  const prefabCriticals = useCriticals();
  const conditionDefs = useConditionList();
  const { formulas } = useSystemRules();
  const caps = useCapabilities();

  // Max Wounds and the rest-recovery amount are recomputed live by the system
  // formulas (small species and the bonus talent feed in as formula vars).
  const derived = useDerived();
  const woundsMax = derived.maxWounds;
  const restAmount = derived.restRecovery;

  // Live critical wounds + the shared condition map. Their clocks stay
  // separate: criticals heal by day; only explicitly flagged conditions clear
  // at the end of a scene.
  const crits = useCharacterCollection<Critical>('criticals', c.criticals);
  const trappings = useCharacterCollection<Trapping>('trappings', c.trappings);
  const isDraught = (item: Trapping) => item.name.trim().toLowerCase() === 'healing draught';
  const draughtCount = trappings.items.filter(isDraught).length;
  const recoveryRef = useRef(false);
  const [recovering, setRecovering] = useState(false);
  const [, setCondMap] = useStoredState<Record<string, number>>(
    characterKey(id, 'conditions'),
    Object.fromEntries(names.map(t => [t, 0])),
  );
  const endOfSceneRef = useRef(false);
  const cheatDeathRef = useRef(false);
  const criticalActionRef = useRef(false);
  const [endingScene, setEndingScene] = useState(false);
  const [burningFate, setBurningFate] = useState(false);
  const [criticalActionPending, setCriticalActionPending] = useState(false);

  const endOfScene = async () => {
    if (endOfSceneRef.current) return;
    let clearedConditions = 0;
    let clearedStacks = 0;
    endOfSceneRef.current = true;
    setEndingScene(true);
    const durability = await (async () => {
      try {
        const ticket = setCondMap(prev => {
          const result = clearSceneEndConditions(prev, conditionDefs);
          clearedConditions = result.clearedConditions;
          clearedStacks = result.clearedStacks;
          return result.conditions;
        });
        return await ticket.completion;
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
      clearedConditions > 0
        ? `Cleared ${clearedStacks} stack${clearedStacks === 1 ? '' : 's'} across ${clearedConditions} scene-end condition${clearedConditions === 1 ? '' : 's'}. Other conditions, Fortune, and healing days were not changed.`
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
    let result = advanceCriticalHealingDay(crits.items);
    try {
      const durability = await crits.replace((current) => {
        result = advanceCriticalHealingDay(current);
        return result.criticals;
      }).completion;
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

  const showConditionRule = (name: string) => {
    const def = conditionDefs.find(candidate => candidate.name === name);
    const details = [
      def?.description || 'No rule text is included in the loaded content.',
      def?.penalty ? `Test modifier: ${def.penalty} per stack.` : '',
      `Maximum tracked stacks: ${def?.maxStacks ?? 2}.`,
      def?.clearsAtSceneEnd ? 'All stacks clear at the end of the scene.' : '',
    ].filter(Boolean);
    Alert.alert(name, details.join('\n\n'));
  };

  // End of round: Bleeding drains 1 Wound per stack (WFRP 4e p.169). At 0
  // Wounds while still Bleeding, the character must pass an Endurance Test at
  // the start of their next turn or die.
  const endOfRound = async () => {
    const bleed = conds['Bleeding'] ?? 0;
    if (bleed <= 0) {
      Alert.alert('End of round', 'No Bleeding to resolve.');
      return;
    }
    const newW = Math.max(0, wounds - bleed);
    const durability = await setWounds(newW).completion;
    if (!durability.ok) {
      Alert.alert('Could not resolve Bleeding', durability.error.message);
      return;
    }
    Alert.alert(
      'End of round — Bleeding',
      `Lost ${bleed} Wound${bleed === 1 ? '' : 's'} to Bleeding (×${bleed}). Wounds ${wounds} → ${newW}.` +
        (newW === 0 ? '\n\nAt 0 Wounds while Bleeding: pass an Endurance Test at the start of your next turn, or die.' : ''),
    );
  };

  // Burn a Fate point to cheat certain death (WFRP 4e p.187): the point is
  // spent permanently and you survive, removed from the fight at 0 Wounds.
  const cheatDeath = async () => {
    if (cheatDeathRef.current) return;
    if (vitals.fate <= 0) {
      Alert.alert('No Fate to burn', 'No Fate points remain — there is no cheating this death.');
      return;
    }
    cheatDeathRef.current = true;
    setBurningFate(true);
    const durability = await (async () => {
      try {
        const transaction = runStoredTransaction(() => {
          vitals.setFate(vitals.fate - 1);
          setWounds(0);
        });
        return await transaction.completion;
      } finally {
        cheatDeathRef.current = false;
        setBurningFate(false);
      }
    })();
    if (!durability.ok) {
      Alert.alert('Could not burn Fate', durability.error.message);
      return;
    }
    Alert.alert(
      'Fate burned — you cheat death',
      `−1 Fate (now ${vitals.fate - 1}).\n\nYou survive what should have killed you: left at 0 Wounds and out of the fight. The GM may impose a lasting injury.`,
    );
  };

  const addCritical = async () => {
    if (criticalActionRef.current) return;
    criticalActionRef.current = true;
    setCriticalActionPending(true);
    try {
      const fresh = newCritical(hitLocations, prefabCriticals, k => content.criticalTableFor(k));
      if (!caps.combatHitLocations) fresh.loc = '';
      const durability = await runStoredTransaction(() => {
        crits.add({ ...fresh, conditionsApplied: true });
        if (fresh.conditions) setConds(current => addCriticalConditions(current, fresh.conditions));
      }).completion;
      if (!durability.ok) {
        Alert.alert('Could not add critical', durability.error.message);
        return;
      }
      const locLine = caps.combatHitLocations ? `Location: ${fresh.loc}\n` : '';
      Alert.alert(
        `Critical: ${fresh.name}`,
        `${locLine}Roll: ${fresh.roll}\n\n${fresh.effect}\n\n${criticalEffectNotice(fresh)}\n\nHeals in ${fresh.days} day${fresh.days === 1 ? '' : 's'}.`,
      );
    } finally {
      criticalActionRef.current = false;
      setCriticalActionPending(false);
    }
  };

  const conditionsFor = (critical: Critical) => critical.conditions ?? [
    ...content.criticalTables.flatMap(table => table.rows), ...prefabCriticals,
  ].find(def => def.name === critical.name && def.effect === critical.effect)?.conditions;

  const applySavedCriticalConditions = async (index: number) => {
    const critical = crits.items[index];
    const identity = crits.identify(index);
    if (!critical || !identity || critical.conditionsApplied || criticalActionRef.current) return;
    const effects = conditionsFor(critical);
    if (!effects) return;
    criticalActionRef.current = true;
    setCriticalActionPending(true);
    let found = false;
    try {
      const durability = await runStoredTransaction(() => {
        const mutation = crits.updateIdentified(identity, { ...critical, conditions: effects, conditionsApplied: true });
        found = mutation.found;
        if (found) setConds(current => addCriticalConditions(current, effects));
      }).completion;
      if (!durability.ok) Alert.alert('Could not apply conditions', durability.error.message);
      else if (!found) Alert.alert('Critical changed', 'Review the current wound and retry.');
    } finally {
      criticalActionRef.current = false;
      setCriticalActionPending(false);
    }
  };

  const resolveCritical = async (index: number) => {
    if (criticalActionRef.current) return;
    const cr = crits.items[index];
    if (!cr) return;
    const occurrence = crits.items
      .slice(0, index)
      .filter(candidate => sameCritical(candidate, cr)).length;
    criticalActionRef.current = true;
    setCriticalActionPending(true);
    let removed = false;
    try {
      const durability = await crits.replace((current) => {
        let seen = 0;
        return current.filter((candidate) => {
          if (!sameCritical(candidate, cr)) return true;
          if (seen++ !== occurrence) return true;
          removed = true;
          return false;
        });
      }).completion;
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
    if (recoveryRef.current || wounds >= woundsMax) return;
    recoveryRef.current = true;
    setRecovering(true);
    let recovered = 0;
    try {
      const durability = await setWounds(w => {
        recovered = Math.max(0, Math.min(restAmount, woundsMax - w));
        return w + recovered;
      }).completion;
      if (!durability.ok) Alert.alert('Could not save rest', durability.error.message);
      else Alert.alert('Rest', `Recovered ${recovered} wounds (${formulas.restRecovery}).`);
    } finally {
      recoveryRef.current = false;
      setRecovering(false);
    }
  };

  const useHealingDraught = async () => {
    if (recoveryRef.current || wounds >= woundsMax || draughtCount === 0) return;
    recoveryRef.current = true;
    setRecovering(true);
    let consumed = false;
    let recovered = 0;
    try {
      const durability = await runStoredTransaction(() => {
        // Read both current values inside the transaction so a stale screen
        // cannot consume the last bottle twice or waste it at full health.
        setWounds(w => {
          if (w >= woundsMax) return w;
          trappings.replace(items => {
            const index = items.findIndex(isDraught);
            if (index < 0) return items;
            consumed = true;
            return items.filter((_, i) => i !== index);
          });
          if (!consumed) return w;
          recovered = Math.min(4, woundsMax - w);
          return w + recovered;
        });
      }).completion;
      if (!durability.ok) Alert.alert('Could not use draught', durability.error.message);
      else if (!consumed) Alert.alert('Recovery changed', 'No draught was used. Check your wounds and inventory.');
      else Alert.alert('Healing Draught', `Recovered ${recovered} wounds. Consumed 1 Healing Draught.`);
    } finally {
      recoveryRef.current = false;
      setRecovering(false);
    }
  };

  const woundsLabel = useMemo(
    () => `max ${woundsMax}`,
    [woundsMax],
  );

  return (
    <ScreenContainer>
      <Hero
        title="Wounds & Conditions"
        subRow={<span className="wnd-sub">Track combat health, critical wounds, and recovery.</span>}
      />

      <div className="wnd-row">
        <Card style={{ flex: 2, minWidth: 'min(360px, 100%)' }}>
          <div className="wnd-row-between">
            <span className="wnd-label">Current wounds</span>
            <span className="wnd-meta-mono">{woundsLabel}</span>
          </div>
          <div className="wnd-current-row">
            <span className="wnd-big-empire tabular">{wounds}</span>
            <span className="wnd-big-frac">/ {woundsMax}</span>
            <div className="wnd-spacer" />
            <Stepper value={wounds} min={0} max={woundsMax} onChange={setWounds} />
          </div>
          <Bar value={woundsMax > 0 ? wounds / woundsMax : 0} variant="empire" large style={{ marginTop: 14 }} />
          <div className="wnd-row-between wnd-meta-row">
            <span className="wnd-meta-mono">0 · roll critical</span>
            <span className="wnd-meta-mono">max · full health</span>
          </div>
        </Card>

        <Card style={{ flex: 1, minWidth: 'min(240px, 100%)' }}>
          <span className="wnd-label">Quick actions</span>
          <div className="wnd-actions">
            <Button
              iconLeft={<Icon name="heart" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={rest}
              disabled={recovering || wounds >= woundsMax}
            >
              Rest (recover {restAmount})
            </Button>
            <Button
              iconLeft={<Icon name="dice" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={useHealingDraught}
              disabled={recovering || wounds >= woundsMax || draughtCount === 0}
            >
              Use healing draught ({draughtCount} owned)
            </Button>
            {draughtCount === 0 && <span className="wnd-effect-note">Add a Healing Draught in Trappings when you acquire one. Each inventory entry is one dose.</span>}
            <Button
              iconLeft={<Icon name="sword" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={endOfRound}
            >
              End of round{(conds['Bleeding'] ?? 0) > 0 ? ` (Bleeding ×${conds['Bleeding']})` : ''}
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
            <Button
              iconLeft={<Icon name="star" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={cheatDeath}
              disabled={burningFate}
            >
              {burningFate ? 'Burning Fate…' : 'Burn Fate — cheat death'}
            </Button>
          </div>
        </Card>
      </div>

      <Section title="Conditions" aside="tap to change stacks · info opens the rule" />
      <div className="wnd-chips">
        {names.map(t => {
          const n = conds[t] ?? 0;
          return (
            <Chip
              key={t}
              label={t}
              count={n}
              on={n > 0}
              onPress={() => cycle(t)}
              onInfoPress={() => showConditionRule(t)}
            />
          );
        })}
      </div>

      <Section title="Critical Wounds" aside={caps.combatHitLocations ? 'd100 + hit location' : 'd100'} />
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
            {caps.combatHitLocations ? <Cell header flex={1}>Location</Cell> : null}
            <Cell header num flex={0.7}>Roll</Cell>
            <Cell header flex={2}>Wound</Cell>
            <Cell header flex={3}>Effect</Cell>
            <Cell header num flex={1}>Heal days</Cell>
            <Cell header flex={0.5}> </Cell>
          </TableRow>
          {crits.items.map((cr, i) => (
            <TableRow key={i} last={i === crits.items.length - 1}>
              {caps.combatHitLocations ? <Cell flex={1}>{cr.loc}</Cell> : null}
              <Cell num flex={0.7} textStyle={{ fontFamily: 'var(--font-mono)' }}>{cr.roll}</Cell>
              <Cell flex={2} textStyle={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{cr.name}</Cell>
              <Cell flex={3} textStyle={{ color: colors.ink3 }}>
                <div>{cr.effect}
                  {cr.conditionsApplied ? <p className="wnd-effect-note">{criticalEffectNotice(cr)}</p>
                    : conditionsFor(cr) ? <>
                      <p className="wnd-effect-note">Existing wound: apply once if these conditions have not already been added manually.</p>
                      <Button disabled={criticalActionPending} onPress={() => applySavedCriticalConditions(i)}>Apply conditions</Button>
                    </> : <p className="wnd-effect-note">Resolve these effects manually.</p>}
                </div>
              </Cell>
              <Cell num flex={1} textStyle={{ fontFamily: 'var(--font-mono)' }}>{cr.days}</Cell>
              <Cell flex={0.5} align="right">
                <Button
                  variant="ghost"
                  ariaLabel={`Mark "${cr.name}" healed`}
                  iconLeft={<Icon name="check" size={13} color={colors.success} />}
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
