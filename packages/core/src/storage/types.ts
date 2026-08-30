export const STORAGE_TRANSACTION_JOURNAL_KEY = 'gc.storage.transaction' as const;
export const STORAGE_TRANSACTION_JOURNAL_KIND = 'grimcomp.storage.transaction' as const;
export const STORAGE_TRANSACTION_JOURNAL_VERSION = 1 as const;

/** A platform adapter over raw, already-serialized values. */
export interface RawAsyncKeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface StorageMutation {
  readonly key: string;
  /** The exact serialized value to persist, or null to remove the key. */
  readonly value: string | null;
  /**
   * Optional compare-and-set precondition. Omission means unconditional; null
   * explicitly requires the key to be absent when the exclusive lock is held.
   */
  readonly expected?: string | null;
}

/** Operations and caller-owned metadata built while the coordinator owns its lock. */
export interface StorageComputedTransaction<Metadata> {
  readonly mutations: readonly StorageMutation[];
  readonly metadata: Metadata;
}

export type StorageComputedTransactionProvider<Metadata> = () =>
  | StorageComputedTransaction<Metadata>
  | Promise<StorageComputedTransaction<Metadata>>;

export interface StorageJournalOperationV1 {
  readonly key: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface StorageTransactionJournalV1 {
  readonly kind: typeof STORAGE_TRANSACTION_JOURNAL_KIND;
  readonly version: typeof STORAGE_TRANSACTION_JOURNAL_VERSION;
  readonly transactionId: string;
  readonly operations: readonly StorageJournalOperationV1[];
}

export type StorageExclusiveLock = <T>(work: () => Promise<T>) => Promise<T>;

export interface StorageCoordinatorOptions {
  /** Wraps each queued unit in a platform-wide exclusive lock (for example Web Locks). */
  readonly withExclusiveLock?: StorageExclusiveLock;
  /** Must return a unique, printable identifier of at most 128 characters. */
  readonly createTransactionId?: () => string;
}

export type StorageErrorCode =
  | 'not_initialized'
  | 'blocked'
  | 'invalid_operations'
  | 'invalid_transaction_id'
  | 'journal_too_large'
  | 'precondition_failed'
  | 'journal_corrupt'
  | 'journal_present'
  | 'read_failed'
  | 'write_failed'
  | 'remove_failed'
  | 'verification_failed'
  | 'recovery_conflict'
  | 'rollback_failed'
  | 'lock_failed';

export type StorageErrorStage =
  | 'validate'
  | 'lock'
  | 'inspect-journal'
  | 'capture-before'
  | 'check-precondition'
  | 'write-journal'
  | 'verify-journal'
  | 'apply-operation'
  | 'verify-operation'
  | 'clear-journal'
  | 'verify-journal-cleared'
  | 'decode-journal'
  | 'inspect-recovery'
  | 'rollback-operation'
  | 'verify-rollback';

export interface StorageKernelError {
  readonly code: StorageErrorCode;
  readonly stage: StorageErrorStage;
  readonly message: string;
  readonly transactionId?: string;
  readonly key?: string;
  /** A bounded description only; arbitrary thrown values are never exposed. */
  readonly cause?: string;
}

export type StorageTransactionResult =
  | {
      readonly ok: true;
      readonly outcome: 'committed';
      readonly transactionId: string;
    }
  | {
      readonly ok: false;
      readonly outcome: 'rejected' | 'rolled-back' | 'blocked' | 'indeterminate';
      readonly transactionId: string | null;
      readonly error: StorageKernelError;
      readonly rollbackError?: StorageKernelError;
    };

/**
 * Result of a transaction whose operations are discovered under the exclusive
 * lock. Metadata is available after discovery even if the durable commit fails;
 * it is null when readiness, locking, or the provider itself fails first.
 */
export type StorageComputedTransactionResult<Metadata> =
  | {
      readonly ok: true;
      readonly outcome: 'committed';
      readonly transactionId: string;
      readonly metadata: Metadata;
    }
  | {
      readonly ok: true;
      readonly outcome: 'unchanged';
      readonly transactionId: null;
      readonly metadata: Metadata;
    }
  | {
      readonly ok: false;
      readonly outcome: 'rejected' | 'rolled-back' | 'blocked' | 'indeterminate';
      readonly transactionId: string | null;
      readonly error: StorageKernelError;
      readonly rollbackError?: StorageKernelError;
      readonly metadata: Metadata | null;
    };

export type StorageRecoveryResult =
  | {
      readonly ok: true;
      readonly outcome: 'clean' | 'recovered-forward';
      readonly transactionId: string | null;
    }
  | {
      /** Recovery restored the before-images after forward completion failed. */
      readonly ok: true;
      readonly outcome: 'recovered-rollback';
      readonly transactionId: string;
      readonly forwardError: StorageKernelError;
    }
  | {
      readonly ok: false;
      readonly outcome: 'blocked';
      readonly transactionId: string | null;
      readonly error: StorageKernelError;
      readonly rollbackError?: StorageKernelError;
    };

export interface StorageCoordinatorStatus {
  /** Number of queued or executing recover/transaction calls. */
  readonly pending: number;
  /** False only after the absence of a journal has been verified. */
  readonly dirty: boolean;
  /** New transactions cannot start while true. */
  readonly blocked: boolean;
  readonly initialized: boolean;
  readonly phase: 'idle' | 'transaction' | 'recovery';
  readonly transactionId: string | null;
  readonly lastError: StorageKernelError | null;
}

export type StorageStatusListener = (status: StorageCoordinatorStatus) => void;

export interface StorageTransactionCoordinator {
  /** FIFO-queued crash-recoverable mutation. `recover()` must succeed first. */
  transact(mutations: readonly StorageMutation[]): Promise<StorageTransactionResult>;
  /**
   * Build a mutation set after FIFO ordering and exclusive-lock acquisition.
   * Optional for compatibility with lightweight test/custom coordinator shims;
   * coordinators returned by createStorageCoordinator always implement it.
   */
  transactComputed?<Metadata>(
    provider: StorageComputedTransactionProvider<Metadata>,
  ): Promise<StorageComputedTransactionResult<Metadata>>;
  /** FIFO-queued startup inspection/recovery of the reserved journal. */
  recover(): Promise<StorageRecoveryResult>;
  getStatus(): StorageCoordinatorStatus;
  subscribe(listener: StorageStatusListener): () => void;
}
