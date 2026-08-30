import {
  MAX_TRANSACTION_OPERATIONS,
  STORAGE_TRANSACTION_JOURNAL_KEY,
  type StorageMutation,
  type StorageTransactionCoordinator,
} from '@grimcomp/core';
import type { NativeRawAsyncKeyValue } from './asyncStorageBackend';
import {
  NATIVE_RECOVERY_RESET_INTENT_KEY,
  NATIVE_RECOVERY_RESET_WITNESS_KEY,
} from './nativeRecoveryKeys';

export const NATIVE_STORAGE_VERSION_KEY = 'gc.storageVersion' as const;
export const NATIVE_STORAGE_VERSION = 1 as const;

export interface NativeStorageMigrationContext {
  /** Raw reads are intentional: migrations must preserve exact before-images. */
  getItem(key: string): Promise<string | null>;
  getAllKeys(): Promise<readonly string[]>;
}

export type NativeStorageMigration = (
  context: NativeStorageMigrationContext,
) => Promise<readonly StorageMutation[]>;

export type NativeStorageMigrationTable = Readonly<Record<number, NativeStorageMigration>>;

/**
 * Keyed by the version being migrated FROM. Version 1 is the pre-migration
 * native format, so the first breaking format change will add entry `1` and
 * bump NATIVE_STORAGE_VERSION to 2.
 */
export const NATIVE_STORAGE_MIGRATIONS: NativeStorageMigrationTable = {};

export type NativeMigrationResult =
  | { readonly ok: true; readonly version: number }
  | { readonly ok: false; readonly message: string };

function describeError(value: unknown): string {
  let text = 'Unknown failure';
  try { text = value instanceof Error ? value.message : String(value); }
  catch { /* hostile thrown values can fail inspection */ }
  try { return text.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 300); }
  catch { return 'Unknown failure'; }
}

function decodeVersion(raw: string): number | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Number.isSafeInteger(parsed)
      && (parsed as number) >= 1
      && raw === JSON.stringify(parsed)
      ? parsed as number
      : null;
  } catch {
    return null;
  }
}

async function detectStartingVersion(
  backend: NativeRawAsyncKeyValue,
  currentVersion: number,
): Promise<{ readonly ok: true; readonly version: number; readonly raw: string | null } | NativeMigrationResult> {
  let raw: string | null;
  try {
    raw = await backend.getItem(NATIVE_STORAGE_VERSION_KEY);
  } catch (error) {
    return { ok: false, message: `Could not read the native storage version: ${describeError(error)}` };
  }

  if (raw != null) {
    const version = decodeVersion(raw);
    if (version == null) {
      return { ok: false, message: 'The native storage version marker is malformed. No data was changed.' };
    }
    return { ok: true, version, raw };
  }

  try {
    const keys = await backend.getAllKeys();
    const hasExistingData = keys.some((key) => (
      key.startsWith('gc.') &&
      key !== NATIVE_STORAGE_VERSION_KEY &&
      key !== STORAGE_TRANSACTION_JOURNAL_KEY
    ));
    return { ok: true, version: hasExistingData ? 1 : currentVersion, raw: null };
  } catch (error) {
    return { ok: false, message: `Could not inspect native storage before migration: ${describeError(error)}` };
  }
}

/**
 * Runs after crash recovery and before any gc.* state hook mounts. Every
 * migration and its version stamp share one recoverable transaction; a failed
 * transform therefore never advances the marker.
 */
