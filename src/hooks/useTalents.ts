// Live talent ranks, scoped to the active character.
import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { useActiveCharId, characterKey } from './useCharacter';
import { useRoster } from './useRoster';
import { type Talent } from '@/data/character';

type TimesMap = Record<string, number>;

export function useTalents() {
  const id = useActiveCharId();
  const { get } = useRoster();
  const tpl = get(id);
  const seed = Object.fromEntries(tpl.talents.map(t => [t.name, t.times]));
  const [times, setTimes] = useStoredState<TimesMap>(characterKey(id, 'talents.times'), seed);

  const buyAnother = useCallback((name: string) => {
    setTimes(prev => ({ ...prev, [name]: (prev[name] ?? 0) + 1 }));
  }, [setTimes]);

  const list: (Talent & { times: number })[] = tpl.talents.map(t => ({
    ...t,
    times: times[t.name] ?? t.times,
  }));

  return { times, list, buyAnother };
}
