// Framework-free derived-character calculations shared by the active-character
// hooks and roster summaries.

import type { Character, Characteristic, Talent } from '@/data/character';
import type { DerivedFormulas, Race, WoundsRules } from '@/content/types';
import { charVars, evalFormulaSafe } from './formula';

export type LiveCharacteristic = Characteristic & { current: number; bonus: number };
export type LiveTalent = Talent & { times: number };

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

export function deriveStats(
  character: Character,
  characteristics: LiveCharacteristic[],
  talents: LiveTalent[],
  races: Race[],
  woundsRules: WoundsRules,
  formulas: DerivedFormulas,
): DerivedStats {
  const vars = charVars(characteristics);
  const race = races.find(r => r.id === character.raceId)
    ?? races.find(r => r.name === character.species);
  const raceSize = race?.size;
  const small = raceSize != null && woundsRules.smallSizes.includes(raceSize);
  const bonusRanks = talents.find(t => t.name === woundsRules.bonusTalent)?.times ?? 0;

  const nonNegative = (src: string, values: Record<string, number>) =>
    Math.max(0, evalFormulaSafe(src, values));

  return {
    vars,
    small,
    bonusRanks,
    maxWounds: nonNegative(formulas.maxWounds, {
      ...vars,
      small: small ? 1 : 0,
      bonusRanks,
    }),
    walk: nonNegative(formulas.walk, { ...vars, m: character.movement }),
    run: nonNegative(formulas.run, { ...vars, m: character.movement }),
    maxEncumbrance: nonNegative(formulas.maxEncumbrance, vars),
    corruptionThreshold: nonNegative(formulas.corruptionThreshold, vars),
    restRecovery: nonNegative(formulas.restRecovery, vars),
  };
}
