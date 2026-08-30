import {
  STORAGE_TRANSACTION_JOURNAL_KEY,
  type StorageMutation,
  type StorageTransactionCoordinator,
  validateStorageMutations,
} from '@grimcomp/core';
import { browserStorageBackend, browserStorageCoordinator } from './browserStorage';
import {
  STORAGE_RECOVERY_RESET_INTENT_KEY,
  STORAGE_VERSION,
  STORAGE_VERSION_KEY,
} from './storageSchema';
import type { StorageBackend } from '@/hooks/storageCore';

export { STORAGE_VERSION, STORAGE_VERSION_KEY } from './storageSchema';

export interface StorageMigrationContext {
  readonly readRaw: (key: string) => string | null;
}

export type StorageMigration = (
  context: StorageMigrationContext,
) => readonly StorageMutation[];

export interface StorageVersionState {
  readonly version: number;
  readonly raw: string | null;
  readonly unstamped: boolean;
}

export interface StorageMigrationError {
  readonly code:
    | 'read_failed'
    | 'enumerate_failed'
    | 'corrupt_version'
    | 'future_version'
    | 'missing_migration'
    | 'migration_failed'
    | 'invalid_migration'
    | 'transaction_failed';
  readonly message: string;
  readonly fromVersion?: number;
  readonly cause?: string;
}

export type StorageVersionResult =
  | { readonly ok: true; readonly state: StorageVersionState }
  | { readonly ok: false; readonly error: StorageMigrationError };

export type StorageMigrationResult =
  | {
      readonly ok: true;
      readonly outcome: 'current' | 'stamped' | 'migrated';
      readonly fromVersion: number;
      readonly toVersion: number;
    }
  | {
      readonly ok: false;
      readonly outcome: 'blocked';
      readonly fromVersion: number | null;
      readonly toVersion: number;
      readonly error: StorageMigrationError;
    };

export interface StorageMigrationPlan {
  readonly targetVersion: number;
  readonly migrations: Readonly<Record<number, StorageMigration>>;
  readonly backend: Pick<StorageBackend, 'getItem' | 'keys'>;
  readonly coordinator: StorageTransactionCoordinator;
}

const STORAGE_MIGRATIONS: Readonly<Record<number, StorageMigration>> = {};

function boundedCause(error: unknown): string {
  try {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return text.slice(0, 500);
  } catch {
    return 'Unprintable thrown value';
  }
}

function failedVersion(error: StorageMigrationError): StorageVersionResult {
  return { ok: false, error };
}

