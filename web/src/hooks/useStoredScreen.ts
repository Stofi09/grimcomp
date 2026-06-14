// Persists the active screen across reloads.
// Mirrors the prototype's `localStorage.getItem('gc_screen')` behaviour, but the
// valid ids and the default landing screen now come from the resolved nav model
// (so a pack that renames/removes/adds screens stays consistent).
import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import type { NavModel } from '@/data/nav';

const KEY = 'gc.screen';

/**
 * Returns `[ready, screen, setScreen]`. Validates the persisted value against
 * the nav model's ids and falls back to its landing screen if the stored id is
 * unknown (e.g. a pack dropped that screen).
 */
export function useStoredScreen(navModel: NavModel) {
  const fallback = navModel.defaultScreenId;
  const [stored, setStored, ready] = useStoredState<string>(KEY, fallback);
  // Guard against corrupted storage or a screen that no longer exists.
  const screen = navModel.allIds.includes(stored) ? stored : fallback;
  const setScreen = useCallback((next: string) => setStored(next), [setStored]);
  return [ready, screen, setScreen] as const;
}
