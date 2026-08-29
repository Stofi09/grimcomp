import {
  isValidStorageKey,
  MAX_TRANSACTION_OPERATIONS,
  STORAGE_TRANSACTION_JOURNAL_KEY,
  type StorageKernelError,
  type StorageTransactionCoordinator,
  type StorageTransactionResult,
} from '@grimcomp/core';
import type { NativeRawAsyncKeyValue } from './asyncStorageBackend';
import {
  NATIVE_STORAGE_VERSION_KEY,
  runNativeStorageMigrations,
  type NativeStorageMigrationTable,
} from './migrations';

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
}

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
  readonly code: 'not_ready' | 'invalid_key' | 'serialization_failed' | 'transaction_failed' | 'initialization_failed';
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

function isNativeDataKey(key: string): boolean {
  return (
    key.startsWith('gc.') &&
    isValidStorageKey(key) &&
    key !== STORAGE_TRANSACTION_JOURNAL_KEY &&
    key !== NATIVE_STORAGE_VERSION_KEY
  );
}

function isThenable(value: unknown): boolean {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  try { return typeof (value as { then?: unknown }).then === 'function'; }
  catch { return true; }
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

  private async initializeOnce(): Promise<NativeStorageStatus> {
    this.bootPhase = 'booting';
    this.emitStatus();

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
        if (!key.startsWith('gc.') || key === STORAGE_TRANSACTION_JOURNAL_KEY) continue;
        const raw = await this.backend.getItem(key);
        const decoded = decodeRaw(raw);
        this.cache.set(key, {
          raw,
          ...decoded,
          revision: this.cache.get(key)?.revision ?? 0,
        });
      }
      this.namespaceHydrated = true;
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
    const kernelFaultBlocked = kernel.blocked && kernel.phase === 'idle';
    const blocked = this.bootPhase === 'blocked' || kernelFaultBlocked || this.localDirty;
    return {
      phase: blocked ? 'blocked' : this.bootPhase,
      ready: this.bootPhase === 'ready' && kernel.initialized && !blocked,
      pending: Math.max(this.localPending, kernel.pending) + this.maintenancePending,
      dirty: this.localDirty || this.localPending > 0 || kernel.dirty,
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
      if (entry.raw != null && predicate(key)) keys.push(key);
    }
    return keys;
  }

  /**
   * An explicit hydration helper for late/non-gc keys. Revision comparison is
   * the race barrier: a read started before a local update can never replace
   * the newer optimistic value when it eventually resolves.
   */
  async hydrate<T>(key: string, seed: T): Promise<T> {
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

    const getDraft = (key: string): DraftEntry => {
      const existing = drafts.get(key);
      if (existing) return existing;
      const cached = this.cache.get(key);
      const raw = cached?.raw ?? null;
      const decoded = cached ?? { ...decodeRaw(raw), revision: 0, raw };
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
        if (!requireKey(key)) return seed;
        const draft = getDraft(key);
        return draft.afterRaw != null && draft.validJson ? draft.parsed as T : seed;
      },
      update: <T,>(key: string, seed: T, next: Setter<T>): T => {
        if (!requireKey(key)) return seed;
        const draft = getDraft(key);
        const previous = draft.afterRaw != null && draft.validJson ? draft.parsed as T : seed;
        const resolved = typeof next === 'function'
          ? (next as (value: T) => T)(previous)
          : next;
        if (Object.is(previous, resolved)) return previous;
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
        draft.afterRaw = raw;
        draft.parsed = decoded.parsed;
        draft.validJson = decoded.validJson;
        return resolved;
      },
      setRaw: (key: string, raw: string): void => {
        if (!requireKey(key)) return;
        const draft = getDraft(key);
        const decoded = decodeRaw(raw);
        draft.afterRaw = raw;
        draft.parsed = decoded.parsed;
        draft.validJson = decoded.validJson;
      },
      remove: (key: string): void => {
        if (!requireKey(key)) return;
        const draft = getDraft(key);
        draft.afterRaw = null;
        draft.parsed = undefined;
        draft.validJson = true;
      },
    };

    this.activeBatch = {
      transaction,
      promise: batchPromise,
      fail: (result) => { workFailure = result; },
    };
    try {
      const returned: unknown = work(transaction);
      // A concise callback may return a nested setter's durability Promise;
      // that is this exact outer Promise and is still synchronous. A distinct
      // thenable means the callback itself is async and cannot be atomic.
      if (isThenable(returned) && returned !== batchPromise) {
        workFailure = nativeFailure(
          'transaction_failed',
          'Stored transaction callbacks must be synchronous.',
        );
      }
    } catch (error) {
      workFailure = nativeFailure('transaction_failed', `Stored transaction failed: ${boundedMessage(error)}`);
    } finally {
      this.activeBatch = null;
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
    // Notify only after every key reflects the new logical state. Subscribers
    // can safely read another key from the same transaction during re-render.
    for (const [key] of changed) this.emitKey(key);

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
    void this.trackDurability(durability, changed, revisions).then(resolveBatch);
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
        // Reconcile only values that have not received a newer local update.
        // The raw read is authoritative for rejected, rolled-back, and
        // indeterminate outcomes alike.
        for (const [key] of changed) {
          if (this.cache.get(key)?.revision !== revisions.get(key)) continue;
          try {
            const raw = await this.backend.getItem(key);
            // A later optimistic update may have advanced this key while the
            // authoritative read was in flight. Never publish the stale read
            // over that newer revision; its own durability task will reconcile
            // the key if necessary.
            if (this.cache.get(key)?.revision !== revisions.get(key)) continue;
            const decoded = decodeRaw(raw);
            this.cache.set(key, {
              raw,
              ...decoded,
              revision: (revisions.get(key) ?? 0) + 1,
            });
            this.emitKey(key);
          } catch (error) {
            if (this.cache.get(key)?.revision !== revisions.get(key)) continue;
            this.localDirty = true;
            this.localError = {
              code: 'transaction_failed',
              message: `Persistence failed and ${key} could not be reconciled: ${boundedMessage(error)}`,
              key,
            };
          }
        }
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
    if (tasks.length === 0) return this.durabilityTail;
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
        if (!predicate(key) || key === STORAGE_TRANSACTION_JOURNAL_KEY) continue;
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
      return this.backend.getAllKeys();
    }).finally(() => {
      this.maintenancePending = Math.max(0, this.maintenancePending - 1);
      this.emitStatus();
    });
  }

  /** Test-only: clears process memory, never the durable backend. */
  resetMemory(): void {
    this.cache.clear();
    this.keyListeners.clear();
    this.localError = null;
    this.localDirty = false;
    this.namespaceHydrated = false;
  }
}
