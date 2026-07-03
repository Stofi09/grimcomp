// Generic localStorage-backed useState with cross-instance sync.
//
// Multiple components calling `useStoredState(key, …)` with the same key share
// state in real time — when one writes, every other subscriber re-renders with
// the new value. That's required so the rail's "spendable XP" vital and the XP
// screen's counter stay in sync as the user buys advances.
//
// Unlike the AsyncStorage-backed RN original, hydration is synchronous: the
// first access for a key reads localStorage immediately, so `ready` is always
// true. It stays in the returned tuple for API compatibility.
//
// The cache + persistence semantics live in StorageCore (framework-free and
// unit-tested); this file is the React binding plus the cross-tab listener.

import { useEffect, useRef, useState, useCallback } from 'react';
import { StorageCore, browserBackend } from './storageCore';

type Setter<T> = T | ((prev: T) => T);
type SetState<T> = (next: Setter<T>) => void;

// One store shared across every subscriber for the lifetime of the module.
const store = new StorageCore(browserBackend());

// Cross-tab sync (a web bonus the RN version couldn't have): another tab
// writing a `gc.*` key fires `storage` here. Registered once at module level.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e: StorageEvent) => {
    const key = e.key;
    if (!key || !key.startsWith('gc.')) return;
    store.applyExternal(key, e.newValue);
  });
}

/**
 * Persisted, cross-instance-synced state.
 *
 * Returns `[value, setValue, ready]`. Components reading the same key see the
 * same value and re-render together when any one of them calls setValue.
 * Writes are mirrored to localStorage so the value survives reloads.
 */
export function useStoredState<T>(key: string, initial: T) {
  // `_tick` is a render trigger — when another instance writes, our listener
  // bumps it, forcing this hook to re-read from the store.
  const [, setTick] = useState(0);

  // `initialRef` holds the seed for the *current* key. Per-character hooks key
  // their storage on `characterKey(id, …)`, so switching the active character
  // changes `key` on a still-mounted instance (the persistent Rail / AppBar).
  // Re-anchor the seed when that happens — otherwise the newly-selected
  // character hydrates its storage from the previous character's seed.
  const initialRef = useRef(initial);
  const keyRef = useRef(key);
  if (keyRef.current !== key) {
    keyRef.current = key;
    initialRef.current = initial;
  }

  // Subscribe to cross-instance writes for this key.
  useEffect(() => store.subscribe(key, () => setTick(n => n + 1)), [key]);

  const value = store.read(key, initialRef.current);

  const setValue: SetState<T> = useCallback((next) => {
    // Functional updates resolve SYNCHRONOUSLY against the shared cache —
    // callers (useXp.spend) smuggle results out through closures and depend
    // on the updater having run before setValue returns.
    store.update(key, initialRef.current, next);
  }, [key]);

  // Hydration is synchronous on the web, so `ready` is always true. Kept in
  // the tuple so callers written against the RN original port unchanged.
  const ready: boolean = true;

  return [value, setValue, ready] as const;
}

/**
 * Permanently drop every stored key matching `predicate` from BOTH localStorage
 * and the in-memory cache, notifying any live subscribers so they fall back to
 * their seed. Used when a character is deleted, so its `gc.<id>.*` overlay state
 * can't leak into a later character that reuses the id.
 */
export function clearStoredKeys(predicate: (key: string) => boolean) {
  store.clearMatching(predicate);
}

/**
 * Test-only: drop everything from the in-memory cache. Use sparingly; doesn't
 * touch localStorage, so re-mounted hooks will re-hydrate from disk.
 */
export function _resetStoredCache() {
  store.reset();
}
