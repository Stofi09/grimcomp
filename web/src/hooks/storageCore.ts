import {
  MAX_TRANSACTION_OPERATIONS,
  STORAGE_TRANSACTION_JOURNAL_KEY,
  type StorageComputedTransactionResult,
  type StorageCoordinatorStatus,
  type StorageKernelError,
  type StorageTransactionCoordinator,
  type StorageTransactionResult,
} from '@grimcomp/core';

/** Synchronous reads are intentional: React hooks hydrate before render. */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

export interface ConditionalStorageMutation {
  readonly key: string;
  readonly value: string | null;
  /** Compare-and-set guard captured from the committed/preceding queued value. */
  readonly expected: string | null;
}

export interface StorageCoreError {
  readonly code:
    | 'read_failed'
    | 'decode_failed'
    | 'encode_failed'
    | 'enumerate_failed'
    | 'schema_mismatch'
    | 'transaction_failed'
    | 'listener_failed';
  readonly message: string;
  readonly key?: string;
  readonly cause?: string;
  readonly kernelError?: StorageKernelError;
}

export interface StorageCoreStatus {
  readonly pending: number;
  readonly dirty: boolean;
  readonly coordinatorDirty: boolean;
  readonly blocked: boolean;
  readonly initialized: boolean;
  readonly phase: StorageCoordinatorStatus['phase'];
  readonly transactionId: string | null;
  readonly lastError: StorageCoreError | null;
}

export type StorageCommitResult =
  | StorageTransactionResult
  | { readonly ok: true; readonly outcome: 'unchanged'; readonly transactionId: null }
  | {
      readonly ok: false;
      readonly outcome: 'rejected' | 'blocked';
      readonly transactionId: null;
      readonly error: StorageCoreError;
    };

export interface StorageTransactionTicket<T> {
  /** Result of all functional updates, resolved before this method returns. */
  readonly value: T;
  /** Resolves after the journaled write commits or reports a failure. */
  readonly completion: Promise<StorageCommitResult>;
}

export type StorageMaintenanceCommitResult<T> =
  | StorageComputedTransactionResult<T>
  | {
      readonly ok: false;
      readonly outcome: 'rejected' | 'blocked';
      readonly transactionId: null;
      readonly error: StorageCoreError;
      readonly metadata: null;
    };

/** Dynamic maintenance metadata is only truthful after locked discovery. */
export interface StorageMaintenanceTicket<T> {
  readonly completion: Promise<StorageMaintenanceCommitResult<T>>;
}

export interface StorageReservedCasFence {
  readonly key: string;
  readonly expectedRaw: string;
}

export interface StorageCoreOptions {
  /** Reserved schema marker that every non-empty durable app write must CAS. */
  readonly reservedFence?: StorageReservedCasFence;
  /** Additional internal keys that app drafts and clear predicates cannot access. */
  readonly reservedKeys?: readonly string[];
  /** Schedule a new locked snapshot when fenced state may have gone stale. */
  readonly requestAuthoritativeResync?: () => void;
}

type Setter<T> = T | ((previous: T) => T);

interface PlannedValue {
  readonly generation: number;
  readonly raw: string | null;
  readonly value: unknown;
  readonly removed: boolean;
  readonly completion: Promise<StorageCommitResult>;
}

interface DraftValue {
  beforeRaw: string | null;
  raw: string | null;
  value: unknown;
  removed: boolean;
  changed: boolean;
  publish: boolean;
  pendingDependency: boolean;
  writeIntent: boolean;
}

interface ClearRequest {
  readonly predicate: (key: string) => boolean;
  readonly finish: (result: StorageMaintenanceCommitResult<number>) => void;
}

interface AmbientTransaction {
  readonly draft: StorageTransactionDraft;
  readonly completion: Promise<StorageCommitResult>;
  readonly clearRequests: ClearRequest[];
  readonly holdUntil: (value: PromiseLike<unknown>) => void;
  readonly assertActive: () => void;
}

interface ClearComputationMetadata {
  readonly matchedKeys: readonly string[];
  readonly requestCounts: readonly number[];
}

export interface StorageTransactionDraft {
  read<T>(key: string, seed: T): T;
  update<T>(key: string, seed: T, next: Setter<T>): T;
  /** Replace a raw JSON value without decoding the existing value first. */
  set<T>(key: string, value: T): T;
  remove(key: string): void;
}

function boundedCause(error: unknown): string {
  try {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return text.slice(0, 500);
  } catch {
    return 'Unprintable thrown value';
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function')
    && typeof (value as { readonly then?: unknown }).then === 'function'
  );
}

function observeThenableSettlement(
  value: PromiseLike<unknown>,
  onSettled: () => void = () => undefined,
): void {
  try {
    // Async callbacks have already started by the time their return value can
    // be inspected. Observe any later rejection while the inactive draft
    // prevents their continuation from mutating the discarded transaction.
    void Promise.resolve(value).then(
      onSettled,
      onSettled,
    );
  } catch {
    // A hostile thenable must not escape the synchronous storage boundary.
    onSettled();
  }
}

function asynchronousTransactionError(): StorageCoreError {
  return {
    code: 'transaction_failed',
    message: 'Storage transaction callbacks must complete synchronously and must not return a Promise or thenable.',
  };
}

/**
 * Framework-free storage cache with synchronous functional-update resolution.
 *
 * Values are staged immediately so consecutive functional updaters resolve in
 * call order, but cache/listener publication happens only after the shared
 * crash-recoverable coordinator confirms a durable commit.
 */
