import {
  decodeStorageJournal,
  isValidTransactionId,
  MAX_JOURNAL_RAW_LENGTH,
  serializeStorageJournal,
  snapshotStorageMutations,
  type ValidatedStorageMutation,
} from './journal';
import {
  STORAGE_TRANSACTION_JOURNAL_KEY,
  STORAGE_TRANSACTION_JOURNAL_KIND,
  STORAGE_TRANSACTION_JOURNAL_VERSION,
  type RawAsyncKeyValue,
  type StorageCoordinatorOptions,
  type StorageCoordinatorStatus,
  type StorageErrorStage,
  type StorageExclusiveLock,
  type StorageKernelError,
  type StorageMutation,
  type StorageRecoveryResult,
  type StorageStatusListener,
  type StorageTransactionCoordinator,
  type StorageTransactionJournalV1,
  type StorageTransactionResult,
} from './types';

type Fallible<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: StorageKernelError };
type MarkerState = 'absent' | 'present' | 'different' | 'unknown';
type ClearResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: StorageKernelError; readonly markerState: MarkerState };

let defaultTransactionCounter = 0;
const defaultTransactionNonce = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);

function createDefaultTransactionId(): string {
  defaultTransactionCounter = (defaultTransactionCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `tx-${Date.now().toString(36)}-${defaultTransactionNonce}-${defaultTransactionCounter.toString(36)}`;
}

function describeCause(cause: unknown): string {
  let description = 'Unknown failure';
  try {
    description = String(cause instanceof Error ? cause.message : cause);
  } catch {
    // Hostile thrown values can fail string conversion.
  }
  return description.slice(0, 240);
}

function storageError(
  code: StorageKernelError['code'],
  stage: StorageErrorStage,
  message: string,
  options: { readonly transactionId?: string; readonly key?: string; readonly cause?: unknown } = {},
): StorageKernelError {
  return {
    code,
    stage,
    message,
    ...(options.transactionId === undefined ? {} : { transactionId: options.transactionId }),
    ...(options.key === undefined ? {} : { key: options.key }),
    ...(options.cause === undefined ? {} : { cause: describeCause(options.cause) }),
  };
}

function snapshotMutations(mutations: readonly StorageMutation[]): Fallible<readonly ValidatedStorageMutation[]> {
  const snapshot = snapshotStorageMutations(mutations);
  return snapshot.ok
    ? { ok: true, value: snapshot.mutations }
    : {
        ok: false,
        error: storageError('invalid_operations', 'validate', snapshot.message),
      };
}

class Coordinator implements StorageTransactionCoordinator {
  private readonly store: RawAsyncKeyValue;
  private readonly withExclusiveLock: StorageExclusiveLock;
  private readonly createTransactionId: () => string;
  private readonly listeners = new Set<StorageStatusListener>();
  private queueTail: Promise<void> = Promise.resolve();
  private status: StorageCoordinatorStatus = {
    pending: 0,
    dirty: true,
    blocked: true,
    initialized: false,
    phase: 'idle',
    transactionId: null,
    lastError: null,
  };

  constructor(store: RawAsyncKeyValue, options: StorageCoordinatorOptions) {
    this.store = store;
    this.withExclusiveLock = options.withExclusiveLock ?? (async <T>(work: () => Promise<T>) => work());
    this.createTransactionId = options.createTransactionId ?? createDefaultTransactionId;
  }

  getStatus(): StorageCoordinatorStatus {
    return { ...this.status };
  }

  subscribe(listener: StorageStatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  recover(): Promise<StorageRecoveryResult> {
    return this.enqueue(async () => {
      try {
        return await this.withExclusiveLock(() => this.recoverLocked());
      } catch (cause) {
        const error = storageError('lock_failed', 'lock', 'The exclusive storage lock failed during recovery.', {
          cause,
        });
        this.updateStatus({
          dirty: true,
          blocked: true,
          phase: 'idle',
          transactionId: null,
          lastError: error,
        });
        return { ok: false, outcome: 'blocked', transactionId: null, error };
      }
    });
  }

  transact(mutations: readonly StorageMutation[]): Promise<StorageTransactionResult> {
    const snapshot = snapshotMutations(mutations);
    return this.enqueue(async () => {
      if (!snapshot.ok) {
        this.updateStatus({ lastError: snapshot.error });
        return {
          ok: false,
          outcome: 'rejected',
          transactionId: null,
          error: snapshot.error,
        };
      }

      try {
        return await this.withExclusiveLock(() => this.transactLocked(snapshot.value));
      } catch (cause) {
        const error = storageError('lock_failed', 'lock', 'The exclusive storage lock failed during a transaction.', {
          cause,
        });
        this.updateStatus({
          dirty: true,
          blocked: true,
          phase: 'idle',
          transactionId: null,
          lastError: error,
        });
        return { ok: false, outcome: 'indeterminate', transactionId: null, error };
      }
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    this.updateStatus({ pending: this.status.pending + 1 });
    const scheduled = this.queueTail.then(work, work);
    this.queueTail = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled.finally(() => {
      this.updateStatus({ pending: Math.max(0, this.status.pending - 1) });
    });
  }

  private async recoverLocked(): Promise<StorageRecoveryResult> {
    this.updateStatus({
      phase: 'recovery',
      dirty: true,
      blocked: true,
      transactionId: null,
      lastError: null,
    });

    const marker = await this.readRaw(STORAGE_TRANSACTION_JOURNAL_KEY, 'inspect-journal');
    if (!marker.ok) {
      this.finishBlocked(marker.error, null);
      return { ok: false, outcome: 'blocked', transactionId: null, error: marker.error };
    }
    if (marker.value === null) {
      this.finishClean(null);
      return { ok: true, outcome: 'clean', transactionId: null };
    }

    const decoded = decodeStorageJournal(marker.value);
    if (!decoded.ok) {
      const error = storageError('journal_corrupt', 'decode-journal', decoded.message);
      this.finishBlocked(error, null);
      return { ok: false, outcome: 'blocked', transactionId: null, error };
    }

    const { journal } = decoded;
    const transactionId = journal.transactionId;
    this.updateStatus({ transactionId });

    let forwardError: StorageKernelError | null = null;
    for (const operation of journal.operations) {
      const current = await this.readRaw(operation.key, 'inspect-recovery', transactionId);
      if (!current.ok) {
        this.finishBlocked(current.error, transactionId);
        return { ok: false, outcome: 'blocked', transactionId, error: current.error };
      }
      if (current.value !== operation.before && current.value !== operation.after) {
        const error = storageError(
          'recovery_conflict',
          'inspect-recovery',
          'A journaled key diverged from both its before- and after-image; recovery was not attempted.',
          { transactionId, key: operation.key },
        );
        this.finishBlocked(error, transactionId);
        return { ok: false, outcome: 'blocked', transactionId, error };
      }
    }

    if (forwardError === null) {
      forwardError = await this.applyOperations(journal, 'forward');
    }

    if (forwardError === null) {
      const cleared = await this.clearAndVerifyJournal(marker.value, transactionId);
      if (cleared.ok) {
        this.finishClean(null);
        return { ok: true, outcome: 'recovered-forward', transactionId };
      }
      if (cleared.markerState === 'absent') {
        this.finishClean(null);
        return { ok: true, outcome: 'recovered-forward', transactionId };
      }
      if (cleared.markerState !== 'present') {
        this.finishBlocked(cleared.error, transactionId);
        return { ok: false, outcome: 'blocked', transactionId, error: cleared.error };
      }
      forwardError = cleared.error;
    }

    const rollback = await this.rollbackWithVerifiedMarker(journal, marker.value, forwardError);
    if (!rollback.ok) {
      this.finishBlocked(rollback.error, transactionId);
      return {
        ok: false,
        outcome: 'blocked',
        transactionId,
        error: forwardError,
        rollbackError: rollback.error,
      };
    }

    this.finishClean(forwardError);
    return { ok: true, outcome: 'recovered-rollback', transactionId, forwardError };
  }

  private async transactLocked(mutations: readonly ValidatedStorageMutation[]): Promise<StorageTransactionResult> {
    if (!this.status.initialized) {
      const error = storageError(
        'not_initialized',
        'inspect-journal',
        'Storage recovery must complete successfully before transactions can start.',
      );
      this.updateStatus({ lastError: error });
      return { ok: false, outcome: 'blocked', transactionId: null, error };
    }
    if (this.status.blocked) {
      const error = storageError('blocked', 'inspect-journal', 'Storage is blocked pending successful recovery.');
      this.updateStatus({ lastError: error });
      return { ok: false, outcome: 'blocked', transactionId: null, error };
    }

    this.updateStatus({ phase: 'transaction', transactionId: null, lastError: null });
    const existingMarker = await this.readRaw(STORAGE_TRANSACTION_JOURNAL_KEY, 'inspect-journal');
    if (!existingMarker.ok) {
      this.finishBlocked(existingMarker.error, null);
      return { ok: false, outcome: 'indeterminate', transactionId: null, error: existingMarker.error };
    }
    if (existingMarker.value !== null) {
      const decoded = decodeStorageJournal(existingMarker.value);
      const transactionId = decoded.ok ? decoded.journal.transactionId : null;
      const error = storageError(
        decoded.ok ? 'journal_present' : 'journal_corrupt',
        decoded.ok ? 'inspect-journal' : 'decode-journal',
        decoded.ok
          ? 'A transaction journal already exists; recover it before starting another transaction.'
          : decoded.message,
        transactionId === null ? {} : { transactionId },
      );
      this.finishBlocked(error, transactionId);
      return { ok: false, outcome: 'blocked', transactionId, error };
    }

    let transactionId: string;
    try {
      transactionId = this.createTransactionId();
    } catch (cause) {
      const error = storageError('invalid_transaction_id', 'validate', 'The transaction-id source threw an error.', {
        cause,
      });
      this.finishClean(error);
      return { ok: false, outcome: 'rejected', transactionId: null, error };
    }
    if (!isValidTransactionId(transactionId)) {
      const error = storageError('invalid_transaction_id', 'validate', 'The transaction-id source returned an invalid id.');
      this.finishClean(error);
      return { ok: false, outcome: 'rejected', transactionId: null, error };
    }
    this.updateStatus({ transactionId });

    const operations: StorageTransactionJournalV1['operations'][number][] = [];
    for (const mutation of mutations) {
      const before = await this.readRaw(mutation.key, 'capture-before', transactionId);
      if (!before.ok) {
        this.finishClean(before.error);
        return { ok: false, outcome: 'rejected', transactionId, error: before.error };
      }
      if (mutation.hasExpected && before.value !== mutation.expected) {
        const error = storageError(
          'precondition_failed',
          'check-precondition',
          'A storage compare-and-set precondition did not match.',
          { transactionId, key: mutation.key },
        );
        this.finishClean(error);
        return { ok: false, outcome: 'rejected', transactionId, error };
      }
      operations.push({ key: mutation.key, before: before.value, after: mutation.value });
    }

    const journal: StorageTransactionJournalV1 = {
      kind: STORAGE_TRANSACTION_JOURNAL_KIND,
      version: STORAGE_TRANSACTION_JOURNAL_VERSION,
      transactionId,
      operations,
    };
    const serializedJournal = serializeStorageJournal(journal);
    if (serializedJournal.length > MAX_JOURNAL_RAW_LENGTH) {
      const error = storageError(
        'journal_too_large',
        'validate',
        `The serialized transaction journal exceeds ${MAX_JOURNAL_RAW_LENGTH} characters.`,
        { transactionId },
      );
      this.finishClean(error);
      return { ok: false, outcome: 'rejected', transactionId, error };
    }

    this.updateStatus({ dirty: true, blocked: true });
    const journalWrite = await this.writeAndVerifyRaw(
      STORAGE_TRANSACTION_JOURNAL_KEY,
      serializedJournal,
      'write-journal',
      'verify-journal',
      transactionId,
    );
    if (!journalWrite.ok) {
      const markerState = await this.classifyMarker(serializedJournal, transactionId);
      if (markerState === 'absent') {
        this.finishClean(journalWrite.error);
        return { ok: false, outcome: 'rejected', transactionId, error: journalWrite.error };
      }
      if (markerState === 'present') {
        const rollback = await this.rollbackWithVerifiedMarker(journal, serializedJournal, journalWrite.error);
        if (rollback.ok) {
          this.finishClean(journalWrite.error);
          return { ok: false, outcome: 'rolled-back', transactionId, error: journalWrite.error };
        }
        this.finishBlocked(rollback.error, transactionId);
        return {
          ok: false,
          outcome: 'blocked',
          transactionId,
          error: journalWrite.error,
          rollbackError: rollback.error,
        };
      }
      this.finishBlocked(journalWrite.error, transactionId);
      return { ok: false, outcome: 'indeterminate', transactionId, error: journalWrite.error };
    }

    let transactionError = await this.applyOperations(journal, 'forward');
    if (transactionError === null) {
      const cleared = await this.clearAndVerifyJournal(serializedJournal, transactionId);
      if (cleared.ok || cleared.markerState === 'absent') {
        this.finishClean(null);
        return { ok: true, outcome: 'committed', transactionId };
      }
      if (cleared.markerState !== 'present') {
        this.finishBlocked(cleared.error, transactionId);
        return { ok: false, outcome: 'indeterminate', transactionId, error: cleared.error };
      }
      transactionError = cleared.error;
    }

    const rollback = await this.rollbackWithVerifiedMarker(journal, serializedJournal, transactionError);
    if (rollback.ok) {
      this.finishClean(transactionError);
      return { ok: false, outcome: 'rolled-back', transactionId, error: transactionError };
    }
    this.finishBlocked(rollback.error, transactionId);
    return {
      ok: false,
      outcome: 'blocked',
      transactionId,
      error: transactionError,
      rollbackError: rollback.error,
    };
  }

  private async applyOperations(
    journal: StorageTransactionJournalV1,
    direction: 'forward' | 'rollback',
  ): Promise<StorageKernelError | null> {
    const operations = direction === 'rollback' ? [...journal.operations].reverse() : journal.operations;
    for (const operation of operations) {
      const target = direction === 'forward' ? operation.after : operation.before;
      const write = await this.writeAndVerifyRaw(
        operation.key,
        target,
        direction === 'forward' ? 'apply-operation' : 'rollback-operation',
        direction === 'forward' ? 'verify-operation' : 'verify-rollback',
        journal.transactionId,
      );
      if (!write.ok) {
        if (direction === 'forward') return write.error;
        return storageError('rollback_failed', write.error.stage, 'A rollback operation could not be verified.', {
          transactionId: journal.transactionId,
          key: operation.key,
          cause: write.error.cause ?? write.error.message,
        });
      }
    }
    return null;
  }

  private async rollbackWithVerifiedMarker(
    journal: StorageTransactionJournalV1,
    serializedJournal: string,
    forwardError: StorageKernelError,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: StorageKernelError }> {
    const markerState = await this.classifyMarker(serializedJournal, journal.transactionId);
    if (markerState !== 'present') {
      return {
        ok: false,
        error: storageError(
          'rollback_failed',
          'inspect-journal',
          'Rollback was not safe because the exact journal marker could not be verified.',
          { transactionId: journal.transactionId, cause: forwardError.message },
        ),
      };
    }

    for (const operation of journal.operations) {
      const current = await this.readRaw(operation.key, 'inspect-recovery', journal.transactionId);
      if (!current.ok || (current.value !== operation.before && current.value !== operation.after)) {
        return {
          ok: false,
          error: storageError(
            'rollback_failed',
            'inspect-recovery',
            'Rollback was not safe because a journaled value could not be matched to its before- or after-image.',
            {
              transactionId: journal.transactionId,
              key: operation.key,
              ...(!current.ok ? { cause: current.error.cause ?? current.error.message } : {}),
            },
          ),
        };
      }
    }

    const rollbackError = await this.applyOperations(journal, 'rollback');
    if (rollbackError !== null) return { ok: false, error: rollbackError };

    const cleared = await this.clearAndVerifyJournal(serializedJournal, journal.transactionId);
    if (cleared.ok || cleared.markerState === 'absent') return { ok: true };
    return {
      ok: false,
      error: storageError('rollback_failed', cleared.error.stage, 'Rollback completed but its journal could not be cleared.', {
        transactionId: journal.transactionId,
        cause: cleared.error.cause ?? cleared.error.message,
      }),
    };
  }

  private async readRaw(
    key: string,
    stage: StorageErrorStage,
    transactionId?: string,
  ): Promise<Fallible<string | null>> {
    try {
      const value = await this.store.getItem(key);
      if (typeof value !== 'string' && value !== null) {
        return {
          ok: false,
          error: storageError('read_failed', stage, 'The storage adapter returned a non-raw value.', {
            transactionId,
            key,
          }),
        };
      }
      return { ok: true, value };
    } catch (cause) {
      return {
        ok: false,
        error: storageError('read_failed', stage, 'The storage adapter failed to read a value.', {
          transactionId,
          key,
          cause,
        }),
      };
    }
  }

  private async writeAndVerifyRaw(
    key: string,
    value: string | null,
    writeStage: StorageErrorStage,
    verifyStage: StorageErrorStage,
    transactionId: string,
  ): Promise<Fallible<undefined>> {
    let writeFailure: unknown;
    try {
      if (value === null) await this.store.removeItem(key);
      else await this.store.setItem(key, value);
    } catch (cause) {
      writeFailure = cause;
    }

    const verified = await this.readRaw(key, verifyStage, transactionId);
    if (verified.ok && verified.value === value) return { ok: true, value: undefined };
    if (!verified.ok) return verified;

    return {
      ok: false,
      error: storageError(
        value === null ? 'remove_failed' : writeFailure === undefined ? 'verification_failed' : 'write_failed',
        writeFailure === undefined ? verifyStage : writeStage,
        'A storage write did not read back as the requested raw value.',
        { transactionId, key, ...(writeFailure === undefined ? {} : { cause: writeFailure }) },
      ),
    };
  }

  private async clearAndVerifyJournal(serializedJournal: string, transactionId: string): Promise<ClearResult> {
    let removeFailure: unknown;
    try {
      await this.store.removeItem(STORAGE_TRANSACTION_JOURNAL_KEY);
    } catch (cause) {
      removeFailure = cause;
    }

    const marker = await this.readRaw(
      STORAGE_TRANSACTION_JOURNAL_KEY,
      'verify-journal-cleared',
      transactionId,
    );
    if (marker.ok && marker.value === null) return { ok: true };

    const error = marker.ok
      ? storageError(
          removeFailure === undefined ? 'verification_failed' : 'remove_failed',
          removeFailure === undefined ? 'verify-journal-cleared' : 'clear-journal',
          'The transaction journal was not verified as cleared.',
          {
            transactionId,
            key: STORAGE_TRANSACTION_JOURNAL_KEY,
            ...(removeFailure === undefined ? {} : { cause: removeFailure }),
          },
        )
      : marker.error;
    const markerState: MarkerState = !marker.ok
      ? 'unknown'
      : marker.value === serializedJournal
        ? 'present'
        : marker.value === null
          ? 'absent'
          : 'different';
    return { ok: false, error, markerState };
  }

  private async classifyMarker(serializedJournal: string, transactionId: string): Promise<MarkerState> {
    const marker = await this.readRaw(STORAGE_TRANSACTION_JOURNAL_KEY, 'inspect-journal', transactionId);
    if (!marker.ok) return 'unknown';
    if (marker.value === null) return 'absent';
    return marker.value === serializedJournal ? 'present' : 'different';
  }

  private finishClean(lastError: StorageKernelError | null): void {
    this.updateStatus({
      dirty: false,
      blocked: false,
      initialized: true,
      phase: 'idle',
      transactionId: null,
      lastError,
    });
  }

  private finishBlocked(error: StorageKernelError, transactionId: string | null): void {
    this.updateStatus({
      dirty: true,
      blocked: true,
      initialized: true,
      phase: 'idle',
      transactionId,
      lastError: error,
    });
  }

  private updateStatus(patch: Partial<StorageCoordinatorStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.getStatus());
      } catch {
        // Observers cannot affect transaction durability.
      }
    }
  }
}

export function createStorageCoordinator(
  store: RawAsyncKeyValue,
  options: StorageCoordinatorOptions = {},
): StorageTransactionCoordinator {
  return new Coordinator(store, options);
}
