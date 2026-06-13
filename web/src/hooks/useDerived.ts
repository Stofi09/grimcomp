// Derived stats computed from the system formulas (content packs' `system`
// section) and the active character's live characteristics. Centralizes what
// Overview / Wounds / Trappings / Psychology previously each computed with
// hardcoded WFRP math.

import { useCharacter } from './useCharacter';
import { useCharacteristics } from './useCharacteristics';
import { useTalents } from './useTalents';
import { useRaces, useSystemRules, useWoundsRules } from '@/content/useContent';
import { charVars, evalFormula } from '@/utils/formula';

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
  const raceSize = races.find(r => r.name === c.species)?.size;
  const small = raceSize != null && woundsRules.smallSizes.includes(raceSize);
  const bonusRanks = talentList.find(t => t.name === woundsRules.bonusTalent)?.times ?? 0;

  return {
    vars,
    small,
    bonusRanks,
    maxWounds: evalFormula(formulas.maxWounds, { ...vars, small: small ? 1 : 0, bonusRanks }),
    walk: evalFormula(formulas.walk, { ...vars, m: c.movement }),
    run: evalFormula(formulas.run, { ...vars, m: c.movement }),
    maxEncumbrance: evalFormula(formulas.maxEncumbrance, vars),
    corruptionThreshold: evalFormula(formulas.corruptionThreshold, vars),
    restRecovery: evalFormula(formulas.restRecovery, vars),
  };
}