export class StorageCore {
  private readonly cache = new Map<string, unknown>();
  private readonly cacheRaw = new Map<string, string>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly statusListeners = new Set<() => void>();
  private readonly planned = new Map<string, PlannedValue>();
  private readonly inFlight = new Set<Promise<StorageCommitResult>>();
  private readonly reservedFence: StorageReservedCasFence | null;
  private readonly reservedKeys: ReadonlySet<string>;
  private readonly requestAuthoritativeResync: (() => void) | null;
  private authoritativeSnapshotApplied = false;
  private generation = 0;
  private pending = 0;
  private localError: StorageCoreError | null = null;
  private schemaMismatch: StorageCoreError | null = null;
  private readonly dirtyErrors = new Map<string, StorageCoreError>();
  private ambient: AmbientTransaction | null = null;
  private statusSnapshot: StorageCoreStatus | null = null;

  constructor(
    private readonly backend: StorageBackend,
    private readonly coordinator: StorageTransactionCoordinator,
    options: StorageCoreOptions = {},
  ) {
    const fence = options.reservedFence;
    this.reservedFence = fence
      ? { key: fence.key, expectedRaw: fence.expectedRaw }
      : null;
    this.reservedKeys = new Set([
      STORAGE_TRANSACTION_JOURNAL_KEY,
      ...(options.reservedKeys ?? []),
      ...(fence ? [fence.key] : []),
    ]);
    this.requestAuthoritativeResync = options.requestAuthoritativeResync ?? null;
    coordinator.subscribe(() => this.emitStatus());
  }

  /** Read the last durably committed value. Pending values never leak to UI. */
  read<T>(key: string, seed: T): T {
    if (this.reservedKeys.has(key)) return seed;
    if (this.cache.has(key)) return this.cache.get(key) as T;
    // Once a future/different schema is observed, uncached backend values are
    // permanently quarantined. A hostile marker rollback must not reopen this
    // loaded core or expose values written by the incompatible schema.
    if (this.schemaMismatch) return seed;
    // Once boot/resync has supplied a complete locked snapshot, absence from
    // the cache is authoritative. Reading localStorage here could otherwise
    // mix a newly-created key with older cached siblings after a missed event.
    if (this.authoritativeSnapshotApplied) return seed;
    const coordinatorStatus = this.coordinator.getStatus();
    if (
      coordinatorStatus.initialized
      && (coordinatorStatus.dirty || coordinatorStatus.blocked)
    ) return seed;
    // A journal written by another tab can precede its storage event. Never
    // hydrate an uncached raw key while that journal may describe a partially
    // applied transaction; the sync controller will recover and republish a
    // locked snapshot.
    try {
      const journalRaw = this.backend.getItem(STORAGE_TRANSACTION_JOURNAL_KEY);
      const statusChanged = this.clearDirtyKeys([STORAGE_TRANSACTION_JOURNAL_KEY]);
      if (statusChanged) this.emitStatus();
      if (journalRaw !== null) return seed;
    } catch (error) {
      this.recordError({
        code: 'read_failed',
        message: 'The storage transaction journal could not be inspected safely.',
        key: STORAGE_TRANSACTION_JOURNAL_KEY,
        cause: boundedCause(error),
      }, true);
      return seed;
    }
    // Storage events are wakeups rather than a read barrier. Recheck the
    // durable marker on every cache miss so a missed/delayed event cannot let
    // newer-schema data hydrate synchronously before resync latches the fence.
    if (this.checkAuthoritativeFence()) return seed;
    let raw: string | null;
    try {
      raw = this.backend.getItem(key);
    } catch (error) {
      this.recordError({
        code: 'read_failed',
        message: `Unable to read ${JSON.stringify(key)} from browser storage.`,
        key,
        cause: boundedCause(error),
      }, true);
      return seed;
    }
    if (raw == null) {
      this.clearDirtyKeys([key]);
      return seed;
    }
    try {
      const parsed = JSON.parse(raw) as T;
      this.cache.set(key, parsed);
      this.cacheRaw.set(key, raw);
      this.clearDirtyKeys([key]);
      return parsed;
    } catch (error) {
      this.recordError({
        code: 'decode_failed',
        message: `Stored value ${JSON.stringify(key)} is not valid JSON.`,
        key,
        cause: boundedCause(error),
      }, true);
      return seed;
    }
  }

  update<T>(key: string, seed: T, next: Setter<T>): StorageTransactionTicket<T> {
    if (this.schemaMismatch) {
      return {
        value: this.cache.has(key) ? this.cache.get(key) as T : seed,
        completion: Promise.resolve(this.schemaBlockedResult()),
      };
    }
    if (this.ambient) {
      return {
        value: this.ambient.draft.update(key, seed, next),
        completion: this.ambient.completion,
      };
    }
    const fenceIssue = this.checkAuthoritativeFence();
    if (fenceIssue) {
      return {
        value: this.cache.has(key) ? this.cache.get(key) as T : seed,
        completion: Promise.resolve(this.fenceFailureResult(fenceIssue)),
      };
    }
    return this.transaction((draft) => draft.update(key, seed, next));
  }

