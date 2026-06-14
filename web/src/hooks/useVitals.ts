// Per-character hero-resource pools. The SET of pools and their cap/refresh
// relationships are now data-defined (content `resources`, default WFRP set in
// the registry); this hook is a thin, persisted wrapper over the pure pool math
// in data/resources.ts.
//
// WFRP 4e default model (DEFAULT_RESOURCES):
//  - Fate (permanent) caps Fortune; Fortune refreshes to Fate each session.
//  - Resilience (permanent) caps Resolve; Resolve refreshes to Resilience.
//  - Corruption is an uncapped accrual.
//
// Storage shape is unchanged: a flat { <resourceId>: value } map under
// `gc.<id>.vitals`, seeded from the active character's like-named fields — so
// existing saves load as-is (no migration). The named accessors below are kept
// for the screens that read them; setResource/refreshResource/pools expose the
// generic, data-driven surface.

import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { useActiveCharId, characterKey } from './useCharacter';
import { useRoster } from './useRoster';
import { useResources } from '@/content/useContent';
import { seedResources, setResourceValue, refreshResourceValue } from '@/data/resources';

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
  const defs = useResources();

  const seed = seedResources(defs, tpl as unknown as Record<string, number>);
  const [v, setV] = useStoredState<Record<string, number>>(characterKey(id, 'vitals'), seed);

  const setResource = useCallback(
    (rid: string, n: number) => setV(p => setResourceValue(defs, p, rid, n)),
    [setV, defs],
  );
  const refreshResource = useCallback(
    (rid: string) => setV(p => refreshResourceValue(defs, p, rid)),
    [setV, defs],
  );

  // Named accessors over the generic surface — the WFRP screens read these.
  const setFate = useCallback((n: number) => setResource('fate', n), [setResource]);
  const setFortune = useCallback((n: number) => setResource('fortune', n), [setResource]);
  const refreshFortune = useCallback(() => refreshResource('fortune'), [refreshResource]);
  const setResilience = useCallback((n: number) => setResource('resilience', n), [setResource]);
  const setResolve = useCallback((n: number) => setResource('resolve', n), [setResource]);
  const refreshResolve = useCallback(() => refreshResource('resolve'), [refreshResource]);
  const setCorruption = useCallback((n: number) => setResource('corruption', n), [setResource]);

  return {
    fate: v.fate ?? 0,
    fortune: v.fortune ?? 0,
    resilience: v.resilience ?? 0,
    resolve: v.resolve ?? 0,
    corruption: v.corruption ?? 0,
    /** All pools by id, including any beyond the WFRP five a pack declares. */
    pools: v,
    resourceDefs: defs,
    setResource,
    refreshResource,
    setFate,
    setFortune,
    refreshFortune,
    setResilience,
    setResolve,
    refreshResolve,
    setCorruption,
  };
}
