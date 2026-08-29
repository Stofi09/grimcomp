import {
  MAX_TRANSACTION_OPERATIONS,
  STORAGE_TRANSACTION_JOURNAL_KEY,
  isValidStorageKey,
} from '@grimcomp/core';
import { nativeStorage } from './runtime';
import type { NativeDurabilityResult } from './nativeStore';
import { NATIVE_STORAGE_VERSION_KEY } from './migrations';

export type ExportScope = 'character' | 'roster';

export interface SettingsImportSummary {
  readonly result: NativeDurabilityResult;
  readonly written: number;
}

const FORBIDDEN_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPortableDataKey(key: string): boolean {
  return (
    key.startsWith('gc.') &&
    key !== STORAGE_TRANSACTION_JOURNAL_KEY &&
    key !== NATIVE_STORAGE_VERSION_KEY &&
    isValidStorageKey(key)
  );
}

/** Reads a FIFO-consistent, storage-internals-free grimcomp.v1 snapshot. */
export async function buildNativeSettingsExport(
  scope: ExportScope,
  characterId: string,
  characterName: string,
): Promise<string> {
  const snapshot = await nativeStorage.readRawSnapshot((key) => (
    isPortableDataKey(key) && (
      scope === 'roster' ||
      key.startsWith(`gc.${characterId}.`) ||
      key === 'gc.activeCharId' ||
      key === 'gc.customChars'
    )
  ));
  const dump: Record<string, unknown> = {
    $schema: 'grimcomp.v1',
    exportedAt: new Date().toISOString(),
    scope,
    character: scope === 'character' ? characterName : undefined,
  };
  for (const [key, raw] of snapshot) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (scope === 'character' && key === 'gc.customChars') {
        if (isRecord(parsed) && Object.prototype.hasOwnProperty.call(parsed, characterId)) {
          dump[key] = { [characterId]: parsed[characterId] };
        }
      } else {
        dump[key] = parsed;
      }
    } catch {
      // Preserve corrupt legacy values for a full diagnostic export, but never
      // expose the entire roster through a single-character export.
      if (scope === 'roster' || key !== 'gc.customChars') dump[key] = raw;
    }
  }
  return JSON.stringify(dump, null, 2);
}

export function validateNativeSettingsImport(raw: unknown):
  | { readonly ok: true; readonly dump: Record<string, unknown>; readonly keyCount: number }
  | { readonly ok: false; readonly message: string } {
  if (!isRecord(raw) || raw.$schema !== 'grimcomp.v1') {
    return { ok: false, message: 'Expected a grimcomp.v1 export object.' };
  }
  const keys = Object.keys(raw).filter((key) => key.startsWith('gc.'));
  if (keys.length === 0) return { ok: false, message: 'The export contains no Grim Companion data keys.' };
  if (keys.length > MAX_TRANSACTION_OPERATIONS) {
    return { ok: false, message: `The export contains more than ${MAX_TRANSACTION_OPERATIONS} data keys.` };
  }
  for (const key of keys) {
    if (!isPortableDataKey(key)) {
      return { ok: false, message: `The export contains an invalid or internal storage key: ${JSON.stringify(key)}.` };
    }
    try {
      if (JSON.stringify(raw[key]) === undefined) {
        return { ok: false, message: `The value for ${key} is not JSON-serializable.` };
      }
    } catch {
      return { ok: false, message: `The value for ${key} is not JSON-serializable.` };
    }
    if (key === 'gc.customChars') {
      const customCharacters = raw[key];
      if (!isRecord(customCharacters)) return { ok: false, message: 'gc.customChars must be a character map.' };
      if (Object.keys(customCharacters).some((id) => FORBIDDEN_RECORD_KEYS.has(id))) {
        return { ok: false, message: 'gc.customChars contains a forbidden character id.' };
      }
    }
  }
  return { ok: true, dump: raw, keyCount: keys.length };
}

function safeCharacterMap(value: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (!isRecord(value)) return result;
  for (const key of Object.keys(value)) {
    if (!FORBIDDEN_RECORD_KEYS.has(key)) result[key] = value[key];
  }
  return result;
}

/** Applies every imported key under one crash-recoverable transaction. */
export async function applyNativeSettingsImport(
  dump: Record<string, unknown>,
): Promise<SettingsImportSummary> {
  const validated = validateNativeSettingsImport(dump);
  if (!validated.ok) {
    return {
      written: 0,
      result: {
        ok: false,
        outcome: 'rejected',
        transactionId: null,
        error: { code: 'transaction_failed', message: validated.message },
      },
    };
  }
  const pending = await nativeStorage.flush();
  const status = nativeStorage.getStatus();
  if (!pending.ok || status.blocked || status.dirty) {
    return {
      result: pending.ok ? {
        ok: false,
        outcome: 'blocked',
        transactionId: null,
        error: { code: 'not_ready', message: 'Native storage is not clean enough to import safely.' },
      } : pending,
      written: 0,
    };
  }
  const keys = Object.keys(dump).filter(isPortableDataKey);
  const result = await nativeStorage.runTransaction((transaction) => {
    for (const key of keys) {
      if (key === 'gc.customChars') {
        transaction.update<Record<string, unknown>>(key, {}, (existing) => ({
          ...safeCharacterMap(existing),
          ...safeCharacterMap(dump[key]),
        }));
      } else {
        const serialized = JSON.stringify(dump[key]);
        if (serialized === undefined) throw new Error(`${key} is not JSON-serializable.`);
        transaction.setRaw(key, serialized);
      }
    }
  });
  return { result, written: result.ok ? keys.length : 0 };
}

/** Clears user data while retaining the validated version marker and journal protocol. */
export async function resetNativeStorageData(): Promise<SettingsImportSummary> {
  // knownKeys is complete after the startup preload and has no await gap:
  // the removal transaction is enqueued before a later UI write can interleave.
  const keys = nativeStorage.knownKeys(isPortableDataKey);
  if (keys.length > MAX_TRANSACTION_OPERATIONS) {
    return {
      written: 0,
      result: {
        ok: false,
        outcome: 'rejected',
        transactionId: null,
        error: {
          code: 'transaction_failed',
          message: `Reset found more than ${MAX_TRANSACTION_OPERATIONS} data keys and was stopped safely.`,
        },
      },
    };
  }
  const result = await nativeStorage.runTransaction((transaction) => {
    for (const key of keys) transaction.remove(key);
  });
  return { result, written: result.ok ? keys.length : 0 };
}