  /**
   * Resolve updates synchronously, then commit them as one journal transaction.
   * Nested transactions join the outer draft; only the outer call writes, and
   * every nested ticket shares its completion. An uncaught nested error aborts
   * the outer draft before it is enqueued.
   */
  transaction<T>(work: (draft: StorageTransactionDraft) => T): StorageTransactionTicket<T> {
    if (this.schemaMismatch) {
      return {
        value: undefined as T,
        completion: Promise.resolve(this.schemaBlockedResult()),
      };
    }
    if (this.ambient) {
      const value = work(this.ambient.draft);
      if (isThenable(value)) {
        this.ambient.holdUntil(value);
        throw asynchronousTransactionError();
      }
      return { value, completion: this.ambient.completion };
    }
    const fenceIssue = this.checkAuthoritativeFence();
    if (fenceIssue) {
      return {
        value: undefined as T,
        completion: Promise.resolve(this.fenceFailureResult(fenceIssue)),
      };
    }

    const drafts = new Map<string, DraftValue>();
    const dependencies = new Set<Promise<StorageCommitResult>>();
    const clearRequests: ClearRequest[] = [];
    let finishAmbient!: (result: StorageCommitResult) => void;
    const ambientCompletion = new Promise<StorageCommitResult>((resolve) => {
      finishAmbient = resolve;
    });
    let draftActive = true;
    let heldThenables = 0;
    let callbackReturned = false;
    let asynchronousFailure: StorageCoreError | null = null;
    const assertDraftActive = (): void => {
      if (!draftActive) {
        throw new Error('This storage transaction draft is no longer active.');
      }
    };
    const assertWritableKey = (key: string): void => {
      if (!this.reservedKeys.has(key)) return;
      const issue: StorageCoreError = {
        code: 'transaction_failed',
        message: `Storage key ${JSON.stringify(key)} is reserved for schema compatibility checks.`,
        key,
      };
      this.recordError(issue);
      throw issue;
    };

    const getDraft = <V>(key: string, seed: V): DraftValue => {
      const existing = drafts.get(key);
      if (existing) return existing;
      const pending = this.planned.get(key);
      if (pending) {
        dependencies.add(pending.completion);
        let pendingValue: V = seed;
        if (!pending.removed && pending.raw !== null) {
          pendingValue = JSON.parse(pending.raw) as V;
        }
        const draft: DraftValue = {
          beforeRaw: pending.raw,
          raw: pending.raw,
          value: pendingValue,
          removed: pending.removed,
          changed: false,
          publish: false,
          pendingDependency: true,
          writeIntent: false,
        };
        drafts.set(key, draft);
        return draft;
      }

      let beforeRaw: string | null;
      if (this.reservedFence && this.authoritativeSnapshotApplied) {
        beforeRaw = this.cacheRaw.get(key) ?? null;
      } else {
        try {
          beforeRaw = this.backend.getItem(key);
        } catch (error) {
          const issue: StorageCoreError = {
            code: 'read_failed',
            message: `Unable to capture ${JSON.stringify(key)} before writing.`,
            key,
            cause: boundedCause(error),
          };
          this.recordError(issue, true);
          throw issue;
        }
      }
      let value: V = seed;
      if (beforeRaw !== null) {
        try {
          value = JSON.parse(beforeRaw) as V;
        } catch (error) {
          const issue: StorageCoreError = {
            code: 'decode_failed',
            message: `Stored value ${JSON.stringify(key)} is not valid JSON.`,
            key,
            cause: boundedCause(error),
          };
          this.recordError(issue, true);
          throw issue;
        }
      }
      if (!this.reservedFence) this.clearDirtyKeys([key]);
      // The backend value is authoritative for update calculation. If a
      // cross-tab event raced with this call, refresh every committed view
      // before resolving the updater and use this exact raw value for CAS.
      if (!this.reservedFence && (this.cacheRaw.get(key) ?? null) !== beforeRaw) {
        if (beforeRaw === null) {
          this.cache.delete(key);
          this.cacheRaw.delete(key);
        } else {
          // Keep the calculation draft and committed cache from sharing a
          // mutable object before durability is known.
          this.cache.set(key, JSON.parse(beforeRaw) as V);
          this.cacheRaw.set(key, beforeRaw);
        }
        this.emit(key);
      }
      const draft: DraftValue = {
        beforeRaw,
        raw: beforeRaw,
        value,
        removed: beforeRaw == null,
        changed: false,
        publish: false,
        pendingDependency: false,
        writeIntent: false,
      };
      drafts.set(key, draft);
      return draft;
    };

    const getRawDraft = (key: string): DraftValue => {
      const existing = drafts.get(key);
      if (existing) return existing;
      const pending = this.planned.get(key);
      if (pending) {
        dependencies.add(pending.completion);
        const draft: DraftValue = {
          beforeRaw: pending.raw,
          raw: pending.raw,
          value: pending.value,
          removed: pending.removed,
          changed: false,
          publish: false,
          pendingDependency: true,
          writeIntent: false,
        };
        drafts.set(key, draft);
        return draft;
      }
      let beforeRaw: string | null;
      if (this.reservedFence && this.authoritativeSnapshotApplied) {
        beforeRaw = this.cacheRaw.get(key) ?? null;
      } else {
        try {
          beforeRaw = this.backend.getItem(key);
        } catch (error) {
          const issue: StorageCoreError = {
            code: 'read_failed',
            message: `Unable to capture ${JSON.stringify(key)} before writing.`,
            key,
            cause: boundedCause(error),
          };
          this.recordError(issue, true);
          throw issue;
        }
      }
      const draft: DraftValue = {
        beforeRaw,
        raw: beforeRaw,
        value: undefined,
        removed: beforeRaw === null,
        changed: false,
        publish: false,
        pendingDependency: false,
        writeIntent: false,
      };
      drafts.set(key, draft);
      return draft;
    };

    const serialize = <V>(key: string, value: V): { readonly raw: string; readonly snapshot: V } => {
      let raw: string | undefined;
      try {
        raw = JSON.stringify(value);
      } catch (error) {
        const issue: StorageCoreError = {
          code: 'encode_failed',
          message: `Value for ${JSON.stringify(key)} cannot be serialized.`,
          key,
          cause: boundedCause(error),
        };
        this.recordError(issue);
        throw issue;
      }
      if (raw === undefined) {
        const issue: StorageCoreError = {
          code: 'encode_failed',
          message: `Value for ${JSON.stringify(key)} cannot be serialized.`,
          key,
        };
        this.recordError(issue);
        throw issue;
      }
      // Publish a detached canonical value. Callers may mutate their input
      // immediately after set/update returns, but that must not alter either
      // the planned value or the cache eventually published after commit.
      return { raw, snapshot: JSON.parse(raw) as V };
    };

    const api: StorageTransactionDraft = {
      read: <V>(key: string, seed: V): V => {
        assertDraftActive();
        assertWritableKey(key);
        const draft = getDraft(key, seed);
        return draft.removed ? seed : draft.value as V;
      },
      update: <V>(key: string, seed: V, next: Setter<V>): V => {
        assertDraftActive();
        assertWritableKey(key);
        const draft = getDraft(key, seed);
        draft.writeIntent = true;
        // An absent key semantically reads as its seed, but the seed is not a
        // stored value. Give functional updaters a detached snapshot and keep
        // the key absent when their result serializes back to that baseline.
        const missingBaseline = draft.removed ? serialize(key, seed) : null;
        const previous = missingBaseline ? missingBaseline.snapshot : draft.value as V;
        const resolved = typeof next === 'function'
          ? (next as (value: V) => V)(previous)
          : next;
        if (isThenable(resolved)) {
          ambient.holdUntil(resolved);
          throw asynchronousTransactionError();
        }
        const { raw, snapshot } = serialize(key, resolved);
        if (missingBaseline && raw === missingBaseline.raw) {
          draft.raw = null;
          draft.value = undefined;
          draft.removed = true;
          draft.changed = draft.beforeRaw !== null;
          draft.publish = (
            draft.changed
            || this.cache.has(key)
            || this.cacheRaw.has(key)
            || this.dirtyErrors.has(key)
          );
          return resolved;
        }
        draft.value = snapshot;
        draft.raw = raw;
        draft.removed = false;
        draft.changed = raw !== draft.beforeRaw;
        draft.publish = (
          draft.changed
          || !this.cache.has(key)
          || this.cacheRaw.get(key) !== raw
          || this.dirtyErrors.has(key)
        );
        return resolved;
      },
      set: <V>(key: string, value: V): V => {
        assertDraftActive();
        assertWritableKey(key);
        const draft = getRawDraft(key);
        const { raw, snapshot } = serialize(key, value);
        draft.writeIntent = true;
        draft.value = snapshot;
        draft.raw = raw;
        draft.removed = false;
        draft.changed = raw !== draft.beforeRaw;
        draft.publish = (
          draft.changed
          || !this.cache.has(key)
          || this.cacheRaw.get(key) !== raw
          || this.dirtyErrors.has(key)
        );
        return value;
      },
      remove: (key: string): void => {
        assertDraftActive();
        assertWritableKey(key);
        const draft = getRawDraft(key);
        draft.writeIntent = true;
        draft.raw = null;
        draft.value = undefined;
        draft.removed = true;
        draft.changed = draft.beforeRaw !== null;
        draft.publish = (
          draft.changed
          || this.cache.has(key)
          || this.cacheRaw.has(key)
          || this.dirtyErrors.has(key)
        );
      },
    };

    const holdUntil = (thenable: PromiseLike<unknown>): void => {
      asynchronousFailure ??= asynchronousTransactionError();
      heldThenables += 1;
      this.pending += 1;
      this.emitStatus();
      observeThenableSettlement(thenable, () => {
        heldThenables = Math.max(0, heldThenables - 1);
        this.pending = Math.max(0, this.pending - 1);
        if (callbackReturned && heldThenables === 0 && this.ambient === ambient) {
          this.ambient = null;
        }
        this.emitStatus();
      });
    };
    const ambient: AmbientTransaction = {
      draft: api,
      completion: ambientCompletion,
      clearRequests,
      holdUntil,
      assertActive: assertDraftActive,
    };
    this.ambient = ambient;

    let value: T;
    try {
      value = work(api);
      if (isThenable(value)) {
        ambient.holdUntil(value);
        throw asynchronousTransactionError();
      }
      if (asynchronousFailure) throw asynchronousFailure;
    } catch (error) {
      const coreError = this.normalizeCoreError(error);
      const issue = coreError
        ? coreError
        : {
            code: 'transaction_failed' as const,
            message: 'The storage transaction callback failed.',
            cause: boundedCause(error),
          };
      this.recordError(issue);
      const failed = { ok: false, outcome: 'rejected', transactionId: null, error: issue } as const;
      for (const request of clearRequests) request.finish({ ...failed, metadata: null });
      finishAmbient(failed);
      return { value: undefined as T, completion: ambientCompletion };
    } finally {
      draftActive = false;
      callbackReturned = true;
      if (heldThenables === 0 && this.ambient === ambient) this.ambient = null;
    }

    const changed = [...drafts.entries()].filter(([, draft]) => draft.changed);
    const publishable = [...drafts.entries()].filter(([, draft]) => (
      draft.publish && (!draft.pendingDependency || draft.changed)
    ));
    const fencedWriteVerifications = this.reservedFence
      ? [...drafts.entries()].filter(([, draft]) => draft.writeIntent && !draft.changed)
      : [];
    if (
      changed.length === 0
      && clearRequests.length === 0
      && fencedWriteVerifications.length === 0
    ) {
      const noOpFenceIssue = this.checkAuthoritativeFence();
      if (noOpFenceIssue) {
        const failed = this.fenceFailureResult(noOpFenceIssue);
        finishAmbient(failed);
        return { value: undefined as T, completion: ambientCompletion };
      }
      // Fenced browser state is publishable only from a locked snapshot or a
      // confirmed commit. A no-op based on stale/raw state must not repair the
      // cache outside the cross-tab lock.
      const statusChanged = this.reservedFence
        ? false
        : this.publishDrafts(publishable);
      if (this.reservedFence) this.scheduleAuthoritativeResync();
      if (statusChanged) this.emitStatus();
      if (dependencies.size === 0) {
        finishAmbient({ ok: true, outcome: 'unchanged', transactionId: null });
        return { value, completion: ambientCompletion };
      }
      if (dependencies.size === 1) {
        void ([...dependencies][0] as Promise<StorageCommitResult>).then(finishAmbient);
        return { value, completion: ambientCompletion };
      }
      const dependencyCompletion = Promise.all([...dependencies]).then((results): StorageCommitResult => (
        results.find(result => !result.ok)
        ?? { ok: true, outcome: 'unchanged', transactionId: null }
      ));
      void dependencyCompletion.then(finishAmbient);
      return { value, completion: ambientCompletion };
    }

    const generation = ++this.generation;
    // Every value read by a mutating transaction is part of its decision, not
    // just values produced by preceding queued writes. Preserve read-only
    // dependencies as compare-and-set no-ops so another tab cannot invalidate
    // validation between the synchronous callback and the locked commit.
    const guarded = [...drafts.entries()].filter(([, draft]) => !draft.changed);
    const fixedMutations: ConditionalStorageMutation[] = [...guarded, ...changed].map(([key, draft]) => ({
      key,
      value: draft.raw,
      expected: draft.beforeRaw,
    }));
    const fencedFixedMutations: ConditionalStorageMutation[] = this.reservedFence
      ? [
          {
            key: this.reservedFence.key,
            value: this.reservedFence.expectedRaw,
            expected: this.reservedFence.expectedRaw,
          },
          ...fixedMutations,
        ]
      : fixedMutations;
    // Capture both volatile sources before advertising this transaction's
    // fixed writes. The provider uses these snapshots only after it owns the
    // coordinator's FIFO lock, so a preceding queued write cannot introduce a
    // key between enumeration and the journal snapshot.
    const cachedKeys = new Set([...this.cache.keys(), ...this.cacheRaw.keys()]);
    const precedingPlanned = new Map(this.planned);
    const predicates = clearRequests.map(request => request.predicate);
    for (const [key, draft] of changed) {
      this.planned.set(key, {
        generation,
        raw: draft.raw,
        value: draft.value,
        removed: draft.removed,
        completion: ambientCompletion,
      });
    }

    this.pending += 1;
    this.emitStatus();
    let providerIssue: StorageCoreError | null = null;
    let transactionCompletion: Promise<StorageTransactionResult | StorageComputedTransactionResult<ClearComputationMetadata>>;
    if (clearRequests.length > 0) {
      try {
        const transactComputed = this.coordinator.transactComputed;
        if (typeof transactComputed !== 'function') {
          throw new Error('The storage coordinator does not support locked computed transactions.');
        }
        transactionCompletion = Promise.resolve(transactComputed.call(this.coordinator, () => {
            try {
              const durableKeys = this.backend.keys();
              if (!Array.isArray(durableKeys) || durableKeys.some(key => typeof key !== 'string')) {
                throw new Error('The storage backend returned an invalid key list.');
              }

              const candidates = new Set<string>([
                ...durableKeys,
                ...cachedKeys,
                ...precedingPlanned.keys(),
                ...fixedMutations.map(mutation => mutation.key),
              ]);
              const mutations = new Map<string, ConditionalStorageMutation>(
                fixedMutations.map(mutation => [mutation.key, mutation]),
              );
              const matchedKeys: string[] = [];
              const requestCounts = predicates.map(() => 0);

              for (const key of candidates) {
                if (this.reservedKeys.has(key)) continue;
                const matchingRequests = predicates.map((predicate) => {
                  const matches = predicate(key);
                  if (isThenable(matches)) {
                    observeThenableSettlement(matches);
                    throw new Error('Storage clear predicates must complete synchronously.');
                  }
                  if (typeof matches !== 'boolean') {
                    throw new Error('Storage clear predicates must return a boolean synchronously.');
                  }
                  return matches;
                });
                if (!matchingRequests.some(Boolean)) continue;

                const currentRaw = this.backend.getItem(key);
                matchedKeys.push(key);
                if (currentRaw !== null) {
                  matchingRequests.forEach((matches, index) => {
                    if (matches) requestCounts[index] += 1;
                  });
                }

                const fixed = mutations.get(key);
                if (fixed) {
                  mutations.set(key, { ...fixed, value: null });
                  continue;
                }

                const planned = precedingPlanned.get(key);
                // A durable value needs a removal. A preceding planned value
                // also needs its CAS guard even when its write failed and the
                // currently observed value is absent.
                if (currentRaw !== null || (planned && planned.raw !== null)) {
                  mutations.set(key, {
                    key,
                    value: null,
                    expected: planned ? planned.raw : currentRaw,
                  });
                }
              }

              if (mutations.size > 0 && this.reservedFence) {
                if (mutations.size >= MAX_TRANSACTION_OPERATIONS) {
                  providerIssue = {
                    code: 'transaction_failed',
                    message: `A fenced storage transaction may change at most ${MAX_TRANSACTION_OPERATIONS - 1} app keys.`,
                  };
                  throw providerIssue;
                }
              }

              return {
                mutations: mutations.size > 0 && this.reservedFence
                  ? [{
                      key: this.reservedFence.key,
                      value: this.reservedFence.expectedRaw,
                      expected: this.reservedFence.expectedRaw,
                    }, ...mutations.values()]
                  : [...mutations.values()],
                metadata: { matchedKeys, requestCounts },
              };
            } catch (error) {
              providerIssue ??= {
                code: 'enumerate_failed',
                message: 'Unable to enumerate browser storage keys.',
                cause: boundedCause(error),
              };
              throw error;
            }
        }) as Promise<StorageComputedTransactionResult<ClearComputationMetadata>>);
      } catch (error) {
        transactionCompletion = Promise.reject(error);
      }
    } else {
      try {
        transactionCompletion = Promise.resolve(this.coordinator.transact(fencedFixedMutations));
      } catch (error) {
        transactionCompletion = Promise.reject(error);
      }
    }

    const finishClearRequests = (
      result: StorageTransactionResult | StorageComputedTransactionResult<ClearComputationMetadata> | StorageCommitResult,
    ): void => {
      if (clearRequests.length === 0) return;
      if (result.ok && 'metadata' in result) {
        clearRequests.forEach((request, index) => {
          request.finish({ ...result, metadata: result.metadata.requestCounts[index] ?? 0 });
        });
        return;
      }
      if (!result.ok) {
        clearRequests.forEach(request => request.finish({ ...result, metadata: null }));
      }
    };

    const completion = transactionCompletion.then((result): StorageCommitResult => {
      if (result.ok) {
        if (clearRequests.length > 0 && !('metadata' in result)) {
          throw new Error('The computed storage coordinator omitted clear metadata.');
        }
        const matchedKeys = 'metadata' in result ? result.metadata.matchedKeys : [];
        this.publishDrafts(publishable, matchedKeys);
      } else {
        if (providerIssue) {
          this.recordError(providerIssue);
          const rejected = {
            ok: false,
            outcome: 'rejected',
            transactionId: null,
            error: providerIssue,
          } as const;
          if (this.reservedFence) this.scheduleAuthoritativeResync();
          else this.reconcileCommitted(changed.map(([key]) => key));
          return rejected;
        }
        if (
          this.reservedFence
          && result.error.code === 'precondition_failed'
          && result.error.key === this.reservedFence.key
        ) {
          const issue = this.blockSchemaMismatch(result.error);
          return {
            ok: false,
            outcome: 'blocked',
            transactionId: null,
            error: issue,
          };
        }
        const issue: StorageCoreError = {
          code: 'transaction_failed',
          message: result.error.message,
          key: result.error.key,
          kernelError: result.error,
        };
        this.recordError(issue);
        if (this.reservedFence) {
          this.scheduleAuthoritativeResync();
        } else if (result.outcome === 'rejected' || result.outcome === 'rolled-back') {
          const discovered = 'metadata' in result && result.metadata !== null
            ? result.metadata.matchedKeys
            : [];
          this.reconcileCommitted([...new Set([...changed.map(([key]) => key), ...discovered])]);
        }
      }
      return result;
    }).catch((error: unknown): StorageCommitResult => {
      const issue: StorageCoreError = providerIssue ?? {
          code: 'transaction_failed',
          message: 'The storage coordinator rejected unexpectedly.',
          cause: boundedCause(error),
      };
      this.recordError(issue);
      if (this.reservedFence) this.scheduleAuthoritativeResync();
      const rejected = { ok: false, outcome: 'rejected', transactionId: null, error: issue } as const;
      return rejected;
    }).finally(() => {
      for (const [key] of changed) {
        if (this.planned.get(key)?.generation === generation) this.planned.delete(key);
      }
      this.pending = Math.max(0, this.pending - 1);
      this.emitStatus();
    });

    void completion.then((result) => {
      finishClearRequests(result);
      finishAmbient(result);
    });
    this.inFlight.add(ambientCompletion);
    void ambientCompletion.then(() => { this.inFlight.delete(ambientCompletion); });

    return { value, completion: ambientCompletion };
  }

