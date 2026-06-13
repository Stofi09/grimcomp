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

import { useEffect, useRef, useState, useCallback } from 'react';

type Setter<T> = T | ((prev: T) => T);
type SetState<T> = (next: Setter<T>) => void;

// In-memory store shared across all subscribers, keyed by storage key.
// Invariant: the cache only ever holds *real* values — parsed from
// localStorage, written via setValue, or received from another tab. Seeds are
// never cached, so a hook's value keeps tracking its (possibly async-loaded,
// template-derived) seed until something is actually persisted.
const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

function emit(key: string) {
  const ls = listeners.get(key);
  if (ls) for (const l of ls) l();
}

/** localStorage.getItem that tolerates privacy-mode / sandbox exceptions. */
function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Synchronous read: cache hit wins; otherwise read localStorage once and
 * populate the cache with the parsed value. A missing key or a JSON.parse
 * failure falls back to the seed (uncached — see the cache invariant above).
 */
function readStored<T>(key: string, seed: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  const raw = readRaw(key);
  if (raw == null) return seed;
  try {
    const parsed = JSON.parse(raw) as T;
    cache.set(key, parsed);
    return parsed;
  } catch {
    return seed;
  }
}

// Cross-tab sync (a web bonus the RN version couldn't have): another tab
// writing a `gc.*` key fires `storage` here. Update the cache and re-render
// every subscriber of that key. Registered once at module level.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e: StorageEvent) => {
    const key = e.key;
    if (!key || !key.startsWith('gc.')) return;
    if (e.newValue == null) {
      // Removed in the other tab — drop it; the next read re-hydrates and
      // falls back to the current seed.
      cache.delete(key);
    } else {
      try {
        cache.set(key, JSON.parse(e.newValue));
      } catch {
        cache.delete(key);
      }
    }
    emit(key);
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
  // bumps it, forcing this hook to re-read from `cache`.
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
  useEffect(() => {
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    const l = () => setTick(n => n + 1);
    set.add(l);
    return () => {
      set!.delete(l);
      if (set!.size === 0) listeners.delete(key);
    };
  }, [key]);

  const value = readStored(key, initialRef.current);

  const setValue: SetState<T> = useCallback((next) => {
    // Functional updates resolve SYNCHRONOUSLY against the shared cache —
    // callers (useXp.spend) smuggle results out through closures and depend
    // on the updater having run before setValue returns.
    const cur = readStored(key, initialRef.current);
    const resolved = typeof next === 'function' ? (next as (p: T) => T)(cur) : next;
    if (Object.is(resolved, cur)) return;
    cache.set(key, resolved);
    emit(key);
    try {
      window.localStorage.setItem(key, JSON.stringify(resolved));
    } catch { /* quota exceeded / privacy mode — keep the in-memory value */ }
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
  // localStorage: collect first (removing while iterating shifts indices).
  try {
    const toDrop: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && predicate(k)) toDrop.push(k);
    }
    for (const k of toDrop) {
      try { window.localStorage.removeItem(k); } catch { /* privacy mode */ }
    }
  } catch { /* privacy mode — nothing persisted to clear */ }

  // In-memory cache: drop matching keys and re-render their subscribers.
  for (const k of [...cache.keys()]) {
    if (predicate(k)) {
      cache.delete(k);
      emit(k);
    }
  }
}

/**
 * Test-only: drop everything from the in-memory cache. Use sparingly; doesn't
 * touch localStorage, so re-mounted hooks will re-hydrate from disk.
 */
export function _resetStoredCache() {
  cache.clear();
  listeners.clear();
}
