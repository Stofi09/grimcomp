// Persists the active screen across reloads.
// Mirrors the prototype's `localStorage.getItem('gc_screen')` behaviour.
import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import type { ScreenId } from '@/data/nav';

const KEY = 'gc.screen';
const VALID: ReadonlyArray<ScreenId> = [
  'overview', 'characteristics', 'skills', 'talents', 'career', 'xp',
  'combat', 'wounds', 'magic', 'faith', 'trappings', 'psychology',
  'reference', 'notes', 'roster', 'settings', 'newchar',
];

/**
 * Returns `[ready, screen, setScreen]`. Validates the persisted value and
 * falls back to `initial` if the stored id is unknown.
 */
export function useStoredScreen(initial: ScreenId = 'overview') {
  const [stored, setStored, ready] = useStoredState<ScreenId>(KEY, initial);
  // Guard against corrupted storage (e.g. someone wrote a non-ScreenId).
  const screen: ScreenId = (VALID as ReadonlyArray<string>).includes(stored) ? stored : initial;
  const setScreen = useCallback((next: ScreenId) => setStored(next), [setStored]);
  return [ready, screen, setScreen] as const;
}
