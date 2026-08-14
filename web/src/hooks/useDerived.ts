// Derived stats computed from the system formulas (content packs' `system`
// section) and the active character's live characteristics. Centralizes what
// Overview / Wounds / Trappings / Psychology previously each computed with
// hardcoded WFRP math.

import { useCharacter } from './useCharacter';
import { useCharacteristics } from './useCharacteristics';
import { useTalents } from './useTalents';
import { useRaces, useSystemRules, useWoundsRules } from '@/content/useContent';
import { deriveStats, type DerivedStats } from '@/utils/derived';

export type { DerivedStats } from '@/utils/derived';

export function useDerived(): DerivedStats {
  const { template: c } = useCharacter();
  const { list } = useCharacteristics();
  const { list: talentList } = useTalents();
  const races = useRaces();
  const woundsRules = useWoundsRules();
  const { formulas } = useSystemRules();

  return deriveStats(c, list, talentList, races, woundsRules, formulas);
}
