import { describe, expect, it } from 'vitest';
import {
  STORAGE_TRANSACTION_JOURNAL_KEY,
  createStorageCoordinator,
  type RawAsyncKeyValue,
  type StorageTransactionCoordinator,
} from '@grimcomp/core';
import { NativeStorageStore } from '../../../src/storage/nativeStore';
import {
  NATIVE_STORAGE_VERSION_KEY,
  runNativeStorageMigrations,
} from '../../../src/storage/migrations';

class FakeNativeBackend implements RawAsyncKeyValue {
  readonly values = new Map<string, string>();
  readonly journalWrites: string[] = [];
  readonly writes: Array<{ key: string; value: string | null }> = [];
  failOnce: ((key: string, value: string | null) => boolean) | null = null;
  private delayedRead: { key: string; value: string | null; promise: Promise<void>; resolve: () => void } | null = null;
  private liveDelayedRead: { key: string; entered: () => void; promise: Promise<void> } | null = null;
  private delayedSet: { key: string; entered: () => void; promise: Promise<void> } | null = null;
  private readonly readCounts = new Map<string, number>();
  private readonly failedReadNumbers = new Map<string, number>();
  private readonly pausedReadNumbers = new Map<string, { number: number; entered: () => void; promise: Promise<void> }>();

  async getItem(key: string): Promise<string | null> {
    const readNumber = (this.readCounts.get(key) ?? 0) + 1;
    this.readCounts.set(key, readNumber);
    if (this.failedReadNumbers.get(key) === readNumber) {
      this.failedReadNumbers.delete(key);
      throw new Error('injected read failure');
    }
    const paused = this.pausedReadNumbers.get(key);
    if (paused?.number === readNumber) {
      this.pausedReadNumbers.delete(key);
      const value = this.values.get(key) ?? null;
      paused.entered();
      await paused.promise;
      return value;
    }
    if (this.delayedRead?.key === key) {
      const delayed = this.delayedRead;
      this.delayedRead = null;
      await delayed.promise;
      return delayed.value;
    }
    if (this.liveDelayedRead?.key === key) {
      const delayed = this.liveDelayedRead;
      this.liveDelayedRead = null;
      delayed.entered();
      await delayed.promise;
    }
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.writes.push({ key, value });
    if (this.delayedSet?.key === key) {
      const delayed = this.delayedSet;
      this.delayedSet = null;
      delayed.entered();
      await delayed.promise;
    }
    if (this.failOnce?.(key, value)) {
      this.failOnce = null;
      throw new Error('injected write failure');
    }
    this.values.set(key, value);
    if (key === STORAGE_TRANSACTION_JOURNAL_KEY) this.journalWrites.push(value);
  }

  async removeItem(key: string): Promise<void> {
    this.writes.push({ key, value: null });
    if (this.failOnce?.(key, null)) {
      this.failOnce = null;
      throw new Error('injected remove failure');
    }
    this.values.delete(key);
  }

  async getAllKeys(): Promise<readonly string[]> {
    return [...this.values.keys()];
  }

  delayNextRead(key: string): () => void {
    if (this.delayedRead) throw new Error('only one delayed read is supported');
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    this.delayedRead = { key, value: this.values.get(key) ?? null, promise, resolve };
    return resolve;
  }

  delayNextSet(key: string): { readonly entered: Promise<void>; readonly release: () => void } {
    if (this.delayedSet) throw new Error('only one delayed set is supported');
    let markEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((done) => { markEntered = done; });
    const promise = new Promise<void>((done) => { release = done; });
    this.delayedSet = { key, entered: markEntered, promise };
    return { entered, release };
  }

  pauseNextLiveRead(key: string): { readonly entered: Promise<void>; readonly release: () => void } {
    if (this.liveDelayedRead) throw new Error('only one paused live read is supported');
    let markEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((done) => { markEntered = done; });
    const promise = new Promise<void>((done) => { release = done; });
    this.liveDelayedRead = { key, entered: markEntered, promise };
    return { entered, release };
  }

  failReadAt(key: string, readNumberFromNow: number): void {
    this.failedReadNumbers.set(key, (this.readCounts.get(key) ?? 0) + readNumberFromNow);
  }

  pauseReadAt(key: string, readNumberFromNow: number): { readonly entered: Promise<void>; readonly release: () => void } {
    let markEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((done) => { markEntered = done; });
    const promise = new Promise<void>((done) => { release = done; });
    this.pausedReadNumbers.set(key, {
      number: (this.readCounts.get(key) ?? 0) + readNumberFromNow,
      entered: markEntered,
      promise,
    });
    return { entered, release };
  }
}

function coordinatorFor(backend: FakeNativeBackend) {
  let id = 0;
  return createStorageCoordinator(backend, { createTransactionId: () => `native-test-${++id}` });
}

async function recoveredCoordinator(backend: FakeNativeBackend) {
  const coordinator = coordinatorFor(backend);
  expect((await coordinator.recover()).ok).toBe(true);
  return coordinator;
}

