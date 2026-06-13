// Per-character hero resources: Fate/Fortune, Resilience/Resolve, and
// Corruption — the spendable / refreshable pools that the sheet must track.
//
// WFRP 4e model:
//  - Fate (permanent) caps Fortune. Fortune is spent for rerolls / +1 SL and
//    refreshes to Fate at the start of each session. Spending Fate is permanent
//    (cheat death) and lowers the Fortune cap.
//  - Resilience (permanent) caps Resolve. Resolve is spent to shrug off
//    conditions / psychology and refreshes to Resilience when the character
//    acts on their Motivation. Spending Resilience is permanent.
//  - Corruption accrues from exposure to Chaos; at the threshold (TB + WPB) the
//    character risks mutation.
//
// Seeded from the active character template, then persisted under
// `gc.<id>.vitals` so switching characters swaps the whole pool.

import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { useActiveCharId, characterKey } from './useCharacter';
import { useRoster } from './useRoster';

export interface Vitals {
  fate: number;
  fortune: number;
  resilience: number;
  resolve: number;
  corruption: number;
}

export function useVitals() {
  const id = useActiveCharId();
  const { get } = useRoster();
  const tpl = get(id);
  const seed: Vitals = {
    fate: tpl.fate,
    fortune: tpl.fortune,
    resilience: tpl.resilience,
    resolve: tpl.resolve,
    corruption: tpl.corruption,
  };
  const [v, setV] = useStoredState<Vitals>(characterKey(id, 'vitals'), seed);

  // Fortune is clamped to [0, Fate].
  const setFortune = useCallback(
    (n: number) => setV(p => ({ ...p, fortune: Math.max(0, Math.min(n, p.fate)) })),
    [setV],
  );
  const refreshFortune = useCallback(() => setV(p => ({ ...p, fortune: p.fate })), [setV]);
  // Changing Fate (gain from the GM, or burn to cheat death) re-caps Fortune.
  const setFate = useCallback(
    (n: number) => setV(p => {
      const fate = Math.max(0, n);
      return { ...p, fate, fortune: Math.min(p.fortune, fate) };
    }),
    [setV],
  );

  // Resolve is clamped to [0, Resilience].
  const setResolve = useCallback(
    (n: number) => setV(p => ({ ...p, resolve: Math.max(0, Math.min(n, p.resilience)) })),
    [setV],
  );
  const refreshResolve = useCallback(() => setV(p => ({ ...p, resolve: p.resilience })), [setV]);
  const setResilience = useCallback(
    (n: number) => setV(p => {
      const resilience = Math.max(0, n);
      return { ...p, resilience, resolve: Math.min(p.resolve, resilience) };
    }),
    [setV],
  );

  const setCorruption = useCallback(
    (n: number) => setV(p => ({ ...p, corruption: Math.max(0, n) })),
    [setV],
  );

  return {
    ...v,
    setFate,
    setFortune,
    refreshFortune,
    setResilience,
    setResolve,
    refreshResolve,
    setCorruption,
  };
}
