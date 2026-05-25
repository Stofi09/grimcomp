// Generic AsyncStorage-backed useState with cross-instance sync.
//
// Multiple components calling `useStoredState(key, …)` with the same key share
// state in real time — when one writes, every other subscriber re-renders with
// the new value. That's required so the rail's "spendable XP" vital and the XP
// screen's counter stay in sync as the user buys advances.
//
// Hydration is async on first read; subsequent reads are synchronous.

import { useEffect, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Setter<T> = T | ((prev: T) => T);
type SetState<T> = (next: Setter<T>) => void;

// In-memory store shared across all subscribers, keyed by storage key.
const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

function emit(key: string) {
  const ls = listeners.get(key);
  if (ls) for (const l of ls) l();
}

/**
 * Persisted, cross-instance-synced state.
 *
 * Returns `[value, setValue, ready]`. Components reading the same key see the
 * same value and re-render together when any one of them calls setValue.
 * Writes are mirrored to AsyncStorage so the value survives reloads.
 */
export function useStoredState<T>(key: string, initial: T) {
  // `_tick` is a render trigger — when another instance writes, our listener
  // bumps it, forcing this hook to re-read from `cache`.
  const [, setTick] = useState(0);
  const [ready, setReady] = useState(cache.has(key));

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

  // Hydrate once per key. The `cache.has(key)` check ensures only the first
  // mounting instance pays the AsyncStorage round-trip.
  useEffect(() => {
    if (cache.has(key)) {
      setReady(true);
      return;
    }
    let cancelled = false;
    AsyncStorage.getItem(key)
      .then(raw => {
        if (cancelled) return;
        if (raw != null) {
          try { cache.set(key, JSON.parse(raw) as T); }
          catch { cache.set(key, initialRef.current); }
        } else {
          cache.set(key, initialRef.current);
        }
        emit(key);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        cache.set(key, initialRef.current);
        emit(key);
        setReady(true);
      });
    return () => { cancelled = true; };
  }, [key]);

  const value = (cache.has(key) ? cache.get(key) : initialRef.current) as T;

  const setValue: SetState<T> = useCallback((next) => {
    const cur = (cache.has(key) ? cache.get(key) : initialRef.current) as T;
    const resolved = typeof next === 'function' ? (next as (p: T) => T)(cur) : next;
    if (Object.is(resolved, cur)) return;
    cache.set(key, resolved);
    emit(key);
    AsyncStorage.setItem(key, JSON.stringify(resolved)).catch(() => { /* swallow */ });
  }, [key]);

  return [value, setValue, ready] as const;
}

/**
 * Test-only: drop everything from the in-memory cache. Use sparingly; doesn't
 * touch AsyncStorage, so re-mounted hooks will re-hydrate from disk.
 */
export function _resetStoredCache() {
  cache.clear();
  listeners.clear();
}
