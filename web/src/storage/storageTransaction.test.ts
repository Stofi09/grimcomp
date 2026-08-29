import { describe, expect, it } from 'vitest';
import {
  MAX_JOURNAL_RAW_LENGTH,
  STORAGE_TRANSACTION_JOURNAL_KEY,
  STORAGE_TRANSACTION_JOURNAL_KIND,
  STORAGE_TRANSACTION_JOURNAL_VERSION,
  createStorageCoordinator,
  decodeStorageJournal,
  serializeStorageJournal,
  type RawAsyncKeyValue,
  type StorageExclusiveLock,
  type StorageTransactionJournalV1,
} from '@grimcomp/core';

interface StoreEvent {
  readonly type: 'set' | 'remove';
  readonly key: string;
  readonly value: string | null;
  readonly boundary: number;
}

class FaultStore implements RawAsyncKeyValue {
  readonly data = new Map<string, string>();
  readonly events: StoreEvent[] = [];
  readonly dropAt = new Set<number>();
  readonly corruptAt = new Map<number, string>();
  readonly unreadable = new Set<string>();
  crashAfter: number | null = null;
  gateAt: number | null = null;
  writeBoundary = 0;
  private unavailable = false;
  private gateResolve: (() => void) | null = null;
  private gateReachedResolve: (() => void) | null = null;
  private readonly gateReachedPromise = new Promise<void>((resolve) => {
    this.gateReachedResolve = resolve;
  });
  private readonly gatePromise = new Promise<void>((resolve) => {
    this.gateResolve = resolve;
  });

  async getItem(key: string): Promise<string | null> {
    if (this.unavailable || this.unreadable.has(key)) throw new Error(`read unavailable: ${key}`);
    return this.data.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.write('set', key, value);
  }

  async removeItem(key: string): Promise<void> {
    await this.write('remove', key, null);
  }

  restart(): void {
    this.unavailable = false;
    this.crashAfter = null;
    this.gateAt = null;
    this.unreadable.clear();
  }

  async waitForGate(): Promise<void> {
    await this.gateReachedPromise;
  }

  releaseGate(): void {
    this.gateResolve?.();
  }

  private async write(type: StoreEvent['type'], key: string, value: string | null): Promise<void> {
    if (this.unavailable) throw new Error('store is offline after simulated process crash');
    this.writeBoundary += 1;
    const boundary = this.writeBoundary;
    this.events.push({ type, key, value, boundary });

    if (this.gateAt === boundary) {
      this.gateReachedResolve?.();
      await this.gatePromise;
    }

    if (!this.dropAt.has(boundary)) {
      if (type === 'remove') this.data.delete(key);
      else this.data.set(key, this.corruptAt.get(boundary) ?? (value as string));
    }

    if (this.crashAfter === boundary) {
      this.unavailable = true;
      throw new Error(`simulated process crash after write boundary ${boundary}`);
    }
  }
}

function journalRaw(
  transactionId: string,
  operations: StorageTransactionJournalV1['operations'],
): string {
  return serializeStorageJournal({
    kind: STORAGE_TRANSACTION_JOURNAL_KIND,
    version: STORAGE_TRANSACTION_JOURNAL_VERSION,
    transactionId,
    operations,
  });
}

function coordinator(store: RawAsyncKeyValue, ids: readonly string[] = ['test-tx']) {
  let index = 0;
  return createStorageCoordinator(store, {
    createTransactionId: () => ids[index++] ?? `test-tx-${index}`,
  });
}

