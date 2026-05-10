// Generic AsyncStorage-backed useState. JSON-serialises the value, hydrates on
// mount, write-throughs on every change.
import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type SetState<T> = (next: T | ((prev: T) => T)) => void;

/**
 * useStoredState<T>(key, initial)
 *
 * Like useState, but persisted across reloads under `key` in AsyncStorage.
 * Reads are async — on the very first render the hook returns `initial`, then
 * after hydration it returns the persisted value (one re-render).
 *
 * Returns `[value, setValue, ready]`. Most consumers can ignore `ready` and
 * accept a single-frame flash of `initial`. Gate the render on `ready` if the
 * flash is unacceptable.
 */
export function useStoredState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(key).then(raw => {
      if (cancelled) return;
      if (raw != null) {
        try {
          setValue(JSON.parse(raw) as T);
        } catch {
          // corrupted entry — fall back to initial
        }
      }
      hydrated.current = true;
      setReady(true);
    }).catch(() => {
      if (cancelled) return;
      hydrated.current = true;
      setReady(true);
    });
    return () => { cancelled = true; };
    // intentionally only on `key` — same key in same component shouldn't re-hydrate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => { /* swallow */ });
  }, [key, value]);

  return [value, setValue as SetState<T>, ready] as const;
}
