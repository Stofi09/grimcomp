import { describe, it, expect } from 'vitest';
import { seedResources, setResourceValue, refreshResourceValue } from './resources';
import { DEFAULT_RESOURCES } from '@/content/registry';
import type { ResourceDef } from '@/content/types';

// These pin the WFRP paired-pool behaviour the old useVitals hardcoded, now
// expressed as data — Fortune ≤ Fate (refreshes to Fate), Resolve ≤ Resilience,
// Corruption uncapped.
const D = DEFAULT_RESOURCES;

describe('seedResources', () => {
  it('reads each resource from the template, defaulting missing ones to 0', () => {
    const seed = seedResources(D, { fate: 3, fortune: 2, resilience: 4, resolve: 1, corruption: 5 });
    expect(seed).toEqual({ fate: 3, fortune: 2, resilience: 4, resolve: 1, corruption: 5 });
    expect(seedResources(D, {})).toEqual({ fate: 0, fortune: 0, resilience: 0, resolve: 0, corruption: 0 });
  });
});

describe('setResourceValue — caps and floors', () => {
  const base = { fate: 3, fortune: 1, resilience: 3, resolve: 1, corruption: 0 };

  it('clamps a capped pool to its cap source', () => {
    expect(setResourceValue(D, base, 'fortune', 5).fortune).toBe(3); // capped at Fate
    expect(setResourceValue(D, base, 'fortune', 2).fortune).toBe(2);
  });

  it('floors every pool at 0', () => {
    expect(setResourceValue(D, base, 'fate', -4).fate).toBe(0);
    expect(setResourceValue(D, base, 'corruption', -1).corruption).toBe(0);
  });

  it('leaves an uncapped pool unbounded above', () => {
    expect(setResourceValue(D, base, 'corruption', 99).corruption).toBe(99);
  });

  it('re-clamps a dependent when its cap source drops (burning Fate lowers Fortune)', () => {
    const full = { ...base, fortune: 3 };
    const next = setResourceValue(D, full, 'fate', 1);
    expect(next.fate).toBe(1);
    expect(next.fortune).toBe(1); // was 3, re-capped to new Fate
  });

  it('does not raise a dependent when its cap source rises', () => {
    const next = setResourceValue(D, base, 'fate', 6);
    expect(next.fate).toBe(6);
    expect(next.fortune).toBe(1); // unchanged — only re-clamped downward
  });

  it('treats a non-finite value as 0 rather than persisting NaN', () => {
    const next = setResourceValue(D, base, 'fate', NaN);
    expect(next.fate).toBe(0);
    expect(Number.isFinite(next.fate)).toBe(true);
  });

  it('re-clamps a cap chain transitively (lowering a cascades through b to c)', () => {
    const chain: ResourceDef[] = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', capBy: 'a' },
      { id: 'c', label: 'C', capBy: 'b' },
    ];
    const next = setResourceValue(chain, { a: 5, b: 5, c: 5 }, 'a', 2);
    expect(next).toEqual({ a: 2, b: 2, c: 2 });
  });
});

describe('refreshResourceValue', () => {
  it('refreshes a pool to its cap source', () => {
    const state = { fate: 4, fortune: 1, resilience: 2, resolve: 0, corruption: 0 };
    expect(refreshResourceValue(D, state, 'fortune').fortune).toBe(4); // → Fate
    expect(refreshResourceValue(D, state, 'resolve').resolve).toBe(2); // → Resilience
  });

  it('leaves a pool with no refresh rule unchanged', () => {
    const state = { fate: 4, fortune: 1, resilience: 2, resolve: 0, corruption: 3 };
    expect(refreshResourceValue(D, state, 'fate')).toEqual(state);
    expect(refreshResourceValue(D, state, 'corruption')).toEqual(state);
  });
});