describe('crash-recoverable storage transactions', () => {
  it('writes and verifies the journal and every operation before reporting a commit', async () => {
    const store = new FaultStore();
    store.data.set('gc.a', 'old-a');
    store.data.set('gc.deleted', 'old-delete');
    const storage = coordinator(store);

    expect(await storage.recover()).toEqual({ ok: true, outcome: 'clean', transactionId: null });
    const result = await storage.transact([
      { key: 'gc.a', value: 'new-a', expected: 'old-a' },
      { key: 'gc.b', value: 'new-b', expected: null },
      { key: 'gc.deleted', value: null },
    ]);

    expect(result).toEqual({ ok: true, outcome: 'committed', transactionId: 'test-tx' });
    expect(store.data.get('gc.a')).toBe('new-a');
    expect(store.data.get('gc.b')).toBe('new-b');
    expect(store.data.has('gc.deleted')).toBe(false);
    expect(store.data.has(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(false);
    expect(storage.getStatus()).toMatchObject({
      pending: 0,
      dirty: false,
      blocked: false,
      initialized: true,
      phase: 'idle',
    });
  });

  it.each([1, 2, 3, 4])(
    'recovers deterministically after a process crash at write boundary %i',
    async (boundary) => {
      const store = new FaultStore();
      store.data.set('gc.a', 'old-a');
      store.data.set('gc.b', 'old-b');
      const firstProcess = coordinator(store, ['crash-tx']);
      await firstProcess.recover();
      store.crashAfter = boundary;

      const interrupted = await firstProcess.transact([
        { key: 'gc.a', value: 'new-a' },
        { key: 'gc.b', value: 'new-b' },
      ]);
      expect(interrupted.ok).toBe(false);
      expect(firstProcess.getStatus()).toMatchObject({ dirty: true, blocked: true });

      store.restart();
      const nextProcess = coordinator(store, ['next-tx']);
      const recovered = await nextProcess.recover();
      expect(recovered.ok).toBe(true);
      expect(store.data.get('gc.a')).toBe('new-a');
      expect(store.data.get('gc.b')).toBe('new-b');
      expect(store.data.has(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(false);
      expect(nextProcess.getStatus()).toMatchObject({ dirty: false, blocked: false, initialized: true });
    },
  );

  it('finishes a valid mixed before/after journal forward during startup recovery', async () => {
    const store = new FaultStore();
    const raw = journalRaw('recover-forward', [
      { key: 'gc.a', before: 'old-a', after: 'new-a' },
      { key: 'gc.b', before: 'old-b', after: 'new-b' },
    ]);
    store.data.set(STORAGE_TRANSACTION_JOURNAL_KEY, raw);
    store.data.set('gc.a', 'new-a');
    store.data.set('gc.b', 'old-b');

    const recovered = await coordinator(store).recover();

    expect(recovered).toEqual({ ok: true, outcome: 'recovered-forward', transactionId: 'recover-forward' });
    expect(store.data.get('gc.a')).toBe('new-a');
    expect(store.data.get('gc.b')).toBe('new-b');
    expect(store.data.has(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(false);
  });

  it('uses a verified rollback when safe forward recovery fails', async () => {
    const store = new FaultStore();
    const raw = journalRaw('recover-rollback', [
      { key: 'gc.a', before: 'old-a', after: 'new-a' },
      { key: 'gc.b', before: 'old-b', after: 'new-b' },
    ]);
    store.data.set(STORAGE_TRANSACTION_JOURNAL_KEY, raw);
    store.data.set('gc.a', 'old-a');
    store.data.set('gc.b', 'old-b');
    store.dropAt.add(1);

    const recovered = await coordinator(store).recover();

    expect(recovered).toMatchObject({
      ok: true,
      outcome: 'recovered-rollback',
      transactionId: 'recover-rollback',
      forwardError: { code: 'verification_failed' },
    });
    expect(store.data.get('gc.a')).toBe('old-a');
    expect(store.data.get('gc.b')).toBe('old-b');
    expect(store.data.has(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(false);
  });

  it('preserves the marker and blocks when a verified rollback fails', async () => {
    const store = new FaultStore();
    const raw = journalRaw('rollback-fails', [
      { key: 'gc.a', before: 'old-a', after: 'new-a' },
      { key: 'gc.b', before: 'old-b', after: 'new-b' },
    ]);
    store.data.set(STORAGE_TRANSACTION_JOURNAL_KEY, raw);
    store.data.set('gc.a', 'old-a');
    store.data.set('gc.b', 'new-b');
    store.dropAt.add(1);
    store.dropAt.add(2);

    const storage = coordinator(store);
    const recovered = await storage.recover();

    expect(recovered).toMatchObject({
      ok: false,
      outcome: 'blocked',
      transactionId: 'rollback-fails',
      rollbackError: { code: 'rollback_failed' },
    });
    expect(store.data.get(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(raw);
    expect(storage.getStatus()).toMatchObject({ dirty: true, blocked: true });
  });

  it('never overwrites an unreadable key during startup recovery', async () => {
    const store = new FaultStore();
    const raw = journalRaw('unreadable', [{ key: 'gc.a', before: 'old-a', after: 'new-a' }]);
    store.data.set(STORAGE_TRANSACTION_JOURNAL_KEY, raw);
    store.data.set('gc.a', 'old-a');
    store.unreadable.add('gc.a');

    const recovered = await coordinator(store).recover();

    expect(recovered).toMatchObject({ ok: false, error: { code: 'read_failed', key: 'gc.a' } });
    expect(store.events).toEqual([]);
    expect(store.data.get('gc.a')).toBe('old-a');
    expect(store.data.get(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(raw);
  });

  it('reports a divergent recovery conflict and preserves both value and marker', async () => {
    const store = new FaultStore();
    const raw = journalRaw('conflict', [{ key: 'gc.a', before: 'old-a', after: 'new-a' }]);
    store.data.set(STORAGE_TRANSACTION_JOURNAL_KEY, raw);
    store.data.set('gc.a', 'external-write');

    const recovered = await coordinator(store).recover();

    expect(recovered).toMatchObject({ ok: false, error: { code: 'recovery_conflict', key: 'gc.a' } });
    expect(store.events).toEqual([]);
    expect(store.data.get('gc.a')).toBe('external-write');
    expect(store.data.get(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(raw);
  });

  it('preflights rollback and never overwrites a value that diverged during a failed apply', async () => {
    const store = new FaultStore();
    store.data.set('gc.a', 'old-a');
    store.data.set('gc.b', 'old-b');
    const storage = coordinator(store, ['diverge-tx']);
    await storage.recover();
    store.corruptAt.set(3, 'external-write');

    const result = await storage.transact([
      { key: 'gc.a', value: 'new-a' },
      { key: 'gc.b', value: 'new-b' },
    ]);

    expect(result).toMatchObject({
      ok: false,
      outcome: 'blocked',
      rollbackError: { code: 'rollback_failed', key: 'gc.b' },
    });
    expect(store.data.get('gc.a')).toBe('new-a');
    expect(store.data.get('gc.b')).toBe('external-write');
    expect(store.data.has(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(true);
    expect(store.events).toHaveLength(3);
  });

  it('returns a verification error and a durable rollback when an operation write is dropped', async () => {
    const store = new FaultStore();
    store.data.set('gc.a', 'old-a');
    const storage = coordinator(store, ['mismatch-tx']);
    await storage.recover();
    store.dropAt.add(2);

    const result = await storage.transact([{ key: 'gc.a', value: 'new-a' }]);

    expect(result).toMatchObject({
      ok: false,
      outcome: 'rolled-back',
      transactionId: 'mismatch-tx',
      error: { code: 'verification_failed', stage: 'verify-operation', key: 'gc.a' },
    });
    expect(store.data.get('gc.a')).toBe('old-a');
    expect(store.data.has(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(false);
  });

  it('does not begin data writes when the journal write cannot be verified', async () => {
    const store = new FaultStore();
    store.data.set('gc.a', 'old-a');
    const storage = coordinator(store, ['journal-mismatch']);
    await storage.recover();
    store.dropAt.add(1);

    const result = await storage.transact([{ key: 'gc.a', value: 'new-a' }]);

    expect(result).toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'verification_failed', stage: 'verify-journal' },
    });
    expect(store.data.get('gc.a')).toBe('old-a');
    expect(store.data.has(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(false);
    expect(store.events).toHaveLength(1);
  });

  it('does not report a commit when journal removal cannot be verified', async () => {
    const store = new FaultStore();
    store.data.set('gc.a', 'old-a');
    const storage = coordinator(store, ['clear-mismatch']);
    await storage.recover();
    store.dropAt.add(3);

    const result = await storage.transact([{ key: 'gc.a', value: 'new-a' }]);

    expect(result).toMatchObject({
      ok: false,
      outcome: 'rolled-back',
      error: { code: 'verification_failed', stage: 'verify-journal-cleared' },
    });
    expect(store.data.get('gc.a')).toBe('old-a');
    expect(store.data.has(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(false);
  });

  it('starts blocked and refuses writes until startup recovery succeeds', async () => {
    const store = new FaultStore();
    const storage = coordinator(store, ['too-early']);

    const result = await storage.transact([{ key: 'gc.a', value: 'new-a' }]);

    expect(result).toMatchObject({
      ok: false,
      outcome: 'blocked',
      error: { code: 'not_initialized' },
    });
    expect(store.events).toEqual([]);
    expect(storage.getStatus()).toMatchObject({ initialized: false, dirty: true, blocked: true });
  });

  it('serializes queued transactions in FIFO order and exposes pending/dirty state', async () => {
    const store = new FaultStore();
    store.data.set('gc.value', 'zero');
    const storage = coordinator(store, ['fifo-1', 'fifo-2']);
    await storage.recover();
    store.gateAt = 2;
    const statuses: Array<{ pending: number; dirty: boolean; phase: string }> = [];
    storage.subscribe((status) => statuses.push({
      pending: status.pending,
      dirty: status.dirty,
      phase: status.phase,
    }));

    const first = storage.transact([{ key: 'gc.value', value: 'one', expected: 'zero' }]);
    const second = storage.transact([{ key: 'gc.value', value: 'two', expected: 'one' }]);
    await store.waitForGate();
    expect(storage.getStatus()).toMatchObject({ pending: 2, dirty: true, phase: 'transaction' });
    store.releaseGate();

    expect(await first).toMatchObject({ ok: true, transactionId: 'fifo-1' });
    expect(await second).toMatchObject({ ok: true, transactionId: 'fifo-2' });
    expect(store.data.get('gc.value')).toBe('two');
    expect(store.events.map(({ type, key }) => `${type}:${key}`)).toEqual([
      `set:${STORAGE_TRANSACTION_JOURNAL_KEY}`,
      'set:gc.value',
      `remove:${STORAGE_TRANSACTION_JOURNAL_KEY}`,
      `set:${STORAGE_TRANSACTION_JOURNAL_KEY}`,
      'set:gc.value',
      `remove:${STORAGE_TRANSACTION_JOURNAL_KEY}`,
    ]);
    expect(statuses.some((status) => status.pending === 2 && status.dirty)).toBe(true);
    expect(storage.getStatus()).toMatchObject({ pending: 0, dirty: false, blocked: false, phase: 'idle' });
  });

  it('checks compare-and-set expectations only after acquiring a shared exclusive lock', async () => {
    const store = new FaultStore();
    store.data.set('gc.value', 'zero');
    let lockTail = Promise.resolve();
    const withExclusiveLock: StorageExclusiveLock = async <T>(work: () => Promise<T>) => {
      const previous = lockTail;
      let release = () => undefined;
      lockTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await work();
      } finally {
        release();
      }
    };
    const first = createStorageCoordinator(store, { withExclusiveLock, createTransactionId: () => 'cas-1' });
    const second = createStorageCoordinator(store, { withExclusiveLock, createTransactionId: () => 'cas-2' });
    await Promise.all([first.recover(), second.recover()]);

    const [firstResult, secondResult] = await Promise.all([
      first.transact([{ key: 'gc.value', value: 'one', expected: 'zero' }]),
      second.transact([{ key: 'gc.value', value: 'two', expected: 'zero' }]),
    ]);

    expect(firstResult).toMatchObject({ ok: true, outcome: 'committed' });
    expect(secondResult).toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'precondition_failed', stage: 'check-precondition' },
    });
    expect(store.data.get('gc.value')).toBe('one');
  });

  it('distinguishes an omitted precondition from an explicit absent precondition', async () => {
    const store = new FaultStore();
    const storage = coordinator(store, ['absent-1', 'absent-2', 'unconditional']);
    await storage.recover();

    expect(await storage.transact([{ key: 'gc.value', value: 'one', expected: null }])).toMatchObject({ ok: true });
    expect(await storage.transact([{ key: 'gc.value', value: 'two', expected: null }])).toMatchObject({
      ok: false,
      error: { code: 'precondition_failed' },
    });
    expect(await storage.transact([{ key: 'gc.value', value: 'three' }])).toMatchObject({ ok: true });
    expect(store.data.get('gc.value')).toBe('three');
  });

  it('rejects invalid, duplicate, and reserved operations without writing a journal', async () => {
    const store = new FaultStore();
    const storage = coordinator(store, ['invalid']);
    await storage.recover();

    const duplicate = await storage.transact([
      { key: 'gc.a', value: 'one' },
      { key: 'gc.a', value: 'two' },
    ]);
    const reserved = await storage.transact([{ key: STORAGE_TRANSACTION_JOURNAL_KEY, value: 'bad' }]);
    const unknownField = await storage.transact([
      { key: 'gc.a', value: 'one', extra: true } as { key: string; value: string },
    ]);

    expect(duplicate).toMatchObject({ ok: false, error: { code: 'invalid_operations' } });
    expect(reserved).toMatchObject({ ok: false, error: { code: 'invalid_operations' } });
    expect(unknownField).toMatchObject({ ok: false, error: { code: 'invalid_operations' } });
    expect(store.events).toEqual([]);
  });

  it('captures proxy data properties once and never invokes operation getters', async () => {
    const store = new FaultStore();
    const storage = coordinator(store, ['proxy-snapshot']);
    await storage.recover();
    let descriptorReads = 0;
    const proxy = new Proxy({ key: 'gc.a', value: 'one' }, {
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property !== 'key' || descriptor === undefined) return descriptor;
        descriptorReads += 1;
        return { ...descriptor, value: descriptorReads === 1 ? 'gc.a' : 'gc.b' };
      },
    });

    expect(await storage.transact([proxy])).toMatchObject({ ok: true });
    expect(descriptorReads).toBe(1);
    expect(store.data.get('gc.a')).toBe('one');
    expect(store.data.has('gc.b')).toBe(false);

    let getterReads = 0;
    const accessor = {
      get key() {
        getterReads += 1;
        return 'gc.getter';
      },
      value: 'bad',
    };
    expect(await storage.transact([accessor])).toMatchObject({
      ok: false,
      error: { code: 'invalid_operations' },
    });
    expect(getterReads).toBe(0);
    expect(store.data.has('gc.getter')).toBe(false);
  });

  it('accepts a maximum-size serialized journal and rejects one character over it', async () => {
    const nearStore = new FaultStore();
    const nearStorage = coordinator(nearStore, ['size']);
    await nearStorage.recover();
    const emptyRaw = journalRaw('size', [{ key: 'gc.large', before: null, after: '' }]);
    const nearValue = 'x'.repeat(MAX_JOURNAL_RAW_LENGTH - emptyRaw.length);
    expect(journalRaw('size', [{ key: 'gc.large', before: null, after: nearValue }])).toHaveLength(
      MAX_JOURNAL_RAW_LENGTH,
    );

    expect(await nearStorage.transact([{ key: 'gc.large', value: nearValue }])).toMatchObject({ ok: true });

    const overStore = new FaultStore();
    const overStorage = coordinator(overStore, ['size']);
    await overStorage.recover();
    const over = await overStorage.transact([{ key: 'gc.large', value: `${nearValue}x` }]);
    expect(over).toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'journal_too_large' },
    });
    expect(overStore.events).toEqual([]);
  });

  it.each([
    '{not-json',
    JSON.stringify({
      kind: STORAGE_TRANSACTION_JOURNAL_KIND,
      version: 2,
      transactionId: 'bad-version',
      operations: [{ key: 'gc.a', before: null, after: 'a' }],
    }),
    JSON.stringify({
      kind: STORAGE_TRANSACTION_JOURNAL_KIND,
      version: STORAGE_TRANSACTION_JOURNAL_VERSION,
      transactionId: 'unknown-field',
      operations: [{ key: 'gc.a', before: null, after: 'a' }],
      extra: true,
    }),
    JSON.stringify({
      kind: STORAGE_TRANSACTION_JOURNAL_KIND,
      version: STORAGE_TRANSACTION_JOURNAL_VERSION,
      transactionId: 'duplicate',
      operations: [
        { key: 'gc.a', before: null, after: 'a' },
        { key: 'gc.a', before: 'a', after: 'b' },
      ],
    }),
    JSON.stringify({
      kind: STORAGE_TRANSACTION_JOURNAL_KIND,
      version: STORAGE_TRANSACTION_JOURNAL_VERSION,
      transactionId: 'reserved',
      operations: [{ key: STORAGE_TRANSACTION_JOURNAL_KEY, before: null, after: 'bad' }],
    }),
  ])('blocks and preserves a corrupt persisted marker: %s', async (raw) => {
    const store = new FaultStore();
    store.data.set(STORAGE_TRANSACTION_JOURNAL_KEY, raw);
    const storage = coordinator(store);

    const recovered = await storage.recover();

    expect(recovered).toMatchObject({ ok: false, error: { code: 'journal_corrupt' } });
    expect(store.data.get(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(raw);
    expect(store.events).toEqual([]);
    expect(storage.getStatus()).toMatchObject({ initialized: true, dirty: true, blocked: true });
    expect(decodeStorageJournal(raw).ok).toBe(false);
  });
});
