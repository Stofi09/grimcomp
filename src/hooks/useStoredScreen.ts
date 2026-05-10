// Persists the active screen across reloads.
// Mirrors the prototype's `localStorage.getItem('gc_screen')` behaviour.
import { useEffect, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScreenId } from '@/data/nav';

const KEY = 'gc.screen';
const VALID: ReadonlyArray<ScreenId> = [
  'overview', 'characteristics', 'skills', 'talents', 'career', 'xp',
  'combat', 'wounds', 'magic', 'faith', 'trappings', 'psychology',
  'reference', 'notes', 'roster', 'settings', 'newchar',
];

/**
 * Hydrates `screen` from AsyncStorage on mount, then writes-through on every change.
 * Returns `[ready, screen, setScreen]`. Consumer should render a placeholder until ready
 * to avoid a single-frame flash of the default screen.
 */
export function useStoredScreen(initial: ScreenId = 'overview') {
  const [screen, setScreen] = useState<ScreenId>(initial);
  const [ready, setReady] = useState(false);
  const hydrated = useRef(false);

  // hydrate
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(KEY).then(value => {
      if (cancelled) return;
      if (value && (VALID as ReadonlyArray<string>).includes(value)) {
        setScreen(value as ScreenId);
      }
      hydrated.current = true;
      setReady(true);
    }).catch(() => {
      if (cancelled) return;
      hydrated.current = true;
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  // write-through after hydration
  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(KEY, screen).catch(() => { /* swallow */ });
  }, [screen]);

  const update = useCallback((next: ScreenId) => setScreen(next), []);

  return [ready, screen, update] as const;
}
