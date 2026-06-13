// Per-character condition chips + derived test modifier.
//
// Condition definitions ({name, penalty?, maxStacks?, description?}) come from
// the content registry, so the stack caps and per-stack penalties that used to
// be hardcoded here now live in JSON content packs.
import { useCallback, useMemo } from 'react';
import { useStoredState } from './useStoredState';
import { useActiveCharId, characterKey } from './useCharacter';
import { useRoster } from './useRoster';
import { useConditionList } from '@/content/useContent';

export type ConditionMap = Record<string, number>;

export interface ConditionModifierBreakdown {
  total: number;
  parts: Array<{ name: string; stacks: number; modifier: number }>;
}

export function useConditions() {
  const id = useActiveCharId();
  const { get } = useRoster();
  const tpl = get(id);
  const defs = useConditionList();

  const seed: ConditionMap = {};
  for (const d of defs) seed[d.name] = 0;
  for (const c of tpl.conditions ?? []) seed[c.type] = c.stacks;

  const [conds, setConds] = useStoredState<ConditionMap>(characterKey(id, 'conditions'), seed);

  // Tapping a chip cycles 0 → 1 → … → maxStacks → 0 (default cap 2).
  const cycle = useCallback((name: string) => {
    const cap = defs.find(d => d.name === name)?.maxStacks ?? 2;
    setConds(prev => {
      const cur = prev[name] ?? 0;
      const next = cur >= cap ? 0 : cur + 1;
      return { ...prev, [name]: next };
    });
  }, [setConds, defs]);

  const modifier = useMemo<ConditionModifierBreakdown>(() => {
    const parts: ConditionModifierBreakdown['parts'] = [];
    let total = 0;
    for (const def of defs) {
      const penalty = def.penalty ?? 0;
      if (penalty === 0) continue;
      const stacks = conds[def.name] ?? 0;
      if (stacks <= 0) continue;
      const m = penalty * stacks;
      parts.push({ name: def.name, stacks, modifier: m });
      total += m;
    }
    return { total, parts };
  }, [conds, defs]);

  const names = useMemo(() => defs.map(d => d.name), [defs]);

  return { conds, cycle, modifier, names, defs };
}
