import {
  STORAGE_TRANSACTION_JOURNAL_KEY,
  STORAGE_TRANSACTION_JOURNAL_KIND,
  STORAGE_TRANSACTION_JOURNAL_VERSION,
  type StorageJournalOperationV1,
  type StorageMutation,
  type StorageTransactionJournalV1,
} from './types';

export const MAX_STORAGE_KEY_LENGTH = 512;
export const MAX_TRANSACTION_ID_LENGTH = 128;
export const MAX_TRANSACTION_OPERATIONS = 1_000;
export const MAX_JOURNAL_RAW_LENGTH = 4 * 1024 * 1024;
const LONGEST_CHARACTER_STORAGE_SUFFIX = '.magic.spellbook';
export const MAX_STORAGE_KEY_SEGMENT_LENGTH = (
  MAX_STORAGE_KEY_LENGTH - 'gc.'.length - LONGEST_CHARACTER_STORAGE_SUFFIX.length
);

export type JournalDecodeResult =
  | { readonly ok: true; readonly journal: StorageTransactionJournalV1 }
  | { readonly ok: false; readonly message: string };

export interface ValidatedStorageMutation {
  readonly key: string;
  readonly value: string | null;
  readonly hasExpected: boolean;
  readonly expected: string | null;
}

export type StorageMutationSnapshotResult =
  | { readonly ok: true; readonly mutations: readonly ValidatedStorageMutation[] }
  | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

const UNSAFE_RECORD_SEGMENTS = new Set([
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  '__proto__',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'prototype',
  'toLocaleString',
  'toString',
  'valueOf',
]);

export function isValidStorageKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.startsWith('gc.') &&
    key.length > 0 &&
    key.length <= MAX_STORAGE_KEY_LENGTH &&
    key.trim() === key &&
    key !== STORAGE_TRANSACTION_JOURNAL_KEY &&
    !/[\u0000-\u001f\u007f]/u.test(key)
  );
}

/** A single dot-delimited namespace component used inside persisted keys. */
export function isValidStorageKeySegment(value: unknown): value is string {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_STORAGE_KEY_SEGMENT_LENGTH
    && value.trim() === value
    && !value.includes('.')
    && !UNSAFE_RECORD_SEGMENTS.has(value)
    && isValidStorageKey(`gc.${value}${LONGEST_CHARACTER_STORAGE_SUFFIX}`)
  );
}

export function isValidTransactionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TRANSACTION_ID_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  );
}

/** Snapshots own enumerable data properties once, so getters/proxies cannot win a validate/use race. */
export function snapshotStorageMutations(
  mutations: unknown,
  options: { readonly allowEmpty?: boolean } = {},
): StorageMutationSnapshotResult {
  try {
    if (!Array.isArray(mutations)) {
      return { ok: false, message: 'A transaction must be an array of operations.' };
    }
    const arrayKeys = Reflect.ownKeys(mutations);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(mutations, 'length');
    const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : -1;
    if (!Number.isSafeInteger(length) || length < 0 || (!options.allowEmpty && length < 1)) {
      return { ok: false, message: 'A transaction must contain at least one operation.' };
    }
    if (length > MAX_TRANSACTION_OPERATIONS) {
      return { ok: false, message: `A transaction may contain at most ${MAX_TRANSACTION_OPERATIONS} operations.` };
    }
    if (
      arrayKeys.length !== length + 1 ||
      arrayKeys.some((key) => typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9]\d*)$/u.test(key)))
    ) {
      return { ok: false, message: 'The transaction operation array is sparse or decorated.' };
    }

    const seenKeys = new Set<string>();
    const snapshots: ValidatedStorageMutation[] = [];
    for (let index = 0; index < length; index += 1) {
      const arrayDescriptor = Object.getOwnPropertyDescriptor(mutations, String(index));
      if (!arrayDescriptor?.enumerable || !('value' in arrayDescriptor)) {
        return { ok: false, message: `Operation ${index} is not an own enumerable data value.` };
      }
      const mutation: unknown = arrayDescriptor.value;
      if (!isRecord(mutation)) {
        return { ok: false, message: `Operation ${index} must be an object.` };
      }

      const ownKeys = Reflect.ownKeys(mutation);
      const hasExpected = ownKeys.includes('expected');
      const expectedNames = hasExpected ? ['key', 'value', 'expected'] : ['key', 'value'];
      if (
        ownKeys.length !== expectedNames.length ||
        ownKeys.some((key) => typeof key !== 'string' || !expectedNames.includes(key))
      ) {
        return { ok: false, message: `Operation ${index} must contain key, value, and optionally expected.` };
      }

      const captured: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const name of expectedNames) {
        const descriptor = Object.getOwnPropertyDescriptor(mutation, name);
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          return { ok: false, message: `Operation ${index}.${name} must be an own enumerable data property.` };
        }
        captured[name] = descriptor.value;
      }

      const key = captured.key;
      const value = captured.value;
      const expected = hasExpected ? captured.expected : null;
      if (!isValidStorageKey(key)) {
        return { ok: false, message: `Operation ${index} has an invalid or reserved key.` };
      }
      if (typeof value !== 'string' && value !== null) {
        return { ok: false, message: `Operation ${index} value must be a raw string or null.` };
      }
      if (hasExpected && typeof expected !== 'string' && expected !== null) {
        return { ok: false, message: `Operation ${index} expected value must be a raw string or null.` };
      }
      if (seenKeys.has(key)) {
        return { ok: false, message: `Operation key ${JSON.stringify(key)} is duplicated.` };
      }
      seenKeys.add(key);
      snapshots.push({ key, value, hasExpected, expected: expected as string | null });
    }
    return { ok: true, mutations: snapshots };
  } catch {
    return { ok: false, message: 'The transaction operations could not be inspected safely.' };
  }
}