export async function runNativeStorageMigrations(
  backend: NativeRawAsyncKeyValue,
  coordinator: StorageTransactionCoordinator,
  options: {
    readonly currentVersion?: number;
    readonly migrations?: NativeStorageMigrationTable;
  } = {},
): Promise<NativeMigrationResult> {
  const currentVersion = options.currentVersion ?? NATIVE_STORAGE_VERSION;
  const migrations = options.migrations ?? NATIVE_STORAGE_MIGRATIONS;
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 1) {
    return { ok: false, message: 'The application storage version is invalid.' };
  }

  const detected = await detectStartingVersion(backend, currentVersion);
  if (!detected.ok || !('raw' in detected)) return detected;
  if (detected.version > currentVersion) {
    return {
      ok: false,
      message: `Saved data uses newer storage version ${detected.version}; this build supports ${currentVersion}. No data was changed.`,
    };
  }

  let version = detected.version;
  let versionRaw = detected.raw;
  while (version < currentVersion) {
    let migration: NativeStorageMigration | undefined;
    try { migration = migrations[version]; }
    catch (error) {
      return { ok: false, message: `Could not inspect storage migration ${version}: ${describeError(error)}` };
    }
    if (!migration) {
      return { ok: false, message: `Required storage migration ${version}→${version + 1} is missing.` };
    }

    let output: unknown;
    try {
      output = await migration({
        getItem: (key) => backend.getItem(key),
        getAllKeys: () => backend.getAllKeys(),
      });
    } catch (error) {
      return { ok: false, message: `Storage migration ${version}→${version + 1} failed: ${describeError(error)}` };
    }

    let isOperationArray = false;
    try { isOperationArray = Array.isArray(output); }
    catch (error) {
      return { ok: false, message: `Storage migration ${version}→${version + 1} returned unreadable operations: ${describeError(error)}` };
    }
    if (!isOperationArray) {
      return { ok: false, message: `Storage migration ${version}→${version + 1} returned a non-array operation list.` };
    }
    const operationArray = output as unknown[];
    let mutations: StorageMutation[];
    try {
      mutations = [];
      if (operationArray.length >= MAX_TRANSACTION_OPERATIONS) {
        return {
          ok: false,
          message: `Storage migration ${version}→${version + 1} returned too many operations to include its version stamp.`,
        };
      }
      for (let index = 0; index < operationArray.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(operationArray, index)) {
          return { ok: false, message: `Storage migration ${version}→${version + 1} returned a sparse operation list.` };
        }
        mutations.push(operationArray[index] as StorageMutation);
      }
      const reservedMutation = mutations.find((mutation) => (
        mutation?.key === NATIVE_STORAGE_VERSION_KEY
        || mutation?.key === NATIVE_RECOVERY_RESET_INTENT_KEY
        || mutation?.key === NATIVE_RECOVERY_RESET_WITNESS_KEY
      ));
      if (reservedMutation) {
        return {
          ok: false,
          message: `Storage migration ${version}→${version + 1} tried to write reserved internal key ${JSON.stringify(reservedMutation.key)}.`,
        };
      }
    } catch (error) {
      return { ok: false, message: `Storage migration ${version}→${version + 1} returned unreadable operations: ${describeError(error)}` };
    }

    const nextVersionRaw = JSON.stringify(version + 1);
    let result;
    try {
      result = await coordinator.transact([
        ...mutations,
        { key: NATIVE_STORAGE_VERSION_KEY, value: nextVersionRaw, expected: versionRaw },
      ]);
    } catch (error) {
      return { ok: false, message: `Storage migration ${version}→${version + 1} persistence failed: ${describeError(error)}` };
    }
    if (!result.ok) {
      return { ok: false, message: `Storage migration ${version}→${version + 1} was not committed: ${result.error.message}` };
    }
    version += 1;
    versionRaw = nextVersionRaw;
  }

  // Fresh and legacy-v1 stores need an explicit stamp even when no shape
  // migration is required. This is still journalled and verified.
  if (versionRaw == null) {
    let result;
    try {
      result = await coordinator.transact([{
        key: NATIVE_STORAGE_VERSION_KEY,
        value: JSON.stringify(currentVersion),
        expected: null,
      }]);
    } catch (error) {
      return { ok: false, message: `Could not stamp the native storage version: ${describeError(error)}` };
    }
    if (!result.ok) {
      return { ok: false, message: `Could not stamp the native storage version: ${result.error.message}` };
    }
  }

  return { ok: true, version: currentVersion };
}
