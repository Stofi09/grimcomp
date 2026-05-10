// Live talent ranks. Stores per-talent `times` count overrides.
import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { CHARACTER, type Talent } from '@/data/character';

const KEY = 'gc.talents.times';

type TimesMap = Record<string, number>;

const seed: TimesMap = Object.fromEntries(
  CHARACTER.talents.map(t => [t.name, t.times])
);

export function useTalents() {
  const [times, setTimes] = useStoredState<TimesMap>(KEY, seed);

  /** Increment a talent's "times taken" by 1. Costs 100 × (new times). */
  const buyAnother = useCallback((name: string) => {
    setTimes(prev => ({ ...prev, [name]: (prev[name] ?? 0) + 1 }));
  }, [setTimes]);

  const list: (Talent & { times: number })[] = CHARACTER.talents.map(t => ({
    ...t,
    times: times[t.name] ?? t.times,
  }));

  return { times, list, buyAnother };
}
