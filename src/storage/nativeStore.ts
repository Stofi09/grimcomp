import {
  isValidStorageKey,
  MAX_TRANSACTION_OPERATIONS,
  STORAGE_TRANSACTION_JOURNAL_KEY,
  type StorageKernelError,
  type StorageTransactionCoordinator,
  type StorageTransactionResult,
} from '@grimcomp/core';
import type { NativeRawAsyncKeyValue } from './asyncStorageBackend';
import { CHARACTER_TEMPLATES } from '../data/character';
import {
  NATIVE_STORAGE_VERSION,
  NATIVE_STORAGE_VERSION_KEY,
  runNativeStorageMigrations,
  type NativeStorageMigrationTable,
} from './migrations';
import {
  NATIVE_RECOVERY_RESET_INTENT_KEY,
  NATIVE_RECOVERY_RESET_INTENT_RAW,
  NATIVE_RECOVERY_RESET_WITNESS_KEY,
  NATIVE_RECOVERY_RESET_WITNESS_RAW,
} from './nativeRecoveryKeys';
import { validateNativeStoredValue } from './nativeDataValidation';

export {
  NATIVE_RECOVERY_RESET_INTENT_KEY,
  NATIVE_RECOVERY_RESET_WITNESS_KEY,
} from './nativeRecoveryKeys';

type Setter<T> = T | ((previous: T) => T);

interface CacheEntry {
  readonly raw: string | null;
  readonly parsed: unknown;
  readonly validJson: boolean;
  readonly revision: number;
}

interface DraftEntry {
  readonly beforeRaw: string | null;
  afterRaw: string | null;
  parsed: unknown;
  validJson: boolean;
}

interface ActiveBatch {
  readonly transaction: StoredTransaction;
  readonly promise: Promise<NativeDurabilityResult>;
  fail(result: NativeDurabilityResult): void;
  holdUntil(value: PromiseLike<unknown>): void;
}

type RecoveryResetProtocolResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface StoredTransaction {
  read<T>(key: string, seed: T): T;
  update<T>(key: string, seed: T, next: Setter<T>): T;
  setRaw(key: string, raw: string): void;
  remove(key: string): void;
}

export type NativeDurabilityResult =
  | StorageTransactionResult
  | { readonly ok: true; readonly outcome: 'unchanged'; readonly transactionId: null }
  | {
      readonly ok: false;
      readonly outcome: 'rejected' | 'blocked';
      readonly transactionId: null;
      readonly error: NativeStorageError;
    };

export interface NativeStorageError {
  readonly code: 'not_ready' | 'invalid_key' | 'serialization_failed' | 'invalid_data' | 'transaction_failed' | 'initialization_failed';
  readonly message: string;
  readonly key?: string;
}

export interface NativeStorageStatus {
  readonly phase: 'booting' | 'ready' | 'blocked';
  readonly ready: boolean;
  readonly pending: number;
  readonly dirty: boolean;
  readonly blocked: boolean;
  readonly initialized: boolean;
  readonly transactionId: string | null;
  readonly lastError: StorageKernelError | NativeStorageError | null;
}

export type NativeStorageStatusListener = (status: NativeStorageStatus) => void;

const UNCHANGED: NativeDurabilityResult = {
  ok: true,
  outcome: 'unchanged',
  transactionId: null,
};

const RECOVERY_RESET_COMMITTED: NativeDurabilityResult = {
  ok: true,
  outcome: 'committed',
  transactionId: 'native-recovery-reset-v1',
};

function boundedMessage(value: unknown): string {
  let message = 'Unknown failure';
  try { message = value instanceof Error ? value.message : String(value); }
  catch { /* hostile thrown values can fail inspection */ }
  try { return message.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 300); }
  catch { return 'Unknown failure'; }
}

function nativeFailure(
  code: NativeStorageError['code'],
  message: string,
  outcome: 'rejected' | 'blocked' = 'rejected',
  key?: string,
): NativeDurabilityResult {
  return {
    ok: false,
    outcome,
    transactionId: null,
    error: { code, message, ...(key ? { key } : {}) },
  };
}

function decodeRaw(raw: string | null): Pick<CacheEntry, 'parsed' | 'validJson'> {
  if (raw == null) return { parsed: undefined, validJson: true };
  try {
    return { parsed: JSON.parse(raw) as unknown, validJson: true };
  } catch {
    return { parsed: undefined, validJson: false };
  }
}

function cloneJsonValue<T>(value: T): T {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value;
  const raw = JSON.stringify(value);
  if (raw === undefined) throw new Error('Value cannot be represented as JSON.');
  return JSON.parse(raw) as T;
}

function isNativeInternalKey(key: string): boolean {
  return (
    key === STORAGE_TRANSACTION_JOURNAL_KEY
    || key === NATIVE_STORAGE_VERSION_KEY
    || key === NATIVE_RECOVERY_RESET_INTENT_KEY
    || key === NATIVE_RECOVERY_RESET_WITNESS_KEY
  );
}

