import { createStorageCoordinator } from '@grimcomp/core';
import { createAsyncStorageBackend } from './asyncStorageBackend';
import {
  NativeStorageStore,
  type NativeDurabilityResult,
  type NativeStorageStatus,
  type StoredTransaction,
} from './nativeStore';

const backend = createAsyncStorageBackend();
const coordinator = createStorageCoordinator(backend);

/** One process-wide FIFO store for every native gc.* consumer. */
export const nativeStorage = new NativeStorageStore(backend, coordinator);

export function initializeNativeStorage(): Promise<NativeStorageStatus> {
  return nativeStorage.initialize();
}

/**
 * `work` runs synchronously; the returned promise reports verified durability.
 * This is the batch primitive for logical changes spanning multiple keys.
 */
export function runStoredTransaction(
  work: (transaction: StoredTransaction) => void,
): Promise<NativeDurabilityResult> {
  return nativeStorage.runTransaction(work);
}

export function waitForStoredDurability(): Promise<NativeDurabilityResult> {
  return nativeStorage.flush();
}

export type {
  NativeDurabilityResult,
  NativeStorageStatus,
  NativeStorageError,
  StoredTransaction,
} from './nativeStore';