describe('native storage migration gate', () => {
  it.each([
    ['future', JSON.stringify(9), 'newer storage version'],
    ['fractional', JSON.stringify(1.5), 'malformed'],
    ['corrupt', '{wat', 'malformed'],
  ])('blocks a %s version marker without changing it', async (_label, raw, message) => {
    const backend = new FakeNativeBackend();
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, raw);
    const coordinator = await recoveredCoordinator(backend);

    const result = await runNativeStorageMigrations(backend, coordinator, { currentVersion: 2 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
    expect(backend.values.get(NATIVE_STORAGE_VERSION_KEY)).toBe(raw);
    expect(backend.journalWrites).toHaveLength(0);
  });

  it('does not stamp when a required migration is missing', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set('gc.character', JSON.stringify({ id: 'c1' }));
    const coordinator = await recoveredCoordinator(backend);

    const result = await runNativeStorageMigrations(backend, coordinator, {
      currentVersion: 2,
      migrations: {},
    });

    expect(result.ok).toBe(false);
    expect(backend.values.has(NATIVE_STORAGE_VERSION_KEY)).toBe(false);
    expect(backend.journalWrites).toHaveLength(0);
  });

  it('does not stamp when a migration throws', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set('gc.character', JSON.stringify({ id: 'c1' }));
    const coordinator = await recoveredCoordinator(backend);

    const result = await runNativeStorageMigrations(backend, coordinator, {
      currentVersion: 2,
      migrations: { 1: async () => { throw new Error('bad transform'); } },
    });

    expect(result.ok).toBe(false);
    expect(backend.values.has(NATIVE_STORAGE_VERSION_KEY)).toBe(false);
    expect(backend.journalWrites).toHaveLength(0);
  });

  it.each([
    ['non-array', null],
    ['malformed entry', [null]],
  ])('does not stamp when a migration returns a %s result', async (_label, output) => {
    const backend = new FakeNativeBackend();
    backend.values.set('gc.character', JSON.stringify({ id: 'c1' }));
    const coordinator = await recoveredCoordinator(backend);

    const result = await runNativeStorageMigrations(backend, coordinator, {
      currentVersion: 2,
      migrations: { 1: async () => output as never },
    });

    expect(result.ok).toBe(false);
    expect(backend.values.has(NATIVE_STORAGE_VERSION_KEY)).toBe(false);
    expect(backend.journalWrites).toHaveLength(0);
  });

  it('blocks cleanly when the coordinator promise rejects unexpectedly', async () => {
    const backend = new FakeNativeBackend();
    const base = await recoveredCoordinator(backend);
    const rejecting: StorageTransactionCoordinator = {
      recover: () => base.recover(),
      transact: async () => { throw new Error('unexpected coordinator rejection'); },
      getStatus: () => base.getStatus(),
      subscribe: (listener) => base.subscribe(listener),
    };

    const result = await runNativeStorageMigrations(backend, rejecting);

    expect(result.ok).toBe(false);
    expect(backend.values.has(NATIVE_STORAGE_VERSION_KEY)).toBe(false);
  });
});