function isNativeDataKey(key: string): boolean {
  return (
    key.startsWith('gc.') &&
    isValidStorageKey(key) &&
    !isNativeInternalKey(key)
  );
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  try { return typeof (value as { then?: unknown }).then === 'function'; }
  catch { return true; }
}

function observeThenableSettlement(
  value: PromiseLike<unknown>,
  onSettled: () => void,
): void {
  try {
    // An async callback has already started when its return value becomes
    // visible. Consume any eventual rejection after rejecting the batch so it
    // cannot surface as an unhandled process error.
    void Promise.resolve(value).then(
      onSettled,
      onSettled,
    );
  } catch {
    // Hostile thenables must remain contained by the synchronous boundary.
    onSettled();
  }
}

/**
 * Framework-free native state cache. The coordinator owns crash recovery and
 * durable FIFO ordering; this layer owns synchronous functional updates and
 * React-friendly per-key notifications.
 */
export class NativeStorageStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly keyListeners = new Map<string, Set<() => void>>();
  private readonly statusListeners = new Set<NativeStorageStatusListener>();
  private bootPhase: NativeStorageStatus['phase'] = 'booting';
  private bootError: NativeStorageError | null = null;
  private localError: NativeStorageError | null = null;
  private localPending = 0;
  private maintenancePending = 0;
  private recoveryResetPending = false;
  private callbackBarrierPending = 0;
  private localDirty = false;
  private namespaceHydrated = false;
  private activeBatch: ActiveBatch | null = null;
  private initializePromise: Promise<NativeStorageStatus> | null = null;
  private durabilityTail: Promise<NativeDurabilityResult> = Promise.resolve(UNCHANGED);
  private readonly durabilityTasks = new Set<Promise<NativeDurabilityResult>>();
  private ioTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly backend: NativeRawAsyncKeyValue,
    private readonly coordinator: StorageTransactionCoordinator,
    private readonly migrationOptions: {
      readonly currentVersion?: number;
      readonly migrations?: NativeStorageMigrationTable;
    } = {},
  ) {
    coordinator.subscribe(() => this.emitStatus());
  }

  initialize(): Promise<NativeStorageStatus> {
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = this.initializeOnce();
    return this.initializePromise;
  }

  /** Retry recovery from authoritative storage after a settled blocked state. */
  retryInitialization(): Promise<NativeStorageStatus> {
    const kernel = this.coordinator.getStatus();
    if (
      this.localPending > 0
      || this.maintenancePending > 0
      || this.callbackBarrierPending > 0
      || kernel.pending > 0
    ) return Promise.resolve(this.getStatus());

    this.cache.clear();
    this.namespaceHydrated = false;
    this.localDirty = false;
    this.localError = null;
    this.bootError = null;
    this.bootPhase = 'booting';
    this.initializePromise = null;
    this.emitStatus();
    return this.initialize();
  }

  private async initializeOnce(): Promise<NativeStorageStatus> {
    this.bootPhase = 'booting';
    this.emitStatus();

    const reset = await this.completePendingRecoveryReset();
    if (!reset.ok) {
      return this.blockInitialization(`Recovery reset could not finish: ${reset.message}`);
    }

    let recovery;
    try {
      recovery = await this.coordinator.recover();
    } catch (error) {
      return this.blockInitialization(`Storage recovery failed unexpectedly: ${boundedMessage(error)}`);
    }
    if (!recovery.ok) {
      return this.blockInitialization(`Storage recovery failed: ${recovery.error.message}`);
    }

    let migration;
    try {
      migration = await runNativeStorageMigrations(
        this.backend,
        this.coordinator,
        this.migrationOptions,
      );
    } catch (error) {
      return this.blockInitialization(`Storage migration failed unexpectedly: ${boundedMessage(error)}`);
    }
    if (!migration.ok) return this.blockInitialization(migration.message);

    try {
      const keys = await this.backend.getAllKeys();
      for (const key of keys) {
        if (!key.startsWith('gc.') || isNativeInternalKey(key)) continue;
        const raw = await this.backend.getItem(key);
        const decoded = decodeRaw(raw);
        if (raw !== null && !decoded.validJson) {
          return this.blockInitialization(`Stored value ${key} is not valid JSON. Export or reset it before gameplay resumes.`);
        }
        if (raw !== null) {
          const validation = validateNativeStoredValue(key, decoded.parsed);
          if (!validation.ok) {
            return this.blockInitialization(
              `Stored value ${key} is incompatible with this native build: ${validation.message} Export or reset it before gameplay resumes.`,
            );
          }
        }
        this.cache.set(key, {
          raw,
          ...decoded,
          revision: this.cache.get(key)?.revision ?? 0,
        });
      }
      this.namespaceHydrated = true;

      const activeEntry = this.cache.get('gc.activeCharId');
      const activeId = activeEntry?.raw !== null && activeEntry?.validJson
        ? activeEntry?.parsed
        : undefined;
      if (typeof activeId === 'string') {
        const customEntry = this.cache.get('gc.customChars');
        const custom = customEntry?.raw !== null && customEntry?.validJson
          && typeof customEntry?.parsed === 'object' && customEntry.parsed !== null
          ? customEntry.parsed as Record<string, unknown>
          : Object.create(null) as Record<string, unknown>;
        if (
          !Object.prototype.hasOwnProperty.call(CHARACTER_TEMPLATES, activeId)
          && !Object.prototype.hasOwnProperty.call(custom, activeId)
        ) {
          return this.blockInitialization(
            `Stored value gc.activeCharId names ${JSON.stringify(activeId)}, which does not exist in the native roster. Export or reset it before gameplay resumes.`,
          );
        }
      }
    } catch (error) {
      return this.blockInitialization(`Could not hydrate native storage: ${boundedMessage(error)}`);
    }

    this.bootPhase = 'ready';
    this.bootError = null;
    this.emitStatus();
    return this.getStatus();
  }

  private blockInitialization(message: string): NativeStorageStatus {
    this.bootPhase = 'blocked';
    this.bootError = {
      code: 'initialization_failed',
      message: message.slice(0, 500),
    };
    this.emitStatus();
    return this.getStatus();
  }

  getStatus(): NativeStorageStatus {
    const kernel = this.coordinator.getStatus();
    // The kernel marks itself blocked while an owned journal is actively being
    // applied. That is a transient mutual-exclusion state, not a recovery
    // failure: new writes should continue joining its FIFO queue and the React
    // tree must stay mounted. An idle+blocked kernel is the durable fault state.
    const kernelFaultBlocked = kernel.initialized && kernel.blocked && kernel.phase === 'idle';
    const blocked = (
      this.bootPhase === 'blocked'
      || kernelFaultBlocked
      || this.localDirty
      || this.callbackBarrierPending > 0
    );
    return {
      phase: blocked ? 'blocked' : this.bootPhase,
      ready: this.bootPhase === 'ready' && kernel.initialized && !blocked && !this.recoveryResetPending,
      pending: Math.max(this.localPending, kernel.pending)
        + this.maintenancePending
        + this.callbackBarrierPending
        + (this.recoveryResetPending ? 1 : 0),
      dirty: this.localDirty || this.localPending > 0 || kernel.dirty || this.recoveryResetPending,
      blocked,
      initialized: this.bootPhase === 'ready' && kernel.initialized,
      transactionId: kernel.transactionId,
      lastError: this.bootError ?? this.localError ?? kernel.lastError,
    };
  }

  subscribeStatus(listener: NativeStorageStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private emitStatus(): void {
    const snapshot = this.getStatus();
    for (const listener of [...this.statusListeners]) {
      try { listener(snapshot); } catch { /* observers cannot break persistence */ }
    }
  }

  subscribeKey(key: string, listener: () => void): () => void {
    let set = this.keyListeners.get(key);
    if (!set) {
      set = new Set();
      this.keyListeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.keyListeners.delete(key);
    };
  }

  private emitKey(key: string): void {
    const listeners = this.keyListeners.get(key);
    if (listeners) {
      for (const listener of [...listeners]) {
        try { listener(); } catch { /* observers cannot break a logical update */ }
      }
    }
  }

  /**
   * Serializes native writes and maintenance reads before they enter the shared
   * coordinator. The coordinator still owns journalling and durable FIFO; this
   * small outer queue makes a multi-key read a single ordering point too.
   */
  private enqueueIo<T>(work: () => Promise<T>): Promise<T> {
    const scheduled = this.ioTail.then(work, work);
    this.ioTail = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

  isHydrated(key: string): boolean {
    if (isNativeInternalKey(key)) return false;
    return this.cache.has(key) || (this.namespaceHydrated && key.startsWith('gc.'));
  }

  read<T>(key: string, seed: T): T {
    const entry = this.cache.get(key);
    return entry && entry.raw != null && entry.validJson ? entry.parsed as T : seed;
  }

  /** Existing non-null keys from the startup-preloaded + optimistic cache. */
  knownKeys(predicate: (key: string) => boolean = () => true): readonly string[] {
    const keys: string[] = [];
    for (const [key, entry] of this.cache) {
      if (entry.raw != null && isNativeDataKey(key) && predicate(key)) keys.push(key);
    }
    return keys;
  }

  /**
   * An explicit hydration helper for late/non-gc keys. Revision comparison is
   * the race barrier: a read started before a local update can never replace
   * the newer optimistic value when it eventually resolves.
   */
  async hydrate<T>(key: string, seed: T): Promise<T> {
    if (isNativeInternalKey(key)) return seed;
    const current = this.cache.get(key);
    if (current) return this.read(key, seed);
    const revision = 0;
    let raw: string | null;
    try {
      raw = await this.backend.getItem(key);
    } catch (error) {
      this.localError = {
        code: 'transaction_failed',
        message: `Could not hydrate ${key}: ${boundedMessage(error)}`,
        key,
      };
      this.emitStatus();
      return seed;
    }
    if ((this.cache.get(key)?.revision ?? 0) !== revision) return this.read(key, seed);
    const decoded = decodeRaw(raw);
    let invalidReason: string | null = null;
    if (raw !== null) {
      if (!decoded.validJson) invalidReason = `its stored value is not valid JSON.`;
      else {
        const validation = validateNativeStoredValue(key, decoded.parsed);
        if (!validation.ok) invalidReason = validation.message;
      }
    }
    if (invalidReason !== null) {
      this.localDirty = true;
      this.localError = {
        code: 'invalid_data',
        message: `Could not hydrate ${key}: ${invalidReason}`,
        key,
      };
      this.emitStatus();
      return seed;
    }
    this.cache.set(key, { raw, ...decoded, revision });
    this.emitKey(key);
    return this.read(key, seed);
  }

  update<T>(key: string, seed: T, next: Setter<T>): Promise<NativeDurabilityResult> {
    return this.runTransaction((transaction) => {
      transaction.update(key, seed, next);
    });
  }

  /**
   * Executes `work` immediately. Functional updates therefore resolve against
   * one in-memory snapshot before this method returns; only durability is
   * asynchronous. All changed keys are committed under one shared journal.
   */
  runTransaction(work: (transaction: StoredTransaction) => void): Promise<NativeDurabilityResult> {
    // Nested transactions are savepoints in the logical sense only: they join
    // the outer synchronous batch and resolve with its one durability result.
    // This lets runStoredTransaction(() => { hookSetter(); hookSetter(); })
    // batch existing hook APIs without teaching each hook about transactions.
    if (this.activeBatch) {
      try {
        const returned: unknown = work(this.activeBatch.transaction);
        if (isThenable(returned) && returned !== this.activeBatch.promise) {
          this.activeBatch.holdUntil(returned);
          this.activeBatch.fail(nativeFailure(
            'transaction_failed',
            'Stored transaction callbacks must be synchronous.',
          ));
        }
      } catch (error) {
        this.activeBatch.fail(nativeFailure(
          'transaction_failed',
          `Stored transaction failed: ${boundedMessage(error)}`,
        ));
      }
      return this.activeBatch.promise;
    }

    if (!this.getStatus().ready || this.localDirty) {
      return Promise.resolve(nativeFailure('not_ready', 'Native storage is not ready for writes.', 'blocked'));
    }

    let resolveBatch!: (result: NativeDurabilityResult) => void;
    const batchPromise = new Promise<NativeDurabilityResult>((resolve) => {
      resolveBatch = resolve;
    });

    const drafts = new Map<string, DraftEntry>();
    let workFailure: NativeDurabilityResult | null = null;
    let transactionActive = true;

    const assertTransactionActive = (): void => {
      if (!transactionActive) {
        throw new Error('This stored transaction is no longer active.');
      }
    };

    const getDraft = (key: string): DraftEntry => {
      const existing = drafts.get(key);
      if (existing) return existing;
      const cached = this.cache.get(key);
      const raw = cached?.raw ?? null;
      // Reparse the raw snapshot so a mutating functional updater cannot alias
      // and silently modify the committed cache before durability succeeds.
      const decoded = decodeRaw(raw);
      const draft: DraftEntry = {
        beforeRaw: raw,
        afterRaw: raw,
        parsed: decoded.parsed,
        validJson: decoded.validJson,
      };
      drafts.set(key, draft);
      return draft;
    };

    const requireKey = (key: string): boolean => {
      if (isNativeDataKey(key)) return true;
      workFailure = nativeFailure('invalid_key', `Invalid or reserved native storage key: ${JSON.stringify(key)}`, 'rejected', key);
      return false;
    };

    const transaction: StoredTransaction = {
      read: <T,>(key: string, seed: T): T => {
        assertTransactionActive();
        if (!requireKey(key)) return seed;
        const draft = getDraft(key);
        if (draft.afterRaw != null && draft.validJson) return draft.parsed as T;
        try {
          return cloneJsonValue(seed);
        } catch (error) {
          workFailure = nativeFailure(
            'serialization_failed',
            `Could not isolate the seed for ${key}: ${boundedMessage(error)}`,
            'rejected',
            key,
          );
          return seed;
        }
      },
      update: <T,>(key: string, seed: T, next: Setter<T>): T => {
        assertTransactionActive();
        if (!requireKey(key)) return seed;
        const draft = getDraft(key);
        let previous: T;
        try {
          previous = draft.afterRaw != null && draft.validJson
            ? draft.parsed as T
            : cloneJsonValue(seed);
        } catch (error) {
          workFailure = nativeFailure(
            'serialization_failed',
            `Could not isolate the seed for ${key}: ${boundedMessage(error)}`,
            'rejected',
            key,
          );
          return seed;
        }
        const resolved = typeof next === 'function'
          ? (next as (value: T) => T)(previous)
          : next;
        if (isThenable(resolved)) {
          this.activeBatch?.holdUntil(resolved);
          workFailure = nativeFailure(
            'transaction_failed',
            `Functional updater for ${key} must return synchronously.`,
            'rejected',
            key,
          );
          return previous;
        }
        let raw: string | undefined;
        try {
          raw = JSON.stringify(resolved);
        } catch (error) {
          workFailure = nativeFailure(
            'serialization_failed',
            `Could not serialize ${key}: ${boundedMessage(error)}`,
            'rejected',
            key,
          );
          return previous;
        }
        if (raw === undefined) {
          workFailure = nativeFailure('serialization_failed', `${key} cannot be serialized as JSON.`, 'rejected', key);
          return previous;
        }
        const decoded = decodeRaw(raw);
        const validation = validateNativeStoredValue(key, decoded.parsed);
        if (!validation.ok) {
          workFailure = nativeFailure(
            'invalid_data',
            `Refused incompatible value for ${key}: ${validation.message}`,
            'rejected',
            key,
          );
          return previous;
        }
        draft.afterRaw = raw;
        draft.parsed = decoded.parsed;
        draft.validJson = decoded.validJson;
        return resolved;
      },
      setRaw: (key: string, raw: string): void => {
        assertTransactionActive();
        if (!requireKey(key)) return;
        const decoded = decodeRaw(raw);
        if (!decoded.validJson) {
          workFailure = nativeFailure(
            'serialization_failed',
            `${key} must be set to a valid serialized JSON value.`,
            'rejected',
            key,
          );
          return;
        }
        const validation = validateNativeStoredValue(key, decoded.parsed);
        if (!validation.ok) {
          workFailure = nativeFailure(
            'invalid_data',
            `Refused incompatible value for ${key}: ${validation.message}`,
            'rejected',
            key,
          );
          return;
        }
        const draft = getDraft(key);
        draft.afterRaw = raw;
        draft.parsed = decoded.parsed;
        draft.validJson = decoded.validJson;
      },
      remove: (key: string): void => {
        assertTransactionActive();
        if (!requireKey(key)) return;
        const draft = getDraft(key);
        draft.afterRaw = null;
        draft.parsed = undefined;
        draft.validJson = true;
      },
    };

    let heldThenables = 0;
    let callbackReturned = false;
    const batch: ActiveBatch = {
      transaction,
      promise: batchPromise,
      fail: (result) => { workFailure = result; },
      holdUntil: (value) => {
        heldThenables += 1;
        this.callbackBarrierPending += 1;
        this.localError = {
          code: 'transaction_failed',
          message: 'Stored transaction callbacks and functional updaters must be synchronous.',
        };
        this.emitStatus();
        observeThenableSettlement(value, () => {
          heldThenables = Math.max(0, heldThenables - 1);
          this.callbackBarrierPending = Math.max(0, this.callbackBarrierPending - 1);
          if (callbackReturned && heldThenables === 0 && this.activeBatch === batch) {
            this.activeBatch = null;
          }
          this.emitStatus();
        });
      },
    };
    this.activeBatch = batch;
    try {
      const returned: unknown = work(transaction);
      // A concise callback may return a nested setter's durability Promise;
      // that is this exact outer Promise and is still synchronous. A distinct
      // thenable means the callback itself is async and cannot be atomic.
      if (isThenable(returned) && returned !== batchPromise) {
        batch.holdUntil(returned);
        workFailure = nativeFailure(
          'transaction_failed',
          'Stored transaction callbacks must be synchronous.',
        );
      }
    } catch (error) {
      workFailure = nativeFailure('transaction_failed', `Stored transaction failed: ${boundedMessage(error)}`);
    } finally {
      transactionActive = false;
      callbackReturned = true;
      if (heldThenables === 0 && this.activeBatch === batch) this.activeBatch = null;
    }
    if (workFailure) {
      resolveBatch(workFailure);
      return batchPromise;
    }

    const changed = [...drafts.entries()].filter(([, draft]) => draft.beforeRaw !== draft.afterRaw);
    if (changed.length === 0) {
      resolveBatch(UNCHANGED);
      return batchPromise;
    }
    if (changed.length > MAX_TRANSACTION_OPERATIONS) {
      resolveBatch(nativeFailure(
        'transaction_failed',
        `A stored transaction may change at most ${MAX_TRANSACTION_OPERATIONS} keys.`,
      ));
      return batchPromise;
    }

    const revisions = new Map<string, number>();
    for (const [key, draft] of changed) {
      const revision = (this.cache.get(key)?.revision ?? 0) + 1;
      revisions.set(key, revision);
      this.cache.set(key, {
        raw: draft.afterRaw,
        parsed: draft.parsed,
        validJson: draft.validJson,
        revision,
      });
    }
    let durability: Promise<StorageTransactionResult>;
    try {
      const mutations = changed.map(([key, draft]) => ({
        key,
        value: draft.afterRaw,
        expected: draft.beforeRaw,
      }));
      durability = this.enqueueIo(() => this.coordinator.transact(mutations));
    } catch (error) {
      durability = Promise.reject(error);
    }
    const tracked = this.trackDurability(durability, changed, revisions);
    void tracked.then(resolveBatch);
    // Register durability before notifying. A synchronous listener can now
    // enqueue a dependent write or snapshot only behind this transaction.
    // Every cache entry is still installed before any listener fires.
    for (const [key] of changed) this.emitKey(key);
    return batchPromise;
  }

  private trackDurability(
    durability: Promise<StorageTransactionResult>,
    changed: readonly [string, DraftEntry][],
    revisions: ReadonlyMap<string, number>,
  ): Promise<NativeDurabilityResult> {
    this.localPending += 1;
    this.emitStatus();
    let tracked!: Promise<NativeDurabilityResult>;
    tracked = durability.then(async (result): Promise<NativeDurabilityResult> => {
      if (!result.ok) {
        const refreshed = new Map<string, CacheEntry>();
        const readFailures = new Map<string, unknown>();
        // Read every still-current key first. A failed logical transaction is
        // reconciled into the cache as one publication, never key by key.
        for (const [key] of changed) {
          if (this.cache.get(key)?.revision !== revisions.get(key)) continue;
          try {
            const raw = await this.backend.getItem(key);
            const decoded = decodeRaw(raw);
            let invalidReason: string | null = null;
            if (raw !== null) {
              if (!decoded.validJson) invalidReason = `${key} is not valid JSON.`;
              else {
                const validation = validateNativeStoredValue(key, decoded.parsed);
                if (!validation.ok) invalidReason = validation.message;
              }
            }
            if (invalidReason !== null) {
              throw new Error(invalidReason);
            }
            refreshed.set(key, {
              raw,
              ...decoded,
              revision: (revisions.get(key) ?? 0) + 1,
            });
          } catch (error) {
            readFailures.set(key, error);
          }
        }

        const requiredFailure = [...readFailures].find(([key]) => (
          this.cache.get(key)?.revision === revisions.get(key)
        ));
        if (requiredFailure) {
          const [key, error] = requiredFailure;
          this.localDirty = true;
          this.localError = {
            code: 'transaction_failed',
            message: `Persistence failed and ${key} could not be reconciled: ${boundedMessage(error)}`,
            key,
          };
          return result;
        }

        const publish: Array<[string, CacheEntry]> = [];
        for (const [key, entry] of refreshed) {
          // A later optimistic update may have advanced this key while the
          // authoritative reads were in flight. Never publish a stale read.
          if (this.cache.get(key)?.revision === revisions.get(key)) publish.push([key, entry]);
        }
        for (const [key, entry] of publish) this.cache.set(key, entry);
        for (const [key] of publish) this.emitKey(key);
      }
      return result;
    }).catch((error): NativeDurabilityResult => {
      this.localDirty = true;
      this.localError = {
        code: 'transaction_failed',
        message: `Native persistence failed unexpectedly: ${boundedMessage(error)}`,
      };
      return nativeFailure('transaction_failed', this.localError.message);
    }).finally(() => {
      this.localPending = Math.max(0, this.localPending - 1);
      this.durabilityTasks.delete(tracked);
      this.emitStatus();
    });
    this.durabilityTasks.add(tracked);
    this.durabilityTail = tracked;
    return tracked;
  }

  flush(): Promise<NativeDurabilityResult> {
    // Capture every task already in flight. A later FIFO transaction can
    // commit while an earlier failed transaction is still reconciling its
    // optimistic cache, so waiting for only the latest Promise is insufficient.
    const tasks = [...this.durabilityTasks];
    if (tasks.length === 0) return Promise.resolve(UNCHANGED);
    return Promise.all(tasks).then((results) => (
      results.find((result) => !result.ok) ?? results[results.length - 1] ?? UNCHANGED
    ));
  }

  async readRawSnapshot(predicate: (key: string) => boolean): Promise<ReadonlyMap<string, string>> {
    if (!this.getStatus().ready) {
      throw new Error('Native storage is not ready for a snapshot.');
    }
    // Capture the last preceding write before enqueueing. Any write invoked
    // after this call enters enqueueIo behind the entire key enumeration/read.
    const precedingDurability = this.flush();
    this.maintenancePending += 1;
    this.emitStatus();
    return this.enqueueIo(async () => {
      const durability = await precedingDurability;
      const kernel = this.coordinator.getStatus();
      if (!durability.ok || this.localDirty || kernel.dirty || (kernel.blocked && kernel.phase === 'idle')) {
        throw new Error(durability.ok
          ? 'Native storage is not in a clean state.'
          : durability.error.message);
      }
      const result = new Map<string, string>();
      const keys = await this.backend.getAllKeys();
      for (const key of keys) {
        if (!predicate(key) || isNativeInternalKey(key)) continue;
        const raw = await this.backend.getItem(key);
        if (raw != null) result.set(key, raw);
      }
      return result;
    }).finally(() => {
      this.maintenancePending = Math.max(0, this.maintenancePending - 1);
      this.emitStatus();
    });
  }

  async listKeys(): Promise<readonly string[]> {
    if (!this.getStatus().ready) {
      throw new Error('Native storage is not ready for key inspection.');
    }
    const precedingDurability = this.flush();
    this.maintenancePending += 1;
    this.emitStatus();
    return this.enqueueIo(async () => {
      const durability = await precedingDurability;
      const kernel = this.coordinator.getStatus();
      if (!durability.ok || this.localDirty || kernel.dirty || (kernel.blocked && kernel.phase === 'idle')) {
        throw new Error(durability.ok
          ? 'Native storage is not in a clean state.'
          : durability.error.message);
      }
      return (await this.backend.getAllKeys()).filter(key => !isNativeInternalKey(key));
    }).finally(() => {
      this.maintenancePending = Math.max(0, this.maintenancePending - 1);
      this.emitStatus();
    });
  }

  /**
   * Raw, explicitly diagnostic snapshot available while normal hydration is
   * blocked. The journal is intentionally included and no recovery is
   * attempted: this is a forensic export, not a gameplay snapshot.
   */
  async readRecoverySnapshot(): Promise<ReadonlyMap<string, string>> {
    this.maintenancePending += 1;
    this.emitStatus();
    return this.enqueueIo(async () => {
      const result = new Map<string, string>();
      for (const key of await this.backend.getAllKeys()) {
        if (!key.startsWith('gc.') && key !== NATIVE_RECOVERY_RESET_WITNESS_KEY) continue;
        const raw = await this.backend.getItem(key);
        if (raw !== null) result.set(key, raw);
      }
      return result;
    }).finally(() => {
      this.maintenancePending = Math.max(0, this.maintenancePending - 1);
      this.emitStatus();
    });
  }

  /**
   * Finish an explicit recovery reset before the ordinary journal is examined.
   * Every destructive step is idempotent and the intent is removed last, so a
   * process death at any point resumes here on the next launch.
   */
  private async completePendingRecoveryReset(): Promise<RecoveryResetProtocolResult> {
    let intentRaw: string | null;
    let witnessRaw: string | null;
    try {
      intentRaw = await this.backend.getItem(NATIVE_RECOVERY_RESET_INTENT_KEY);
      witnessRaw = await this.backend.getItem(NATIVE_RECOVERY_RESET_WITNESS_KEY);
    } catch (error) {
      return { ok: false, message: `Could not inspect the durable reset authorization: ${boundedMessage(error)}` };
    }
    if (intentRaw === null && witnessRaw === null) return { ok: true };
    if (witnessRaw !== NATIVE_RECOVERY_RESET_WITNESS_RAW) {
      return {
        ok: false,
        message: 'The recovery-reset intent has no valid confirmation witness. Confirm Reset local data again to replace it safely.',
      };
    }
    if (intentRaw !== null && intentRaw !== NATIVE_RECOVERY_RESET_INTENT_RAW) {
      return {
        ok: false,
        message: 'The durable reset intent is malformed. Use the confirmed recovery reset to replace it safely.',
      };
    }

    const currentVersion = this.migrationOptions.currentVersion ?? NATIVE_STORAGE_VERSION;
    if (!Number.isSafeInteger(currentVersion) || currentVersion < 1) {
      return { ok: false, message: 'This build has an invalid native storage version.' };
    }
    const currentVersionRaw = JSON.stringify(currentVersion);

    try {
      if (intentRaw === null) {
        let installError: unknown;
        try {
          await this.backend.setItem(
            NATIVE_RECOVERY_RESET_INTENT_KEY,
            NATIVE_RECOVERY_RESET_INTENT_RAW,
          );
        } catch (error) {
          installError = error;
        }
        if (await this.backend.getItem(NATIVE_RECOVERY_RESET_INTENT_KEY) !== NATIVE_RECOVERY_RESET_INTENT_RAW) {
          throw new Error(
            `The durable reset intent could not be verified${installError === undefined ? '.' : `: ${boundedMessage(installError)}`}`,
          );
        }
      }

      const keys = new Set(await this.backend.getAllKeys());
      for (const key of keys) {
        if (!key.startsWith('gc.') || key === NATIVE_RECOVERY_RESET_INTENT_KEY) continue;
        await this.backend.removeItem(key);
        if (await this.backend.getItem(key) !== null) {
          throw new Error(`Removal of ${key} could not be verified.`);
        }
      }

      const remaining = (await this.backend.getAllKeys()).filter(key => (
        key.startsWith('gc.')
        && key !== NATIVE_RECOVERY_RESET_INTENT_KEY
      ));
      if (remaining.length > 0) {
        throw new Error(`New or unremoved application key ${remaining[0]} prevented a verified reset.`);
      }

      try { await this.backend.setItem(NATIVE_STORAGE_VERSION_KEY, currentVersionRaw); }
      catch { /* exact read-back below decides whether the write committed */ }
      if (await this.backend.getItem(NATIVE_STORAGE_VERSION_KEY) !== currentVersionRaw) {
        throw new Error('The current native storage version could not be verified.');
      }

      try { await this.backend.removeItem(NATIVE_RECOVERY_RESET_INTENT_KEY); }
      catch { /* exact read-back below decides whether the removal committed */ }
      if (await this.backend.getItem(NATIVE_RECOVERY_RESET_INTENT_KEY) !== null) {
        throw new Error('The completed reset intent could not be cleared.');
      }
      // The non-portable confirmation witness is the authorization root and
      // is deliberately cleared last. If termination happens first, startup
      // reinstalls the intent and resumes every idempotent step.
      try { await this.backend.removeItem(NATIVE_RECOVERY_RESET_WITNESS_KEY); }
      catch { /* exact read-back below decides whether the removal committed */ }
      if (await this.backend.getItem(NATIVE_RECOVERY_RESET_WITNESS_KEY) !== null) {
        throw new Error('The completed reset witness could not be cleared.');
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: `${boundedMessage(error)} Any surviving confirmation witness will resume the reset on restart.`,
      };
    }
  }

  /** Remove all native app data, including an unrecoverable journal, and reinitialize. */
  async resetDataForRecovery(): Promise<NativeDurabilityResult> {
    if (this.recoveryResetPending) {
      return nativeFailure('not_ready', 'A native recovery reset is already in progress.', 'blocked');
    }
    // Close the write gate before waiting for preceding durability. Late UI
    // callbacks cannot queue data behind the destructive sweep.
    this.recoveryResetPending = true;
    // Let every already-started write finish reconciliation first. The reset is
    // allowed to proceed after a failed durability result, but never races its
    // authoritative repair reads.
    const precedingDurability = this.flush();
    this.maintenancePending += 1;
    this.emitStatus();
    await precedingDurability;
    const reset = await this.enqueueIo(async (): Promise<RecoveryResetProtocolResult> => {
      let witnessInstallError: unknown;
      try {
        await this.backend.setItem(
          NATIVE_RECOVERY_RESET_WITNESS_KEY,
          NATIVE_RECOVERY_RESET_WITNESS_RAW,
        );
      } catch (error) {
        witnessInstallError = error;
      }
      let witnessRaw: string | null;
      try {
        witnessRaw = await this.backend.getItem(NATIVE_RECOVERY_RESET_WITNESS_KEY);
      } catch (error) {
        return {
          ok: false,
          message: `The reset confirmation witness could not be verified: ${boundedMessage(error)}`,
        };
      }
      if (witnessRaw !== NATIVE_RECOVERY_RESET_WITNESS_RAW) {
        return {
          ok: false,
          message: `The reset confirmation witness could not be installed. No reset was started${witnessInstallError === undefined ? '.' : `: ${boundedMessage(witnessInstallError)}`}`,
        };
      }

      let intentInstallError: unknown;
      try {
        await this.backend.setItem(
          NATIVE_RECOVERY_RESET_INTENT_KEY,
          NATIVE_RECOVERY_RESET_INTENT_RAW,
        );
      } catch (error) {
        intentInstallError = error;
      }
      let intentRaw: string | null;
      try {
        intentRaw = await this.backend.getItem(NATIVE_RECOVERY_RESET_INTENT_KEY);
      } catch (error) {
        return {
          ok: false,
          message: `The durable reset intent could not be verified: ${boundedMessage(error)} Reload to resume the confirmed reset if it was installed.`,
        };
      }
      if (intentRaw !== NATIVE_RECOVERY_RESET_INTENT_RAW) {
        return {
          ok: false,
          message: `The durable reset intent could not be installed${intentInstallError === undefined ? '.' : `: ${boundedMessage(intentInstallError)}`} The surviving witness will retry on restart.`,
        };
      }
      return this.completePendingRecoveryReset();
    }).catch((error): RecoveryResetProtocolResult => ({
      ok: false,
      message: `Recovery reset failed unexpectedly: ${boundedMessage(error)}`,
    })).finally(() => {
      this.maintenancePending = Math.max(0, this.maintenancePending - 1);
      this.emitStatus();
    });

    if (!reset.ok) {
      this.recoveryResetPending = false;
      this.emitStatus();
      return nativeFailure('transaction_failed', reset.message, 'blocked');
    }

    this.recoveryResetPending = false;
    this.emitStatus();
    const status = await this.retryInitialization();
    if (!status.ready || status.blocked) {
      return nativeFailure(
        'initialization_failed',
        `Recovery reset completed, but storage did not reinitialize: ${status.lastError?.message ?? 'storage is not ready'}`,
        'blocked',
      );
    }
    return RECOVERY_RESET_COMMITTED;
  }

  /** Test-only: clears process memory, never the durable backend. */
  resetMemory(): void {
    this.cache.clear();
    this.keyListeners.clear();
    this.localError = null;
    this.localDirty = false;
    this.recoveryResetPending = false;
    this.namespaceHydrated = false;
  }
}
