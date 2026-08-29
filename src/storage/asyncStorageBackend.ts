import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RawAsyncKeyValue } from '@grimcomp/core';

/**
 * The native adapter deliberately exposes only single-key operations to the
 * shared storage kernel. AsyncStorage's multi* methods are batching helpers;
 * they are not an atomic transaction boundary on every React Native backend.
 */
export interface NativeRawAsyncKeyValue extends RawAsyncKeyValue {
  getAllKeys(): Promise<readonly string[]>;
}

export function createAsyncStorageBackend(): NativeRawAsyncKeyValue {
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
    getAllKeys: () => AsyncStorage.getAllKeys(),
  };
}
