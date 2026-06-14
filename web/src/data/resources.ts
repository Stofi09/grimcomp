// Pure resource-pool math, driven by ResourceDef config. Kept out of the hook
// so it is unit-testable without React. useVitals is a thin wrapper over this.
//
// The WFRP paired-pool mechanic: a permanent pool (Fate) caps a spendable one
// (Fortune ≤ Fate) which refreshes back to its cap. `capBy` wires that up; the
// general "max from a formula" case is handled elsewhere (derived stats).

import type { ResourceDef } from '@/content/types';

type Pools = Record<string, number>;

/** Build the initial pool state for a character, reading each resource's value
    from the template's like-named field (0 when the template lacks it). */
export function seedResources(defs: ResourceDef[], template: Record<string, number>): Pools {
  const seed: Pools = {};
  for (const d of defs) seed[d.id] = template[d.id] ?? 0;
  return seed;
}

/**
 * Set one resource to `n`, clamped to [0, capBy-value], then re-clamp any pool
 * this one caps (so lowering a cap source — e.g. burning Fate — also lowers its
 * dependent — Fortune). Returns a new state object.
 */
export function setResourceValue(
  defs: ResourceDef[], state: Pools, id: string, n: number,
): Pools {
  const def = defs.find(d => d.id === id);
  let val = Math.max(0, n);
  if (def?.capBy) val = Math.min(val, state[def.capBy] ?? 0);
  const next: Pools = { ...state, [id]: val };
  for (const d of defs) {
    if (d.capBy === id && (next[d.id] ?? 0) > val) next[d.id] = val;
  }
  return next;
}

/** Reset a resource to its refresh target ('cap' = its capBy pool's value).
    A resource with no refresh rule is returned unchanged. */
export function refreshResourceValue(defs: ResourceDef[], state: Pools, id: string): Pools {
  const def = defs.find(d => d.id === id);
  if (def?.refreshTo === 'cap' && def.capBy) {
    return { ...state, [id]: state[def.capBy] ?? 0 };
  }
  return state;
}
