import { useMemo } from 'react';
import { ScreenContainer } from './ScreenContainer';
import { type Critical } from '@/data/character';
import { useStoredState } from '@/hooks/useStoredState';
import { useConditions } from '@/hooks/useConditions';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useDerived } from '@/hooks/useDerived';
import { useVitals } from '@/hooks/useVitals';
import { useCharacterCollection } from '@/hooks/useCharacterCollection';
import { useContent, useHitLocations, useCriticals, useConditionList, useSystemRules, useCapabilities } from '@/content/useContent';
import { critFromTable } from '@/content/tables';
import type { HitLocationRow, HitLocationKey, CriticalDef, CriticalTableDef } from '@/content/types';
import { Alert } from '@/ui/alert';
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

// Find the hit-location band a roll falls into. Sourced from the registry's
// hitLocations table; the roll range follows from the bands themselves.
const locFromRoll = (rows: HitLocationRow[], roll: number): string => {
  const band = rows.find(r => roll >= r.min && roll <= r.max);
  return band?.label ?? 'Body';
};

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
  if (row) return { loc: label, roll: critRoll, name: row.name, effect: row.effect, days: row.days };
  const tpl = prefabs[Math.floor(Math.random() * prefabs.length)]
    ?? { name: 'Critical Wound', effect: 'A serious injury — the GM describes its effect.', days: 10 };
  return { loc: label, roll: locRoll, name: tpl.name, effect: tpl.effect, days: tpl.days };
};

export const WoundsScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const [wounds, setWounds] = useStoredState(characterKey(id, 'wounds'), c.wounds.current);
  const { conds, cycle, names } = useConditions();
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

  // Live critical wounds + the shared conditions map (so "End of scene" can
  // tick conditions down too).
  const crits = useCharacterCollection<Critical>('criticals', c.criticals);
  const [condMap, setCondMap] = useStoredState<Record<string, number>>(
    characterKey(id, 'conditions'),
    Object.fromEntries(names.map(t => [t, 0])),
  );

  const endOfScene = () => {
    // Fortune refreshes back up to Fate at a new session/scene.
    vitals.refreshFortune();
    // Tick every active critical's heal-days down by 1; remove any that reach 0.
    const before = crits.items.length;
    const next = crits.items
      .map(cr => ({ ...cr, days: Math.max(0, cr.days - 1) }))
      .filter(cr => cr.days > 0);
    const healed = before - next.length;
    crits.replace(next);

    // Tick down most conditions by 1 (per WFRP 4e p.169 — they fade unless
    // sustained). Conditions flagged clearsAtSceneEnd (Surprised) drop all
    // stacks at once.
    let removed = 0;
    setCondMap(prev => {
      const out: Record<string, number> = { ...prev };
      for (const k of Object.keys(out)) {
        const v = out[k] ?? 0;
        if (v <= 0) continue;
        const dec = conditionDefs.find(d => d.name === k)?.clearsAtSceneEnd ? v : 1;
        const after = Math.max(0, v - dec);
        if (after === 0 && v > 0) removed += 1;
        out[k] = after;
      }
      return out;
    });

    Alert.alert(
      'End of scene',
      `Fortune refreshed to ${vitals.fate}.\n` +
      `${healed} critical${healed === 1 ? '' : 's'} healed.\n` +
      `${removed} condition${removed === 1 ? '' : 's'} cleared, the rest tick down by 1.`,
    );
    // Silence unused-var lint
    void condMap;
  };

  // End of round: Bleeding drains 1 Wound per stack (WFRP 4e p.169). At 0
  // Wounds while still Bleeding, the character must pass an Endurance Test at
  // the start of their next turn or die.
  const endOfRound = () => {
    const bleed = conds['Bleeding'] ?? 0;
    if (bleed <= 0) {
      Alert.alert('End of round', 'No Bleeding to resolve.');
      return;
    }
    const newW = Math.max(0, wounds - bleed);
    setWounds(newW);
    Alert.alert(
      'End of round — Bleeding',
      `Lost ${bleed} Wound${bleed === 1 ? '' : 's'} to Bleeding (×${bleed}). Wounds ${wounds} → ${newW}.` +
        (newW === 0 ? '\n\nAt 0 Wounds while Bleeding: pass an Endurance Test at the start of your next turn, or die.' : ''),
    );
  };

  // Burn a Fate point to cheat certain death (WFRP 4e p.187): the point is
  // spent permanently and you survive, removed from the fight at 0 Wounds.
  const cheatDeath = () => {
    if (vitals.fate <= 0) {
      Alert.alert('No Fate to burn', 'No Fate points remain — there is no cheating this death.');
      return;
    }
    vitals.setFate(vitals.fate - 1);
    Alert.alert(
      'Fate burned — you cheat death',
      `−1 Fate (now ${vitals.fate - 1}).\n\nYou survive what should have killed you: left at 0 Wounds and out of the fight. The GM may impose a lasting injury.`,
    );
  };

  const addCritical = () => {
    const fresh = newCritical(hitLocations, prefabCriticals, k => content.criticalTableFor(k));
    if (!caps.combatHitLocations) fresh.loc = '';
    crits.add(fresh);
    const locLine = caps.combatHitLocations ? `Location: ${fresh.loc}\n` : '';
    Alert.alert(
      `Critical: ${fresh.name}`,
      `${locLine}Roll: ${fresh.roll}\n\n${fresh.effect}\n\nHeals in ${fresh.days} day${fresh.days === 1 ? '' : 's'}.`,
    );
  };

  const resolveCritical = (index: number) => {
    const cr = crits.items[index];
    crits.remove(index);
    Alert.alert('Resolved', `${cr.name} marked as healed.`);
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
        <Card style={{ flex: 2, minWidth: 360 }}>
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

        <Card style={{ flex: 1, minWidth: 240 }}>
          <span className="wnd-label">Quick actions</span>
          <div className="wnd-actions">
            <Button
              iconLeft={<Icon name="heart" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={() => {
                setWounds(w => Math.min(woundsMax, w + restAmount));
                Alert.alert('Rest', `Recovered ${restAmount} wounds (${formulas.restRecovery}).`);
              }}
            >
              Rest (recover {restAmount})
            </Button>
            <Button
              iconLeft={<Icon name="dice" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={() => {
                setWounds(w => Math.min(woundsMax, w + 4));
                Alert.alert('Healing Draught', 'Recovered 4 wounds.');
              }}
            >
              Use healing draught
            </Button>
            <Button
              iconLeft={<Icon name="sword" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={endOfRound}
            >
              End of round{(conds['Bleeding'] ?? 0) > 0 ? ` (Bleeding ×${conds['Bleeding']})` : ''}
            </Button>
            <Button
              iconLeft={<Icon name="star" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={cheatDeath}
            >
              Burn Fate — cheat death
            </Button>
            <Button
              iconLeft={<Icon name="flame" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={endOfScene}
            >
              End of scene
            </Button>
          </div>
        </Card>
      </div>

      <Section title="Conditions" aside="tap to add a stack · long-press for the rule" />
      <div className="wnd-chips">
        {names.map(t => {
          const n = conds[t] ?? 0;
          return <Chip key={t} label={t} count={n} on={n > 0} onPress={() => cycle(t)} />;
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
              <Cell flex={3} textStyle={{ color: colors.ink3 }}>{cr.effect}</Cell>
              <Cell num flex={1} textStyle={{ fontFamily: 'var(--font-mono)' }}>{cr.days}</Cell>
              <Cell flex={0.5} align="right">
                <Button
                  variant="ghost"
                  ariaLabel={`Mark "${cr.name}" healed`}
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
