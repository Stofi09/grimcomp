import {
  MAX_TRANSACTION_OPERATIONS,
} from '@grimcomp/core';
import { CHARACTER_TEMPLATES } from '../data/character';
import { nativeStorage } from './runtime';
import type { NativeDurabilityResult } from './nativeStore';
import {
  decodeNativeStoredValueForExport,
  isPortableNativeDataKey,
  validateNativeSettingsImport,
} from './nativeDataValidation';

export { validateNativeSettingsImport } from './nativeDataValidation';

export type ExportScope = 'character' | 'roster';

export interface SettingsImportSummary {
  readonly result: NativeDurabilityResult;
  readonly written: number;
}

const FORBIDDEN_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Assemble and validate a storage-internals-free native export snapshot. */
export function serializeNativeSettingsExportSnapshot(
  scope: ExportScope,
  characterId: string,
  characterName: string,
  snapshot: ReadonlyMap<string, string>,
  exportedAt = new Date().toISOString(),
): string {
  const dump: Record<string, unknown> = {
    $schema: 'grimcomp.v1',
    exportedAt,
    scope,
    character: scope === 'character' ? characterName : undefined,
  };
  for (const [key, raw] of snapshot) {
    const parsed = decodeNativeStoredValueForExport(key, raw);
    if (scope === 'character' && key === 'gc.customChars') {
      if (isRecord(parsed) && Object.prototype.hasOwnProperty.call(parsed, characterId)) {
        dump[key] = { [characterId]: parsed[characterId] };
      }
    } else {
      dump[key] = parsed;
    }
  }
  if (scope === 'character') {
    const lockedActiveId = dump['gc.activeCharId'];
    if (lockedActiveId !== undefined && lockedActiveId !== characterId) {
      throw new Error(
        `The active character changed to ${JSON.stringify(lockedActiveId)} before the export snapshot was read; retry the export.`,
      );
    }
    // A fresh/legacy store may rely on the in-memory fallback and have no
    // persisted pointer. Keep a single-character export self-contained.
    dump['gc.activeCharId'] = characterId;
    const customCharacters = isRecord(dump['gc.customChars']) ? dump['gc.customChars'] : {};
    if (
      !Object.prototype.hasOwnProperty.call(CHARACTER_TEMPLATES, characterId)
      && !Object.prototype.hasOwnProperty.call(customCharacters, characterId)
    ) {
      throw new Error(
        `Character ${JSON.stringify(characterId)} does not exist in the export snapshot; select a valid roster character and retry.`,
      );
    }
  }
  return JSON.stringify(dump, null, 2);
}

/** Reads one FIFO-consistent snapshot before assembling a grimcomp.v1 export. */
export async function buildNativeSettingsExport(
  scope: ExportScope,
  characterId: string,
  characterName: string,
): Promise<string> {
  const snapshot = await nativeStorage.readRawSnapshot((key) => (
    isPortableNativeDataKey(key) && (
      scope === 'roster' ||
      key.startsWith(`gc.${characterId}.`) ||
      key === 'gc.activeCharId' ||
      key === 'gc.customChars'
    )
  ));
  return serializeNativeSettingsExportSnapshot(scope, characterId, characterName, snapshot);
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
  const keys = Object.keys(dump).filter(isPortableNativeDataKey);
  const result = await nativeStorage.runTransaction((transaction) => {
    const incomingCustom = keys.includes('gc.customChars')
      ? safeCharacterMap(dump['gc.customChars'])
      : {};
    const mergedCustom = Object.assign(
      Object.create(null) as Record<string, unknown>,
      safeCharacterMap(transaction.read<Record<string, unknown>>('gc.customChars', {})),
      incomingCustom,
    );
    const activeId = keys.includes('gc.activeCharId') ? dump['gc.activeCharId'] : undefined;
    if (
      typeof activeId === 'string'
      && !Object.prototype.hasOwnProperty.call(CHARACTER_TEMPLATES, activeId)
      && !Object.prototype.hasOwnProperty.call(mergedCustom, activeId)
    ) {
      throw new Error(
        `Imported active character ${JSON.stringify(activeId)} does not exist in the post-import roster.`,
      );
    }
    for (const key of keys) {
      if (key === 'gc.customChars') {
        transaction.setRaw(key, JSON.stringify(mergedCustom));
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
  const keys = nativeStorage.knownKeys(isPortableNativeDataKey);
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

/**
 * Lossless diagnostic-only export for the blocked recovery shell. Values and
 * the journal stay as exact raw strings; this schema is intentionally not
 * accepted by the normal grimcomp.v1 importer.
 */
export async function buildNativeRecoveryDiagnosticExport(): Promise<string> {
  const snapshot = await nativeStorage.readRecoverySnapshot();
  return JSON.stringify({
    $schema: 'grimcomp.storage-diagnostic.v1',
    exportedAt: new Date().toISOString(),
    platform: 'native',
    raw: Object.fromEntries(snapshot),
  }, null, 2);
}

export function resetNativeStorageForRecovery(): Promise<NativeDurabilityResult> {
  return nativeStorage.resetDataForRecovery();
}
