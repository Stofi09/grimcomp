// Generic durable state with synchronous cross-instance updates.
//
// Native persistence is gated by crash recovery + migrations at app startup.
// Functional updaters still run synchronously against one process-wide cache;
// the setter's Promise reports whether the shared journal was durably verified.

import { useCallback, useEffect, useRef, useState } from 'react';
import { initializeNativeStorage, nativeStorage } from '@/storage/runtime';
import type { NativeDurabilityResult, StoredTransaction } from '@/storage/nativeStore';

type Setter<T> = T | ((previous: T) => T);
export type StoredStateSetter<T> = (next: Setter<T>) => Promise<NativeDurabilityResult>;

/**
 * Persisted, cross-instance-synced state.
 *
 * Returns `[value, setValue, ready]`. `setValue` updates memory and notifies all
 * subscribers before returning, while its Promise resolves after verified
 * persistence. Callers that historically ignored the return value still see
 * exactly the same synchronous functional-updater behaviour.
 */
export function useStoredState<T>(key: string, initial: T) {
  const [, setTick] = useState(0);
  const [ready, setReady] = useState(
    () => nativeStorage.getStatus().ready && nativeStorage.isHydrated(key),
  );

  const initialRef = useRef(initial);
  const keyRef = useRef(key);
  if (keyRef.current !== key) {
    keyRef.current = key;
    initialRef.current = initial;
  }

  useEffect(() => nativeStorage.subscribeKey(key, () => setTick(value => value + 1)), [key]);

  useEffect(() => {
    let cancelled = false;
    const seedForKey = initialRef.current;
    setReady(nativeStorage.getStatus().ready && nativeStorage.isHydrated(key));
    const unsubscribe = nativeStorage.subscribeStatus((status) => {
      if (cancelled || !status.ready) return;
      if (nativeStorage.isHydrated(key)) {
        setReady(true);
        setTick(value => value + 1);
      }
    });
    void initializeNativeStorage().then(async (status) => {
      if (!status.ready || cancelled) return;
      if (!nativeStorage.isHydrated(key)) {
        await nativeStorage.hydrate(key, seedForKey);
      }
      if (!cancelled) {
        setReady(true);
        setTick(value => value + 1);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key]);

  const value = nativeStorage.read(key, initialRef.current);

  const setValue: StoredStateSetter<T> = useCallback((next) => (
    nativeStorage.update(key, initialRef.current, next)
  ), [key]);

  return [value, setValue, ready] as const;
}

/**
 * Batch existing hook setters into one recoverable transaction. The callback
 * runs synchronously; its returned Promise is the outer batch's durability.
 * Nested calls join the outer batch.
 */
export function runStoredTransaction(
  work: (transaction: StoredTransaction) => void,
): Promise<NativeDurabilityResult> {
  return nativeStorage.runTransaction(work);
}

export function clearStoredKeys(
  predicate: (key: string) => boolean,
): Promise<NativeDurabilityResult> {
  const keys = nativeStorage.knownKeys(predicate);
  return nativeStorage.runTransaction((transaction) => {
    for (const key of keys) {
      transaction.remove(key);
    }
  });
}

/** Synchronous key snapshot for composing removals into an outer batch. */
export function storedKeys(predicate: (key: string) => boolean): readonly string[] {
  return nativeStorage.knownKeys(predicate);
}

/** Test-only: clear process memory without changing AsyncStorage. */
export function _resetStoredCache() {
  nativeStorage.resetMemory();
}
