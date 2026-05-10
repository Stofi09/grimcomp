// Shared persistence + cycle logic for the 12 WFRP condition chips.
// Used by both Overview and Wounds screens.
import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { CHARACTER, CONDITIONS } from '@/data/character';

export type ConditionMap = Record<string, number>;

const KEY = 'gc.conditions';

const initialMap = (): ConditionMap => {
  const seed: ConditionMap = {};
  for (const t of CONDITIONS) seed[t] = 0;
  for (const c of CHARACTER.conditions) seed[c.type] = c.stacks;
  return seed;
};

export function useConditions() {
  const [conds, setConds] = useStoredState<ConditionMap>(KEY, initialMap());
  const cycle = useCallback((name: string) => {
    setConds(prev => {
      const cur = prev[name] ?? 0;
      const next = cur >= 2 ? 0 : cur + 1; // 0 → 1 → 2 → 0
      return { ...prev, [name]: next };
    });
  }, [setConds]);
  return { conds, cycle };
}
