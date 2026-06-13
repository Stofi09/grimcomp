// App-wide settings persisted under `gc.settings.*`.
//
// Currently only XP rule is "live" — read by useXp.spend to decide whether
// to refuse an overdraft (strict) or let it go through with a Warning alert
// (flexible).

import { useCallback } from 'react';
import { useStoredState } from './useStoredState';

export type XpRule = 'strict' | 'flexible';

export function useXpRule() {
  const [rule, setRule] = useStoredState<XpRule>('gc.settings.xpRule', 'strict');
  const set = useCallback((next: XpRule) => setRule(next), [setRule]);
  return [rule, set] as const;
}
