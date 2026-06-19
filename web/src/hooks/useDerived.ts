// Derived stats computed from the system formulas (content packs' `system`
// section) and the active character's live characteristics. Centralizes what
// Overview / Wounds / Trappings / Psychology previously each computed with
// hardcoded WFRP math.

import { useCharacter } from './useCharacter';
import { useCharacteristics } from './useCharacteristics';
import { useTalents } from './useTalents';
import { useRaces, useSystemRules, useWoundsRules } from '@/content/useContent';
import { charVars, evalFormulaSafe } from '@/utils/formula';

export interface DerivedStats {
  /** Formula vars for the live characteristics: value by key/short, bonus by key+'b'/short+'B'. */
  vars: Record<string, number>;
  maxWounds: number;
  /** True when the species' size band omits SB per woundsRules.smallSizes. */
  small: boolean;
  /** Ranks held of the bonus-wounds talent (woundsRules.bonusTalent). */
  bonusRanks: number;
  walk: number;
  run: number;
  maxEncumbrance: number;
  corruptionThreshold: number;
  restRecovery: number;
}

export function useDerived(): DerivedStats {
  const { template: c } = useCharacter();
  const { list } = useCharacteristics();
  const { list: talentList } = useTalents();
  const races = useRaces();
  const woundsRules = useWoundsRules();
  const { formulas } = useSystemRules();

  const vars = charVars(list);
  // Resolve the species by stable id first (rename-proof), falling back to the
  // display name for characters created before raceId existed.
  const race = races.find(r => r.id === c.raceId) ?? races.find(r => r.name === c.species);
  const raceSize = race?.size;
  const small = raceSize != null && woundsRules.smallSizes.includes(raceSize);
  const bonusRanks = talentList.find(t => t.name === woundsRules.bonusTalent)?.times ?? 0;

  // Derived stats are non-negative quantities; clamp at 0 so sparse
  // characteristics or a custom pack formula can't push e.g. maxWounds negative
  // into the UI. evalFormulaSafe also keeps an invalid pack formula from throwing
  // during render (caught only by the top-level ErrorBoundary otherwise).
  const nn = (src: string, v: Record<string, number>) => Math.max(0, evalFormulaSafe(src, v));

  return {
    vars,
    small,
    bonusRanks,
    maxWounds: nn(formulas.maxWounds, { ...vars, small: small ? 1 : 0, bonusRanks }),
    walk: nn(formulas.walk, { ...vars, m: c.movement }),
    run: nn(formulas.run, { ...vars, m: c.movement }),
    maxEncumbrance: nn(formulas.maxEncumbrance, vars),
    corruptionThreshold: nn(formulas.corruptionThreshold, vars),
    restRecovery: nn(formulas.restRecovery, vars),
  };
}