/** Strictly decode the on-disk version; malformed/future data is never guessed. */
export function readStorageVersion(
  backend: Pick<StorageBackend, 'getItem' | 'keys'> = browserStorageBackend,
  targetVersion = STORAGE_VERSION,
): StorageVersionResult {
  let raw: string | null;
  try {
    raw = backend.getItem(STORAGE_VERSION_KEY);
  } catch (error) {
    return failedVersion({
      code: 'read_failed',
      message: 'Unable to read the storage schema version.',
      cause: boundedCause(error),
    });
  }

  if (raw === null) {
    let hasExistingData: boolean;
    try {
      hasExistingData = backend.keys().some((key) => (
        key.startsWith('gc.')
        && key !== STORAGE_VERSION_KEY
        && key !== STORAGE_TRANSACTION_JOURNAL_KEY
        && key !== STORAGE_RECOVERY_RESET_INTENT_KEY
      ));
    } catch (error) {
      return failedVersion({
        code: 'enumerate_failed',
        message: 'Unable to inspect existing storage before migration.',
        cause: boundedCause(error),
      });
    }
    return {
      ok: true,
      state: {
        version: hasExistingData ? 1 : targetVersion,
        raw: null,
        unstamped: true,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return failedVersion({
      code: 'corrupt_version',
      message: 'The storage schema version is not valid JSON.',
      cause: boundedCause(error),
    });
  }
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 1) {
    return failedVersion({
      code: 'corrupt_version',
      message: 'The storage schema version must be a positive safe integer.',
    });
  }
  if (parsed > targetVersion) {
    return failedVersion({
      code: 'future_version',
      message: `Storage version ${parsed} is newer than supported version ${targetVersion}.`,
      fromVersion: parsed,
    });
  }
  return {
    ok: true,
    state: {
      version: parsed,
      raw,
      // Equivalent-but-noncanonical JSON (for example "1.0") is normalized
      // through the same journaled CAS path before the app can render.
      unstamped: raw !== JSON.stringify(parsed),
    },
  };
}

function validateMigrationMutations(
  mutations: unknown,
  fromVersion: number,
): StorageMigrationError | null {
  if (!Array.isArray(mutations)) {
    return {
      code: 'invalid_migration',
      message: `Migration ${fromVersion} did not return an operation array.`,
      fromVersion,
    };
  }
  try {
    // Add the runner-owned stamp while validating: this both permits an empty
    // transform and rejects malformed/duplicate/stamp-writing operations.
    const validation = validateStorageMutations([
      ...(mutations as readonly StorageMutation[]),
      { key: STORAGE_VERSION_KEY, value: JSON.stringify(fromVersion + 1) },
    ]);
    if (!validation.ok) {
      return {
        code: 'invalid_migration',
        message: `Migration ${fromVersion} returned invalid operations: ${validation.message}`,
        fromVersion,
      };
    }
  } catch (error) {
    return {
      code: 'invalid_migration',
      message: `Migration ${fromVersion} returned operations that could not be inspected. ${boundedCause(error)}`,
      fromVersion,
    };
  }
  return null;
}

/** Apply a strict, stepwise plan. Each transform and its stamp commit atomically. */
export async function runStorageMigrationPlan(
  plan: StorageMigrationPlan,
): Promise<StorageMigrationResult> {
  if (!Number.isSafeInteger(plan.targetVersion) || plan.targetVersion < 1) {
    return {
      ok: false,
      outcome: 'blocked',
      fromVersion: null,
      toVersion: plan.targetVersion,
      error: {
        code: 'invalid_migration',
        message: 'The target storage version must be a positive safe integer.',
      },
    };
  }
  const read = readStorageVersion(plan.backend, plan.targetVersion);
  if (!read.ok) {
    return {
      ok: false,
      outcome: 'blocked',
      fromVersion: read.error.fromVersion ?? null,
      toVersion: plan.targetVersion,
      error: read.error,
    };
  }

  const startedAt = read.state.version;
  let version = startedAt;
  let versionRaw = read.state.raw;
  // Validate the complete path before mutating anything. A packaging mistake
  // cannot leave users stranded halfway through an otherwise avoidable run.
  for (let required = version; required < plan.targetVersion; required += 1) {
    if (!plan.migrations[required]) {
      return {
        ok: false,
        outcome: 'blocked',
        fromVersion: required,
        toVersion: plan.targetVersion,
        error: {
          code: 'missing_migration',
          message: `Required migration ${required}→${required + 1} is missing.`,
          fromVersion: required,
        },
      };
    }
  }
  while (version < plan.targetVersion) {
    const migrate = plan.migrations[version];
    // The complete migration path was checked above.
    if (!migrate) throw new Error('Unreachable missing migration.');

    const readDependencies = new Map<string, string | null>();
    let produced: readonly StorageMutation[];
    try {
      produced = migrate({
        readRaw: (key) => {
          if (readDependencies.has(key)) return readDependencies.get(key) ?? null;
          const raw = plan.backend.getItem(key);
          readDependencies.set(key, raw);
          return raw;
        },
      });
    } catch (error) {
      return {
        ok: false,
        outcome: 'blocked',
        fromVersion: version,
        toVersion: plan.targetVersion,
        error: {
          code: 'migration_failed',
          message: `Migration ${version}→${version + 1} failed before commit.`,
          fromVersion: version,
          cause: boundedCause(error),
        },
      };
    }
    const invalid = validateMigrationMutations(produced, version);
    if (invalid) {
      return {
        ok: false,
        outcome: 'blocked',
        fromVersion: version,
        toVersion: plan.targetVersion,
        error: invalid,
      };
    }

    let mutations: StorageMutation[];
    let dependencyConflict: string | null = null;
    try {
      const outputKeys = new Set<string>();
      mutations = produced.map((mutation) => {
        const { key } = mutation;
        outputKeys.add(key);
        const hasExpected = Object.prototype.hasOwnProperty.call(mutation, 'expected');
        if (readDependencies.has(key)) {
          const expected = readDependencies.get(key) ?? null;
          if (hasExpected && mutation.expected !== expected) dependencyConflict = key;
          return hasExpected ? mutation : { ...mutation, expected };
        }
        return hasExpected ? mutation : { ...mutation, expected: plan.backend.getItem(key) };
      });
      for (const [key, raw] of readDependencies) {
        if (key !== STORAGE_VERSION_KEY && !outputKeys.has(key)) {
          // A transform may derive one key from another. Keep that input stable
          // until the coordinator owns the lock without introducing a duplicate
          // mutation for inputs that are also outputs.
          mutations.push({ key, value: raw, expected: raw });
        }
      }
    } catch (error) {
      return {
        ok: false,
        outcome: 'blocked',
        fromVersion: version,
        toVersion: plan.targetVersion,
        error: {
          code: 'read_failed',
          message: `Migration ${version} could not capture write preconditions.`,
          fromVersion: version,
          cause: boundedCause(error),
        },
      };
    }
    if (dependencyConflict !== null) {
      return {
        ok: false,
        outcome: 'blocked',
        fromVersion: version,
        toVersion: plan.targetVersion,
        error: {
          code: 'invalid_migration',
          message: `Migration ${version} returned a precondition for ${JSON.stringify(dependencyConflict)} that does not match the value read through readRaw.`,
          fromVersion: version,
        },
      };
    }
    const nextRaw = JSON.stringify(version + 1);
    mutations.push({ key: STORAGE_VERSION_KEY, value: nextRaw, expected: versionRaw });
    const expandedValidation = validateStorageMutations(mutations);
    if (!expandedValidation.ok) {
      return {
        ok: false,
        outcome: 'blocked',
        fromVersion: version,
        toVersion: plan.targetVersion,
        error: {
          code: 'invalid_migration',
          message: `Migration ${version} dependencies produced invalid operations: ${expandedValidation.message}`,
          fromVersion: version,
        },
      };
    }

    let transaction;
    try {
      transaction = await plan.coordinator.transact(mutations);
    } catch (error) {
      return {
        ok: false,
        outcome: 'blocked',
        fromVersion: version,
        toVersion: plan.targetVersion,
        error: {
          code: 'transaction_failed',
          message: `Migration ${version}→${version + 1} could not reach the storage coordinator.`,
          fromVersion: version,
          cause: boundedCause(error),
        },
      };
    }
    if (!transaction.ok) {
      return {
        ok: false,
        outcome: 'blocked',
        fromVersion: version,
        toVersion: plan.targetVersion,
        error: {
          code: 'transaction_failed',
          message: transaction.error.message,
          fromVersion: version,
          cause: transaction.error.cause,
        },
      };
    }
    version += 1;
    versionRaw = nextRaw;
  }

  if (read.state.unstamped && startedAt === plan.targetVersion) {
    let transaction;
    try {
      transaction = await plan.coordinator.transact([{
        key: STORAGE_VERSION_KEY,
        value: JSON.stringify(plan.targetVersion),
        expected: read.state.raw,
      }]);
    } catch (error) {
      return {
        ok: false,
        outcome: 'blocked',
        fromVersion: version,
        toVersion: plan.targetVersion,
        error: {
          code: 'transaction_failed',
          message: 'The storage version stamp could not reach the storage coordinator.',
          fromVersion: version,
          cause: boundedCause(error),
        },
      };
    }
    if (!transaction.ok) {
      return {
        ok: false,
        outcome: 'blocked',
        fromVersion: version,
        toVersion: plan.targetVersion,
        error: {
          code: 'transaction_failed',
          message: transaction.error.message,
          fromVersion: version,
          cause: transaction.error.cause,
        },
      };
    }
    return {
      ok: true,
      outcome: startedAt < plan.targetVersion ? 'migrated' : 'stamped',
      fromVersion: startedAt,
      toVersion: plan.targetVersion,
    };
  }

  return {
    ok: true,
    outcome: startedAt < plan.targetVersion ? 'migrated' : 'current',
    fromVersion: startedAt,
    toVersion: plan.targetVersion,
  };
}

export function runStorageMigrations(): Promise<StorageMigrationResult> {
  return runStorageMigrationPlan({
    targetVersion: STORAGE_VERSION,
    migrations: STORAGE_MIGRATIONS,
    backend: browserStorageBackend,
    coordinator: browserStorageCoordinator,
  });
}
