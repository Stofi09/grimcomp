// Per-character condition chips + derived test modifier.
import { useCallback, useMemo } from 'react';
import { useStoredState } from './useStoredState';
import { useActiveCharId, characterKey } from './useCharacter';
import { useRoster } from './useRoster';
import { CONDITIONS } from '@/data/character';

export type ConditionMap = Record<string, number>;

const PENALTY_PER_STACK: Record<string, number> = {
  Fatigued: -10,
  Stunned: -10,
  Surprised: -20,
};

export interface ConditionModifierBreakdown {
  total: number;
  parts: Array<{ name: string; stacks: number; modifier: number }>;
}

export function useConditions() {
  const id = useActiveCharId();
  const { get } = useRoster();
  const tpl = get(id);

  const seed: ConditionMap = {};
  for (const t of CONDITIONS) seed[t] = 0;
  for (const c of tpl.conditions ?? []) seed[c.type] = c.stacks;

  const [conds, setConds] = useStoredState<ConditionMap>(characterKey(id, 'conditions'), seed);

  const cycle = useCallback((name: string) => {
    setConds(prev => {
      const cur = prev[name] ?? 0;
      const next = cur >= 2 ? 0 : cur + 1;
      return { ...prev, [name]: next };
    });
  }, [setConds]);

  const modifier = useMemo<ConditionModifierBreakdown>(() => {
    const parts: ConditionModifierBreakdown['parts'] = [];
    let total = 0;
    for (const name of Object.keys(PENALTY_PER_STACK)) {
      const stacks = conds[name] ?? 0;
      if (stacks <= 0) continue;
      const m = PENALTY_PER_STACK[name] * stacks;
      parts.push({ name, stacks, modifier: m });
      total += m;
    }
    return { total, parts };
  }, [conds]);

  return { conds, cycle, modifier };
}