  /** Wait for every write queued before/during this call to settle. */
  async flush(): Promise<StorageCoreStatus> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
    return this.getStatus();
  }

  subscribe(key: string, listener: () => void): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) this.listeners.delete(key);
    };
  }

  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  getStatus(): StorageCoreStatus {
    const status = this.coordinator.getStatus();
    let dirtyError: StorageCoreError | null = null;
    for (const error of this.dirtyErrors.values()) dirtyError = error;
    const previous = this.statusSnapshot;
    const coordinatorError = status.lastError
      ? previous?.lastError?.kernelError === status.lastError
        ? previous.lastError
        : {
            code: 'transaction_failed' as const,
            message: status.lastError.message,
            key: status.lastError.key,
            kernelError: status.lastError,
          }
      : null;
    const next: StorageCoreStatus = {
      pending: Math.max(status.pending, this.pending),
      dirty: (
        status.dirty
        || this.schemaMismatch !== null
        || this.dirtyErrors.size > 0
        || this.pending > 0
        || this.planned.size > 0
      ),
      coordinatorDirty: status.dirty,
      blocked: status.blocked || this.schemaMismatch !== null,
      initialized: status.initialized,
      phase: status.phase,
      transactionId: status.transactionId,
      lastError: this.schemaMismatch ?? dirtyError ?? this.localError ?? coordinatorError,
    };
    if (
      previous
      && previous.pending === next.pending
      && previous.dirty === next.dirty
      && previous.coordinatorDirty === next.coordinatorDirty
      && previous.blocked === next.blocked
      && previous.initialized === next.initialized
      && previous.phase === next.phase
      && previous.transactionId === next.transactionId
      && previous.lastError === next.lastError
    ) return previous;
    this.statusSnapshot = next;
    return next;
  }

  /** Apply a durable change announced by another tab. */
  applyExternal(key: string, raw: string | null): void {
    this.applyExternalBatch(new Map([[key, raw]]));
  }

  /**
   * Publish a journaled change from another tab as one cache snapshot. Every
   * value is decoded and every cache entry is replaced before any key listener
   * runs, matching the visibility guarantee of a local atomic transaction.
   */
  applyExternalBatch(batch: ReadonlyMap<string, string | null>): boolean {
    if (this.schemaMismatch) return false;
    const fence = this.reservedFence;
    const fenceIssue = this.checkAuthoritativeFence();
    if (fenceIssue) return false;
    let observedFence: string | null | undefined;
    try {
      if (fence && batch.has(fence.key)) observedFence = batch.get(fence.key) ?? null;
    } catch (error) {
      this.recordError({
        code: 'read_failed',
        message: 'An external storage batch could not be inspected safely.',
        ...(fence ? { key: fence.key } : {}),
        cause: boundedCause(error),
      }, true);
      return false;
    }
    if (fence && observedFence !== undefined && observedFence !== fence.expectedRaw) {
      this.blockSchemaMismatch(undefined, observedFence);
      return false;
    }

    let entries: Array<readonly [string, string | null]>;
    try {
      entries = [...batch];
    } catch (error) {
      this.recordError({
        code: 'read_failed',
        message: 'An external storage batch could not be enumerated safely.',
        cause: boundedCause(error),
      }, true);
      return false;
    }
    let statusChanged = fence ? this.clearDirtyKeys([fence.key]) : false;
    const prepared = entries
      .filter(([key]) => !this.reservedKeys.has(key))
      .map(([key, raw]) => {
        if (raw === null) return { key, raw, value: undefined, error: null };
        try {
          return { key, raw, value: JSON.parse(raw) as unknown, error: null };
        } catch (error) {
          const issue: StorageCoreError = {
            code: 'decode_failed',
            message: `External value ${JSON.stringify(key)} is not valid JSON.`,
            key,
            cause: boundedCause(error),
          };
          return { key, raw, value: undefined, error: issue };
        }
      });
    statusChanged = this.clearDirtyKeys(prepared.map(({ key }) => key)) || statusChanged;

    for (const { key, raw, value, error } of prepared) {
      if (raw === null) {
        this.cache.delete(key);
        this.cacheRaw.delete(key);
      } else if (error) {
        // Keep the exact corrupt bytes as a CAS baseline. Parsed consumers see
        // absence, while a raw set/remove can still repair the included key.
        this.cache.delete(key);
        this.cacheRaw.set(key, raw);
      } else {
        this.cache.set(key, value);
        this.cacheRaw.set(key, raw);
      }
      if (error) {
        this.localError = error;
        this.dirtyErrors.set(key, error);
        statusChanged = true;
      }
    }

    for (const { key } of prepared) this.emit(key);
    if (statusChanged) this.emitStatus();
    return true;
  }

  /** Replace all cached app keys from one locked durable snapshot. */
  applyExternalSnapshot(snapshot: ReadonlyMap<string, string>): boolean {
    if (this.schemaMismatch) return false;
    const previouslyApplied = this.authoritativeSnapshotApplied;
    // Set this before listener publication so a listener cannot hydrate a key
    // absent from this complete snapshot directly from an unlocked backend.
    this.authoritativeSnapshotApplied = true;
    const complete = new Map<string, string | null>(snapshot);
    const knownKeys = new Set([
      ...this.cache.keys(),
      ...this.cacheRaw.keys(),
      ...this.dirtyErrors.keys(),
    ]);
    for (const key of knownKeys) {
      if (key.startsWith('gc.') && !this.reservedKeys.has(key) && !complete.has(key)) {
        complete.set(key, null);
      }
    }
    const applied = this.applyExternalBatch(complete);
    if (!applied) this.authoritativeSnapshotApplied = previouslyApplied;
    else {
      const statusChanged = this.clearDirtyKeys([STORAGE_TRANSACTION_JOURNAL_KEY]);
      if (statusChanged) this.emitStatus();
    }
    return applied;
  }

  clearMatching(predicate: (key: string) => boolean): StorageMaintenanceTicket<number> {
    if (this.schemaMismatch) {
      const blocked = this.schemaBlockedResult();
      if (blocked.ok) throw new Error('Unreachable schema fence state.');
      return { completion: Promise.resolve({ ...blocked, metadata: null }) };
    }
    const register = (): StorageMaintenanceTicket<number> => {
      const ambient = this.ambient;
      if (!ambient) throw new Error('A clear request requires an active storage transaction.');
      ambient.assertActive();
      let finish!: (result: StorageMaintenanceCommitResult<number>) => void;
      const completion = new Promise<StorageMaintenanceCommitResult<number>>((resolve) => {
        finish = resolve;
      });
      ambient.clearRequests.push({ predicate, finish });
      return { completion };
    };

    if (this.ambient) return register();

    let maintenance!: StorageMaintenanceTicket<number>;
    this.transaction(() => {
      maintenance = register();
    });
    return maintenance;
  }

  /** Test-only: clear volatile state; does not mutate durable storage. */
  reset(): void {
    this.cache.clear();
    this.cacheRaw.clear();
    this.listeners.clear();
    this.statusListeners.clear();
    this.planned.clear();
    this.inFlight.clear();
    this.pending = 0;
    this.localError = null;
    this.schemaMismatch = null;
    this.authoritativeSnapshotApplied = false;
    this.dirtyErrors.clear();
    this.statusSnapshot = null;
    this.ambient = null;
  }

  private emit(key: string): void {
    const listeners = this.listeners.get(key);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        this.localError = {
          code: 'listener_failed',
          message: `A storage listener for ${JSON.stringify(key)} failed.`,
          key,
          cause: boundedCause(error),
        };
        this.emitStatus();
      }
    }
  }

  private emitStatus(): void {
    for (const listener of [...this.statusListeners]) {
      try { listener(); } catch { /* consumers cannot corrupt storage state */ }
    }
  }

  private recordError(error: StorageCoreError, dirty = false): void {
    this.localError = error;
    if (dirty) {
      const dirtyKey = error.key ?? '*';
      this.dirtyErrors.delete(dirtyKey);
      this.dirtyErrors.set(dirtyKey, error);
    }
    this.emitStatus();
  }

  private scheduleAuthoritativeResync(): void {
    try { this.requestAuthoritativeResync?.(); }
    catch { /* a sync hook cannot weaken the preserved cache snapshot */ }
  }

  private reconcileCommitted(keys: readonly string[]): void {
    const refreshed = new Map<string, { raw: string | null; value?: unknown }>();
    for (const key of keys) {
      try {
        const raw = this.backend.getItem(key);
        if (raw === null) {
          refreshed.set(key, { raw });
        } else {
          refreshed.set(key, { raw, value: JSON.parse(raw) as unknown });
        }
      } catch (error) {
        this.recordError({
          code: 'read_failed',
          message: `Unable to reconcile ${JSON.stringify(key)} after a failed transaction.`,
          key,
          cause: boundedCause(error),
        }, true);
        return;
      }
    }

    for (const [key, state] of refreshed) {
      if (state.raw === null) {
        this.cache.delete(key);
        this.cacheRaw.delete(key);
      } else {
        this.cache.set(key, state.value);
        this.cacheRaw.set(key, state.raw);
      }
    }
    this.clearDirtyKeys([...refreshed.keys()]);
    for (const key of refreshed.keys()) this.emit(key);
  }

  /** Publish one atomic cache snapshot, with removals winning fixed drafts. */
  private publishDrafts(
    entries: readonly (readonly [string, DraftValue])[],
    removedKeys: readonly string[] = [],
  ): boolean {
    const publications = new Map(entries);
    for (const key of removedKeys) publications.delete(key);

    for (const [key, draft] of publications) {
      if (draft.removed) {
        this.cache.delete(key);
        this.cacheRaw.delete(key);
      } else {
        this.cache.set(key, draft.value);
        this.cacheRaw.set(key, draft.raw as string);
      }
    }
    for (const key of removedKeys) {
      this.cache.delete(key);
      this.cacheRaw.delete(key);
    }

    const keys = [...new Set([...publications.keys(), ...removedKeys])];
    const statusChanged = this.clearDirtyKeys(keys);
    // A listener for any key in an atomic transaction must observe every
    // committed cache entry, never a half-published snapshot.
    for (const key of keys) this.emit(key);
    return statusChanged;
  }

  private clearDirtyKeys(keys: readonly string[]): boolean {
    const resolved = new Set(keys);
    let changed = false;
    for (const key of resolved) {
      if (this.dirtyErrors.delete(key)) changed = true;
    }
    if (
      this.localError?.key !== undefined
      && resolved.has(this.localError.key)
      && (this.localError.code === 'read_failed' || this.localError.code === 'decode_failed')
    ) {
      this.localError = null;
      changed = true;
    }
    return changed;
  }

  private schemaBlockedResult(): {
    readonly ok: false;
    readonly outcome: 'blocked';
    readonly transactionId: null;
    readonly error: StorageCoreError;
  } {
    const error = this.schemaMismatch;
    if (!error) throw new Error('Storage schema is not blocked.');
    return { ok: false, outcome: 'blocked', transactionId: null, error };
  }

  private fenceFailureResult(error: StorageCoreError): StorageCommitResult {
    return {
      ok: false,
      outcome: error.code === 'schema_mismatch' ? 'blocked' : 'rejected',
      transactionId: null,
      error,
    };
  }

  /** Synchronous preflight; the identical guard is still checked atomically by the coordinator. */
  private checkAuthoritativeFence(): StorageCoreError | null {
    if (this.schemaMismatch) return this.schemaMismatch;
    const fence = this.reservedFence;
    if (!fence) return null;
    let observedRaw: string | null;
    try {
      observedRaw = this.backend.getItem(fence.key);
    } catch (error) {
      const issue: StorageCoreError = {
        code: 'read_failed',
        message: 'The storage schema marker could not be read safely.',
        key: fence.key,
        cause: boundedCause(error),
      };
      this.recordError(issue, true);
      return issue;
    }
    if (observedRaw !== fence.expectedRaw) {
      return this.blockSchemaMismatch(undefined, observedRaw);
    }
    if (this.clearDirtyKeys([fence.key])) this.emitStatus();
    return null;
  }

  private blockSchemaMismatch(
    kernelError?: StorageKernelError,
    observedRaw?: string | null,
  ): StorageCoreError {
    if (this.schemaMismatch) return this.schemaMismatch;
    const fence = this.reservedFence;
    const issue: StorageCoreError = {
      code: 'schema_mismatch',
      message: 'Local data now uses a different storage schema. Reload this app before making more changes.',
      ...(fence ? { key: fence.key } : {}),
      ...(observedRaw === undefined
        ? {}
        : {
            cause: `Expected ${JSON.stringify(fence?.expectedRaw ?? null)} but observed ${JSON.stringify(observedRaw)}`
              .slice(0, 500),
          }),
      ...(kernelError ? { kernelError } : {}),
    };
    this.schemaMismatch = issue;
    this.localError = issue;
    this.emitStatus();
    return issue;
  }

  private normalizeCoreError(error: unknown): StorageCoreError | null {
    if (typeof error !== 'object' || error === null) return null;
    try {
      const candidate = error as Partial<StorageCoreError>;
      const code = candidate.code;
      const message = candidate.message;
      if (
        typeof message !== 'string'
        || (
          code !== 'read_failed'
          && code !== 'decode_failed'
          && code !== 'encode_failed'
          && code !== 'enumerate_failed'
          && code !== 'schema_mismatch'
          && code !== 'transaction_failed'
          && code !== 'listener_failed'
        )
      ) return null;

      const key = typeof candidate.key === 'string' ? candidate.key : undefined;
      const cause = typeof candidate.cause === 'string' ? candidate.cause : undefined;
      return { code, message, ...(key ? { key } : {}), ...(cause ? { cause } : {}) };
    } catch {
      // Error classification must never execute traps from a hostile thrown
      // value outside the transaction boundary.
      return null;
    }
  }
}