export function validateStorageMutations(
  mutations: readonly StorageMutation[],
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  const snapshot = snapshotStorageMutations(mutations);
  return snapshot.ok ? { ok: true } : snapshot;
}

export function serializeStorageJournal(journal: StorageTransactionJournalV1): string {
  return JSON.stringify(journal);
}

export function decodeStorageJournal(raw: string): JournalDecodeResult {
  if (raw.length === 0 || raw.length > MAX_JOURNAL_RAW_LENGTH) {
    return { ok: false, message: 'The storage transaction journal has an invalid size.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, message: 'The storage transaction journal is not valid JSON.' };
  }

  if (!isRecord(parsed) || !hasExactKeys(parsed, ['kind', 'version', 'transactionId', 'operations'])) {
    return { ok: false, message: 'The storage transaction journal has an invalid shape.' };
  }
  if (parsed.kind !== STORAGE_TRANSACTION_JOURNAL_KIND || parsed.version !== STORAGE_TRANSACTION_JOURNAL_VERSION) {
    return { ok: false, message: 'The storage transaction journal kind or version is unsupported.' };
  }
  if (!isValidTransactionId(parsed.transactionId)) {
    return { ok: false, message: 'The storage transaction journal has an invalid transaction id.' };
  }
  if (!Array.isArray(parsed.operations) || parsed.operations.length === 0 || parsed.operations.length > MAX_TRANSACTION_OPERATIONS) {
    return { ok: false, message: 'The storage transaction journal has an invalid operation count.' };
  }

  const keys = new Set<string>();
  const operations: StorageJournalOperationV1[] = [];
  for (let index = 0; index < parsed.operations.length; index += 1) {
    const operation: unknown = parsed.operations[index];
    if (!isRecord(operation) || !hasExactKeys(operation, ['key', 'before', 'after'])) {
      return { ok: false, message: `Journal operation ${index} has an invalid shape.` };
    }
    if (!isValidStorageKey(operation.key)) {
      return { ok: false, message: `Journal operation ${index} has an invalid or reserved key.` };
    }
    if (
      (typeof operation.before !== 'string' && operation.before !== null) ||
      (typeof operation.after !== 'string' && operation.after !== null)
    ) {
      return { ok: false, message: `Journal operation ${index} contains a non-raw value.` };
    }
    if (keys.has(operation.key)) {
      return { ok: false, message: `Journal operation key ${JSON.stringify(operation.key)} is duplicated.` };
    }
    keys.add(operation.key);
    operations.push({ key: operation.key, before: operation.before, after: operation.after });
  }

  return {
    ok: true,
    journal: {
      kind: STORAGE_TRANSACTION_JOURNAL_KIND,
      version: STORAGE_TRANSACTION_JOURNAL_VERSION,
      transactionId: parsed.transactionId,
      operations,
    },
  };
}