describe('NativeStorageStore', () => {
  it('does not let a stale hydration overwrite a newer local write', async () => {
    const backend = new FakeNativeBackend();
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);

    const release = backend.delayNextRead('gc.late');
    const hydration = store.hydrate('gc.late', 0);
    const durability = store.update('gc.late', 0, 2);
    expect(store.read('gc.late', 0)).toBe(2);
    release();

    expect((await durability).ok).toBe(true);
    expect(await hydration).toBe(2);
    expect(store.read('gc.late', 0)).toBe(2);
    expect(backend.values.get('gc.late')).toBe('2');
  });

  it('reconciles optimistic FIFO writes after an earlier write rolls back', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set('gc.value', '1');
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    backend.failOnce = (key, value) => key === 'gc.value' && value === '2';

    const first = store.update('gc.value', 0, 2);
    const second = store.update('gc.value', 0, 3);
    expect(store.read('gc.value', 0)).toBe(3);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.ok).toBe(false);
    expect(secondResult.ok).toBe(false);
    expect(backend.values.get('gc.value')).toBe('1');
    expect(store.read('gc.value', 0)).toBe(1);
    expect(store.getStatus().pending).toBe(0);
  });

  it('does not publish a stale reconciliation read over a newer revision', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set('gc.race', '1');
    let transaction = 0;
    const coordinator: StorageTransactionCoordinator = {
      recover: async () => ({ ok: true, outcome: 'clean', transactionId: null }),
      transact: async (mutations) => {
        transaction += 1;
        if (transaction === 1) {
          return {
            ok: false,
            outcome: 'rolled-back',
            transactionId: 'failed-1',
            error: {
              code: 'write_failed',
              stage: 'apply-operation',
              message: 'injected failure',
              transactionId: 'failed-1',
            },
          };
        }
        for (const mutation of mutations) {
          if (mutation.value == null) backend.values.delete(mutation.key);
          else backend.values.set(mutation.key, mutation.value);
        }
        return { ok: true, outcome: 'committed', transactionId: `committed-${transaction}` };
      },
      getStatus: () => ({
        pending: 0,
        dirty: false,
        blocked: false,
        initialized: true,
        phase: 'idle',
        transactionId: null,
        lastError: null,
      }),
      subscribe: () => () => undefined,
    };
    const store = new NativeStorageStore(backend, coordinator);
    expect((await store.initialize()).ready).toBe(true);
    const reconciliation = backend.pauseReadAt('gc.race', 1);

    const failed = store.update('gc.race', 0, 2);
    await reconciliation.entered;
    const newer = store.update('gc.race', 0, 3);
    expect((await newer).ok).toBe(true);
    expect(store.read('gc.race', 0)).toBe(3);
    reconciliation.release();

    expect((await failed).ok).toBe(false);
    expect(store.read('gc.race', 0)).toBe(3);
    expect(backend.values.get('gc.race')).toBe('3');
  });

  it('joins ambient nested updates into one two-key journal', async () => {
    const backend = new FakeNativeBackend();
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    // Ignore the version-stamp journal produced by initialization.
    backend.journalWrites.length = 0;

    const durability = store.runTransaction(() => {
      void store.update('gc.a', 0, value => value + 1);
      void store.update('gc.b', 10, value => value + 5);
      expect(store.read('gc.a', 0)).toBe(0); // notification/cache apply is atomic at batch end
    });

    expect(store.read('gc.a', 0)).toBe(1);
    expect(store.read('gc.b', 0)).toBe(15);
    expect((await durability).ok).toBe(true);
    expect(backend.journalWrites).toHaveLength(1);
    const journal = JSON.parse(backend.journalWrites[0]) as { operations: unknown[] };
    expect(journal.operations).toHaveLength(2);
    expect(backend.values.get('gc.a')).toBe('1');
    expect(backend.values.get('gc.b')).toBe('15');
  });

  it('stays ready and accepts FIFO writes while a verified transaction is in flight', async () => {
    const backend = new FakeNativeBackend();
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    const gate = backend.delayNextSet(STORAGE_TRANSACTION_JOURNAL_KEY);

    const first = store.update('gc.queued', 0, 1);
    await gate.entered;
    expect(store.getStatus()).toMatchObject({ ready: true, blocked: false, dirty: true });
    const second = store.update('gc.queued', 0, 2);
    expect(store.read('gc.queued', 0)).toBe(2);
    gate.release();

    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(backend.values.get('gc.queued')).toBe('2');
  });

  it('blocks reads and further writes when a failed write cannot be reconciled', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set('gc.unreconciled', '1');
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    backend.failOnce = (key, value) => key === 'gc.unreconciled' && value === '2';
    // capture, failed-write verification, rollback inspection, rollback
    // verification, then NativeStorageStore's authoritative reconciliation.
    backend.failReadAt('gc.unreconciled', 5);

    expect((await store.update('gc.unreconciled', 0, 2)).ok).toBe(false);
    expect(store.getStatus()).toMatchObject({ ready: false, blocked: true, dirty: true });
    await expect(store.listKeys()).rejects.toThrow('not ready');
    expect((await store.update('gc.other', 0, 1)).ok).toBe(false);
  });

  it('holds later writes behind a coherent multi-key snapshot barrier', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set('gc.snapshot.a', '1');
    backend.values.set('gc.snapshot.b', '1');
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    const gate = backend.pauseNextLiveRead('gc.snapshot.b');

    const snapshotPromise = store.readRawSnapshot((key) => key.startsWith('gc.snapshot.'));
    await gate.entered;
    const laterWrite = store.runTransaction(() => {
      void store.update('gc.snapshot.a', 0, 2);
      void store.update('gc.snapshot.b', 0, 2);
    });
    expect(store.read('gc.snapshot.a', 0)).toBe(2);
    expect(store.read('gc.snapshot.b', 0)).toBe(2);
    gate.release();

    const snapshot = await snapshotPromise;
    expect(Object.fromEntries(snapshot)).toEqual({
      'gc.snapshot.a': '1',
      'gc.snapshot.b': '1',
    });
    expect((await laterWrite).ok).toBe(true);
    expect(backend.values.get('gc.snapshot.a')).toBe('2');
    expect(backend.values.get('gc.snapshot.b')).toBe('2');
  });

  it('waits for every preceding reconciliation, not only the latest successful write', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set('gc.failed', '1');
    backend.values.set('gc.later', '1');
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    backend.failOnce = (key, value) => key === 'gc.failed' && value === '2';
    const reconciliation = backend.pauseReadAt('gc.failed', 5);

    const failedWrite = store.update('gc.failed', 0, 2);
    const laterWrite = store.update('gc.later', 0, 2);
    await reconciliation.entered;
    expect((await laterWrite).ok).toBe(true);

    let snapshotSettled = false;
    const snapshot = store.readRawSnapshot((key) => key === 'gc.failed' || key === 'gc.later');
    void snapshot.then(
      () => { snapshotSettled = true; },
      () => { snapshotSettled = true; },
    );
    await Promise.resolve();
    expect(snapshotSettled).toBe(false);
    reconciliation.release();

    expect((await failedWrite).ok).toBe(false);
    await expect(snapshot).rejects.toThrow('storage write');
  });
});
