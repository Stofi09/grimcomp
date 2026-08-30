import { useCallback, useRef, useSyncExternalStore } from 'react';
import {
  browserStorageCoordinator,
  browserStorageCore as store,
} from '@/storage/browserStorage';
import type {
  StorageCoreStatus,
  StorageMaintenanceTicket,
  StorageTransactionDraft,
  StorageTransactionTicket,
} from './storageCore';

type Setter<T> = T | ((previous: T) => T);
export type StoredStateSetter<T> = (next: Setter<T>) => StorageTransactionTicket<T>;

const subscribeToStorageStatus = (listener: () => void) => store.subscribeStatus(listener);
const getStorageStatusSnapshot = () => store.getStatus();

/**
 * Persisted, cross-instance-synced state.
 *
 * Functional updaters execute before the setter returns. The returned ticket
 * exposes durability; React subscribers publish the new value only after its
 * journal transaction commits. Existing callers may safely ignore the ticket.
 */
export function useStoredState<T>(key: string, initial: T) {
  const initialRef = useRef(initial);
  const keyRef = useRef(key);
  if (keyRef.current !== key) {
    keyRef.current = key;
    initialRef.current = initial;
  }

  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(key, listener),
    [key],
  );
  const getSnapshot = useCallback(
    () => store.read(key, initialRef.current),
    [key],
  );
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setValue: StoredStateSetter<T> = useCallback(
    (next) => store.update(key, initialRef.current, next),
    [key],
  );

  // Hydration remains synchronous. Persistence readiness/error information is
  // separately available through useStoragePersistenceStatus().
  return [value, setValue, true] as const;
}

export function clearStoredKeys(
  predicate: (key: string) => boolean,
): StorageMaintenanceTicket<number> {
  return store.clearMatching(predicate);
}

/**
 * Ambient batch for existing hooks: setters invoked synchronously inside work
 * join one draft and one journal transaction. Nested batches join the outermost
 * batch and share its completion Promise.
 */
export function runStoredTransaction<T>(
  work: (draft: StorageTransactionDraft) => T,
): StorageTransactionTicket<T> {
  return store.transaction(work);
}

export function getStoragePersistenceStatus(): StorageCoreStatus {
  return store.getStatus();
}

export function useStoragePersistenceStatus(): StorageCoreStatus {
  return useSyncExternalStore(
    subscribeToStorageStatus,
    getStorageStatusSnapshot,
    getStorageStatusSnapshot,
  );
}

/** Test-only: clear volatile state without touching durable browser storage. */
export function _resetStoredCache(): void {
  store.reset();
}

/** Test-only: initialize the singleton coordinator for hook tests that bypass main.tsx. */
export async function _recoverStoredStateForTests(): Promise<void> {
  const recovery = await browserStorageCoordinator.recover();
  if (!recovery.ok) throw new Error(recovery.error.message);
}

/** Test-only: wait until every queued durable write has settled. */
export async function waitForStorageIdle(): Promise<StorageCoreStatus> {
  return store.flush();
}
