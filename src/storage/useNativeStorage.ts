import { useCallback, useEffect, useState } from 'react';
import { initializeNativeStorage, nativeStorage } from './runtime';
import type { NativeStorageStatus } from './nativeStore';

/** Starts the recovery/migration gate and observes its explicit outcome. */
export function useNativeStorageGate(): NativeStorageStatus {
  const [status, setStatus] = useState(() => nativeStorage.getStatus());
  useEffect(() => {
    const unsubscribe = nativeStorage.subscribeStatus(setStatus);
    void initializeNativeStorage().then(setStatus);
    return unsubscribe;
  }, []);
  return status;
}

/** Observable pending/dirty/error state for Settings and durability UI. */
export function useNativeStorageStatus(): NativeStorageStatus {
  const [status, setStatus] = useState(() => nativeStorage.getStatus());
  useEffect(() => nativeStorage.subscribeStatus(setStatus), []);
  return status;
}

export function useWaitForStoredDurability() {
  return useCallback(() => nativeStorage.flush(), []);
}

export function useRetryNativeStorage() {
  return useCallback(() => nativeStorage.retryInitialization(), []);
}
