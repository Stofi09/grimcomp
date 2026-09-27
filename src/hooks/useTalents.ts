// Live talent ranks, scoped to the active character.
import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { useActiveCharId, characterKey } from './useCharacter';
import { useRoster } from './useRoster';
import { useCharacteristics } from './useCharacteristics';
import { useTalentDefs } from '@/content/useContent';
import { type Talent } from '@/data/character';
import type { NativeDurabilityResult } from '@/storage/nativeStore';
import { incrementTalentRank, talentDefinitionForName, talentMaxRank } from '@/utils/nativeTalents';

type TimesMap = Record<string, number>;

export interface TalentRankResult {
  ok: boolean;
  message: string;
  /** Present when the refusal is the talent's rank cap. */
  max?: number;
  /** Durability of the write, or of the enclosing transaction. */
  completion?: Promise<NativeDurabilityResult>;
}

export function useTalents() {
  const id = useActiveCharId();
  const { get } = useRoster();
  const tpl = get(id);
  const seed = Object.fromEntries(tpl.talents.map(t => [t.name, t.times]));
  const [times, setTimes] = useStoredState<TimesMap>(characterKey(id, 'talents.times'), seed);
  const talentDefs = useTalentDefs();
  const { list: characteristics } = useCharacteristics();

  /** The catalogue cap (flat Max, else the listed characteristic Bonus). */
  const maxRankFor = useCallback((name: string): number | undefined => talentMaxRank(
    talentDefinitionForName(talentDefs, name),
    key => characteristics.find(characteristic => characteristic.key === key)?.bonus ?? 0,
  ), [talentDefs, characteristics]);

  /**
   * Adds one rank, refusing without writing once the talent's cap is reached.
   * The cap is checked inside the functional update, against the same
   * snapshot the increment uses, so it also holds within a larger transaction.
   */
  const buyAnother = useCallback((name: string): TalentRankResult => {
    const max = maxRankFor(name);
    const templateTimes = tpl.talents.find(talent => talent.name === name)?.times ?? 0;
    let result: TalentRankResult = { ok: false, message: 'Storage is not ready for this purchase.' };
    const completion = setTimes(previous => {
      const increment = incrementTalentRank(previous, name, templateTimes, max);
      result = increment.ok
        ? { ok: true, message: `${name} is now rank ${increment.rank}.` }
        : {
            ok: false,
            max: increment.max,
            message: `${name} is already at its maximum of ${increment.max} ${increment.max === 1 ? 'rank' : 'ranks'}.`,
          };
      return increment.times;
    });
    return { ...result, completion };
  }, [setTimes, maxRankFor, tpl]);

  const list: (Talent & { times: number; max?: number })[] = tpl.talents.map(t => ({
    ...t,
    times: times[t.name] ?? t.times,
    max: maxRankFor(t.name),
  }));

  return { times, list, buyAnother, maxRankFor };
}
