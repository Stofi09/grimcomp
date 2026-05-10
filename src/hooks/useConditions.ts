// Shared persistence + cycle logic for the 12 WFRP condition chips.
// Used by both Overview and Wounds screens, and by the test-roll utilities
// to compute condition-driven modifiers.
import { useCallback, useMemo } from 'react';
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

// Per-condition modifier (per stack) applied to all tests as a simplified
// implementation of WFRP's condition penalties. The full rulebook splits the
// penalty across specific test types, but for the prototype we keep a single
// effective number and surface the breakdown in the rolled-test alert.
const PENALTY_PER_STACK: Record<string, number> = {
  Fatigued: -10,
  Stunned: -10,
  Surprised: -20,
  // Skipped: Bleeding (no test penalty, just damage), Blinded (-20 to sight
  // tests), Broken (-10 to most), Deafened (-20 hearing), Entangled (S test
  // to escape), Poisoned (varies), Prone (mostly movement), Unconscious
  // (auto-fails). Easy to extend later — just add entries here.
};

export interface ConditionModifierBreakdown {
  total: number;
  parts: Array<{ name: string; stacks: number; modifier: number }>;
}

export function useConditions() {
  const [conds, setConds] = useStoredState<ConditionMap>(KEY, initialMap());

  const cycle = useCallback((name: string) => {
    setConds(prev => {
      const cur = prev[name] ?? 0;
      const next = cur >= 2 ? 0 : cur + 1; // 0 → 1 → 2 → 0
      return { ...prev, [name]: next };
    });
  }, [setConds]);

  /** Total flat modifier applied to every test, plus per-condition breakdown. */
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
