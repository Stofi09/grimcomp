// Pure advancement rules: talent rank caps (WFRP 4e "Max") and the in-career /
// non-career distinction that drives characteristic-advance pricing. Kept
// dependency-free so both live and unit-tested from the screens.

import type { CharacteristicKey } from '@/data/character';
import type { TalentDef, Career } from '@/content/types';

/**
 * The maximum number of ranks a talent may be taken (WFRP 4e p.135). A flat
 * `max` wins; otherwise the Bonus of the talent's `maxChar`; otherwise undefined
 * (the talent has no listed cap and is not rank-limited by this engine).
 */
export function talentMaxRank(
  def: Pick<TalentDef, 'max' | 'maxChar'> | undefined,
  bonusFor: (key: CharacteristicKey) => number,
): number | undefined {
  if (!def) return undefined;
  if (typeof def.max === 'number') return Math.max(1, Math.floor(def.max));
  if (def.maxChar) return Math.max(1, Math.floor(bonusFor(def.maxChar)));
  return undefined;
}

/**
 * True when a characteristic is inside the career's advance scheme. A career
 * with no declared scheme treats every characteristic as in-career, so nothing
 * is penalised until the data is authored.
 */
export function isCareerCharacteristic(
  career: Pick<Career, 'advanceScheme'> | undefined,
  key: CharacteristicKey,
): boolean {
  const scheme = career?.advanceScheme?.characteristics;
  if (!scheme || scheme.length === 0) return true;
  return scheme.includes(key);
}

/**
 * The XP cost of a characteristic advance, applying the non-career multiplier
 * when the characteristic is outside the current career's advance scheme.
 */
export function characteristicAdvanceCost(
  baseCost: number,
  inCareer: boolean,
  nonCareerMultiplier: number,
): number {
  return inCareer ? baseCost : Math.round(baseCost * nonCareerMultiplier);
}
