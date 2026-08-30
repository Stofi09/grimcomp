import { describe, expect, it } from 'vitest';
import {
  STORAGE_TRANSACTION_JOURNAL_KEY,
  STORAGE_TRANSACTION_JOURNAL_KIND,
  STORAGE_TRANSACTION_JOURNAL_VERSION,
  createStorageCoordinator,
  type RawAsyncKeyValue,
  type StorageTransactionCoordinator,
} from '@grimcomp/core';
import {
  NATIVE_RECOVERY_RESET_INTENT_KEY,
  NativeStorageStore,
} from '../../../src/storage/nativeStore';
import {
  NATIVE_RECOVERY_RESET_INTENT_RAW,
  NATIVE_RECOVERY_RESET_WITNESS_KEY,
  NATIVE_RECOVERY_RESET_WITNESS_RAW,
} from '../../../src/storage/nativeRecoveryKeys';
import {
  NATIVE_STORAGE_VERSION_KEY,
  runNativeStorageMigrations,
} from '../../../src/storage/migrations';
import { CHARACTER_TEMPLATES } from '../../../src/data/character';
import {
  applyNativeEndOfSceneUpdates,
  locateCriticalOccurrence,
  removeCriticalOccurrence,
} from '../../../src/screens/nativeWoundsState';

class FakeNativeBackend implements RawAsyncKeyValue {
  readonly values = new Map<string, string>();
  readonly journalWrites: string[] = [];
  readonly writes: Array<{ key: string; value: string | null }> = [];
  failOnce: ((key: string, value: string | null) => boolean) | null = null;
  commitThenFailOnce: ((key: string, value: string | null) => boolean) | null = null;
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
    if (this.commitThenFailOnce?.(key, value)) {
      this.commitThenFailOnce = null;
      this.values.set(key, value);
      if (key === STORAGE_TRANSACTION_JOURNAL_KEY) this.journalWrites.push(value);
      throw new Error('injected post-commit write failure');
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
    ['noncanonical decimal', '1.0', 'malformed'],
    ['noncanonical whitespace', ' 1 ', 'malformed'],
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
    NATIVE_RECOVERY_RESET_INTENT_KEY,
    NATIVE_RECOVERY_RESET_WITNESS_KEY,
  ])('rejects a migration that tries to write reset authorization key %s', async (reservedKey) => {
    const backend = new FakeNativeBackend();
    backend.values.set('gc.character', JSON.stringify({ id: 'c1' }));
    const coordinator = await recoveredCoordinator(backend);

    const result = await runNativeStorageMigrations(backend, coordinator, {
      currentVersion: 2,
      migrations: { 1: async () => [{ key: reservedKey, value: 'forged' }] },
    });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('reserved internal key') });
    expect(backend.values.has(reservedKey)).toBe(false);
    expect(backend.values.has(NATIVE_STORAGE_VERSION_KEY)).toBe(false);
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
  it('reports an ordinary booting state before first initialization starts', () => {
    const backend = new FakeNativeBackend();
    const store = new NativeStorageStore(backend, coordinatorFor(backend));

    expect(store.getStatus()).toMatchObject({
      phase: 'booting',
      ready: false,
      blocked: false,
      initialized: false,
    });
  });

  it('can retry a transiently blocked initialization without restarting the process', async () => {
    const backend = new FakeNativeBackend();
    let failRecovery = true;
    const base = coordinatorFor(backend);
    const coordinator: StorageTransactionCoordinator = {
      recover: async () => {
        if (failRecovery) {
          failRecovery = false;
          return {
            ok: false,
            outcome: 'blocked',
            transactionId: null,
            error: {
              code: 'read_failed',
              stage: 'inspect-journal',
              message: 'injected transient recovery failure',
            },
          };
        }
        return base.recover();
      },
      transact: (mutations) => base.transact(mutations),
      getStatus: () => base.getStatus(),
      subscribe: (listener) => base.subscribe(listener),
    };
    const store = new NativeStorageStore(backend, coordinator);

    expect((await store.initialize()).blocked).toBe(true);
    await expect(store.retryInitialization()).resolves.toMatchObject({ ready: true, blocked: false });
    expect((await store.update('gc.after-retry', 0, 1)).ok).toBe(true);
  });

  it('blocks startup on malformed stored JSON instead of silently substituting a seed', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set('gc.corrupt', '{nope');
    const store = new NativeStorageStore(backend, coordinatorFor(backend));

    await expect(store.initialize()).resolves.toMatchObject({
      ready: false,
      blocked: true,
      lastError: { code: 'initialization_failed', message: expect.stringContaining('gc.corrupt') },
    });
    expect(backend.values.get('gc.corrupt')).toBe('{nope');
    await expect(store.update('gc.other', 0, 1)).resolves.toMatchObject({ ok: false, outcome: 'blocked' });

    await expect(store.readRecoverySnapshot()).resolves.toEqual(new Map([
      [NATIVE_STORAGE_VERSION_KEY, '1'],
      ['gc.corrupt', '{nope'],
    ]));
    await expect(store.resetDataForRecovery()).resolves.toMatchObject({ ok: true });
    expect(backend.values.get(NATIVE_STORAGE_VERSION_KEY)).toBe('1');
    expect(backend.values.has('gc.corrupt')).toBe(false);
    expect(store.getStatus()).toMatchObject({ ready: true, blocked: false });
  });

  it('exports a corrupt recovery journal verbatim without trying to apply it', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set('gc.keep-for-diagnostic', '{bad-value');
    backend.values.set(STORAGE_TRANSACTION_JOURNAL_KEY, '{bad-journal');
    const store = new NativeStorageStore(backend, coordinatorFor(backend));

    await expect(store.initialize()).resolves.toMatchObject({ ready: false, blocked: true });
    await expect(store.readRecoverySnapshot()).resolves.toEqual(new Map([
      [NATIVE_STORAGE_VERSION_KEY, '1'],
      ['gc.keep-for-diagnostic', '{bad-value'],
      [STORAGE_TRANSACTION_JOURNAL_KEY, '{bad-journal'],
    ]));
    expect(backend.values.get(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe('{bad-journal');
  });

  it('uses an explicit recovery reset to escape a malformed journal', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set('gc.corrupt', '{bad-value');
    backend.values.set(STORAGE_TRANSACTION_JOURNAL_KEY, '{bad-journal');
    const store = new NativeStorageStore(backend, coordinatorFor(backend));

    await expect(store.initialize()).resolves.toMatchObject({ ready: false, blocked: true });
    await expect(store.resetDataForRecovery()).resolves.toMatchObject({
      ok: true,
      outcome: 'committed',
    });

    expect(backend.values).toEqual(new Map([[NATIVE_STORAGE_VERSION_KEY, '1']]));
    expect(store.getStatus()).toMatchObject({ ready: true, blocked: false });
  });

  it('uses an explicit recovery reset to escape a divergent journal conflict', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set('gc.conflicted', '"neither-before-nor-after"');
    backend.values.set(STORAGE_TRANSACTION_JOURNAL_KEY, JSON.stringify({
      kind: STORAGE_TRANSACTION_JOURNAL_KIND,
      version: STORAGE_TRANSACTION_JOURNAL_VERSION,
      transactionId: 'conflicted-reset-test',
      operations: [{
        key: 'gc.conflicted',
        before: '"before"',
        after: '"after"',
      }],
    }));
    const store = new NativeStorageStore(backend, coordinatorFor(backend));

    await expect(store.initialize()).resolves.toMatchObject({
      ready: false,
      blocked: true,
      lastError: { message: expect.stringContaining('diverged') },
    });
    await expect(store.resetDataForRecovery()).resolves.toMatchObject({ ok: true });

    expect(backend.values).toEqual(new Map([[NATIVE_STORAGE_VERSION_KEY, '1']]));
    expect(store.getStatus()).toMatchObject({ ready: true, blocked: false });
  });

  it('replaces a malformed reset intent only after a new explicit reset', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set('gc.preserved-until-confirmed', '7');
    backend.values.set(NATIVE_RECOVERY_RESET_INTENT_KEY, '{malformed-intent');
    const store = new NativeStorageStore(backend, coordinatorFor(backend));

    await expect(store.initialize()).resolves.toMatchObject({
      ready: false,
      blocked: true,
      lastError: { message: expect.stringContaining('confirmation witness') },
    });
    expect(backend.values.get('gc.preserved-until-confirmed')).toBe('7');

    await expect(store.resetDataForRecovery()).resolves.toMatchObject({ ok: true });
    expect(backend.values).toEqual(new Map([[NATIVE_STORAGE_VERSION_KEY, '1']]));
  });

  it('resets more keys than one journal transaction can contain', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set(STORAGE_TRANSACTION_JOURNAL_KEY, '{bad-journal');
    for (let index = 0; index < 1_001; index += 1) {
      backend.values.set(`gc.bulk.${index}`, String(index));
    }
    const store = new NativeStorageStore(backend, coordinatorFor(backend));

    await expect(store.initialize()).resolves.toMatchObject({ ready: false, blocked: true });
    await expect(store.resetDataForRecovery()).resolves.toMatchObject({ ok: true });
    expect(backend.values).toEqual(new Map([[NATIVE_STORAGE_VERSION_KEY, '1']]));
  });

  it('preserves data when a reset intent exists without a confirmation witness', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set('gc.keep', '7');
    backend.values.set(NATIVE_RECOVERY_RESET_INTENT_KEY, NATIVE_RECOVERY_RESET_INTENT_RAW);
    const before = new Map(backend.values);
    const store = new NativeStorageStore(backend, coordinatorFor(backend));

    await expect(store.initialize()).resolves.toMatchObject({
      ready: false,
      blocked: true,
      lastError: { message: expect.stringContaining('confirmation witness') },
    });
    expect(backend.values).toEqual(before);
  });

  it('classifies an intent write that commits before rejecting and completes the confirmed reset', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set('gc.keep', '7');
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    await expect(store.initialize()).resolves.toMatchObject({ ready: true });
    backend.commitThenFailOnce = (key) => key === NATIVE_RECOVERY_RESET_INTENT_KEY;

    await expect(store.resetDataForRecovery()).resolves.toMatchObject({ ok: true, outcome: 'committed' });
    expect(backend.values).toEqual(new Map([[NATIVE_STORAGE_VERSION_KEY, '1']]));
  });

  it('rejects late writes while a recovery reset owns the store', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set('gc.keep', '7');
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    await expect(store.initialize()).resolves.toMatchObject({ ready: true });
    const gate = backend.delayNextSet(NATIVE_RECOVERY_RESET_WITNESS_KEY);

    const reset = store.resetDataForRecovery();
    await gate.entered;
    await expect(store.update('gc.late', 0, 1)).resolves.toMatchObject({
      ok: false,
      outcome: 'blocked',
      error: { code: 'not_ready' },
    });
    gate.release();

    await expect(reset).resolves.toMatchObject({ ok: true });
    expect(backend.values.has('gc.late')).toBe(false);
  });

  it.each([
    ['data removal', (key: string, value: string | null) => key === 'gc.crash-stage' && value === null],
    ['journal removal', (key: string, value: string | null) => key === STORAGE_TRANSACTION_JOURNAL_KEY && value === null],
    ['version stamp', (key: string, value: string | null) => key === NATIVE_STORAGE_VERSION_KEY && value === '1'],
    ['intent clear', (key: string, value: string | null) => key === NATIVE_RECOVERY_RESET_INTENT_KEY && value === null],
    ['witness clear', (key: string, value: string | null) => key === NATIVE_RECOVERY_RESET_WITNESS_KEY && value === null],
  ])('resumes an interrupted recovery reset after a crash during %s', async (_stage, fail) => {
    const backend = new FakeNativeBackend();
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set('gc.crash-stage', '{bad-value');
    backend.values.set(STORAGE_TRANSACTION_JOURNAL_KEY, '{bad-journal');
    const interrupted = new NativeStorageStore(backend, coordinatorFor(backend));
    await expect(interrupted.initialize()).resolves.toMatchObject({ ready: false, blocked: true });
    backend.failOnce = fail;

    await expect(interrupted.resetDataForRecovery()).resolves.toMatchObject({
      ok: false,
      outcome: 'blocked',
    });
    expect(backend.values.get(NATIVE_RECOVERY_RESET_WITNESS_KEY)).toBe(NATIVE_RECOVERY_RESET_WITNESS_RAW);

    const restarted = new NativeStorageStore(backend, coordinatorFor(backend));
    await expect(restarted.initialize()).resolves.toMatchObject({ ready: true, blocked: false });
    expect(backend.values).toEqual(new Map([[NATIVE_STORAGE_VERSION_KEY, '1']]));
  });

  it('does not report reset success when the clean store fails to reinitialize', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set(STORAGE_TRANSACTION_JOURNAL_KEY, '{bad-journal');
    const base = coordinatorFor(backend);
    let recoverCalls = 0;
    const coordinator: StorageTransactionCoordinator = {
      recover: async () => {
        recoverCalls += 1;
        if (recoverCalls === 2) {
          return {
            ok: false,
            outcome: 'blocked',
            transactionId: null,
            error: {
              code: 'read_failed',
              stage: 'inspect-journal',
              message: 'injected post-reset initialization failure',
            },
          };
        }
        return base.recover();
      },
      transact: (mutations) => base.transact(mutations),
      getStatus: () => base.getStatus(),
      subscribe: (listener) => base.subscribe(listener),
    };
    const store = new NativeStorageStore(backend, coordinator);
    await expect(store.initialize()).resolves.toMatchObject({ ready: false, blocked: true });

    await expect(store.resetDataForRecovery()).resolves.toMatchObject({
      ok: false,
      outcome: 'blocked',
      error: {
        code: 'initialization_failed',
        message: expect.stringContaining('post-reset initialization failure'),
      },
    });
    expect(backend.values).toEqual(new Map([[NATIVE_STORAGE_VERSION_KEY, '1']]));
    expect(store.getStatus()).toMatchObject({ ready: false, blocked: true });

    await expect(store.retryInitialization()).resolves.toMatchObject({ ready: true, blocked: false });
  });

  it('keeps internal storage keys out of normal snapshots, key lists, hydration, and writes', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set('gc.visible', '1');
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    await expect(store.initialize()).resolves.toMatchObject({ ready: true });
    const resetIntentRaw = JSON.stringify({
      kind: 'grimcomp.native.recovery-reset',
      version: 1,
    });
    backend.values.set(NATIVE_RECOVERY_RESET_INTENT_KEY, resetIntentRaw);
    backend.values.set(NATIVE_RECOVERY_RESET_WITNESS_KEY, NATIVE_RECOVERY_RESET_WITNESS_RAW);

    await expect(store.readRawSnapshot(() => true)).resolves.toEqual(new Map([
      ['gc.visible', '1'],
    ]));
    await expect(store.listKeys()).resolves.toEqual(['gc.visible']);
    await expect(store.hydrate(NATIVE_RECOVERY_RESET_INTENT_KEY, 'seed')).resolves.toBe('seed');
    await expect(store.hydrate(NATIVE_RECOVERY_RESET_WITNESS_KEY, 'seed')).resolves.toBe('seed');
    await expect(store.hydrate(NATIVE_STORAGE_VERSION_KEY, 'seed')).resolves.toBe('seed');
    expect(store.isHydrated(NATIVE_RECOVERY_RESET_INTENT_KEY)).toBe(false);
    expect(store.isHydrated(NATIVE_RECOVERY_RESET_WITNESS_KEY)).toBe(false);
    expect(store.isHydrated(NATIVE_STORAGE_VERSION_KEY)).toBe(false);
    expect(store.knownKeys(() => true)).not.toContain(NATIVE_RECOVERY_RESET_INTENT_KEY);

    await expect(store.runTransaction((transaction) => {
      transaction.setRaw(NATIVE_RECOVERY_RESET_INTENT_KEY, '"replacement"');
    })).resolves.toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'invalid_key', key: NATIVE_RECOVERY_RESET_INTENT_KEY },
    });
    expect(backend.values.get(NATIVE_RECOVERY_RESET_INTENT_KEY)).toBe(resetIntentRaw);
  });

  it.each([
    ['future', JSON.stringify(9)],
    ['malformed', '{bad-version'],
  ])('recovery reset replaces a %s version marker after removing data', async (_label, versionRaw) => {
    const backend = new FakeNativeBackend();
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, versionRaw);
    backend.values.set('gc.future-data', JSON.stringify({ incompatible: true }));
    const store = new NativeStorageStore(
      backend,
      coordinatorFor(backend),
      { currentVersion: 2, migrations: {} },
    );

    await expect(store.initialize()).resolves.toMatchObject({ ready: false, blocked: true });
    await expect(store.resetDataForRecovery()).resolves.toMatchObject({ ok: true, outcome: 'committed' });
    expect(backend.values.get(NATIVE_STORAGE_VERSION_KEY)).toBe('2');
    expect(backend.values.has('gc.future-data')).toBe(false);
    expect(store.getStatus()).toMatchObject({ ready: true, blocked: false });
  });

  it('blocks startup on parseable data whose known native shape is incompatible', async () => {
    const backend = new FakeNativeBackend();
    const incompatible = JSON.stringify({ current: 10, spent: 5, log: 'not-an-array' });
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set('gc.c1.xp', incompatible);
    const store = new NativeStorageStore(backend, coordinatorFor(backend));

    await expect(store.initialize()).resolves.toMatchObject({
      ready: false,
      blocked: true,
      lastError: {
        code: 'initialization_failed',
        message: expect.stringContaining('gc.c1.xp'),
      },
    });
    expect(backend.values.get('gc.c1.xp')).toBe(incompatible);
    await expect(store.readRecoverySnapshot()).resolves.toEqual(new Map([
      [NATIVE_STORAGE_VERSION_KEY, '1'],
      ['gc.c1.xp', incompatible],
    ]));
  });

  it.each(['missing-character', 'toString'])(
    'blocks startup when the active native character %s is not an own roster entry',
    async (activeId) => {
      const backend = new FakeNativeBackend();
      backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
      backend.values.set('gc.activeCharId', JSON.stringify(activeId));
      const store = new NativeStorageStore(backend, coordinatorFor(backend));

      await expect(store.initialize()).resolves.toMatchObject({
        ready: false,
        blocked: true,
        lastError: { code: 'initialization_failed' },
      });
      expect(backend.values.get('gc.activeCharId')).toBe(JSON.stringify(activeId));
    },
  );

  it('retains unknown future gc data while validating known shapes', async () => {
    const backend = new FakeNativeBackend();
    const future = { version: 7, nested: [{ enabled: true }] };
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set('gc.future.overlay', JSON.stringify(future));
    const store = new NativeStorageStore(backend, coordinatorFor(backend));

    expect((await store.initialize()).ready).toBe(true);
    expect(store.read('gc.future.overlay', null)).toEqual(future);
  });

  it('blocks an incompatible late hydration instead of silently returning its seed', async () => {
    const backend = new FakeNativeBackend();
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    backend.values.set('gc.c1.vitals', JSON.stringify({ fate: 3 }));

    const seed = { fate: 3, fortune: 3, resilience: 2, resolve: 2, corruption: 0 };
    await expect(store.hydrate('gc.c1.vitals', seed)).resolves.toEqual(seed);
    expect(store.getStatus()).toMatchObject({
      ready: false,
      blocked: true,
      dirty: true,
      lastError: { code: 'invalid_data', key: 'gc.c1.vitals' },
    });
  });

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

  it('does not replay a reconciled historical failure from an idle flush', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set('gc.recovered', '1');
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    backend.failOnce = (key, value) => key === 'gc.recovered' && value === '2';

    expect((await store.update('gc.recovered', 0, 2)).ok).toBe(false);
    expect(store.read('gc.recovered', 0)).toBe(1);
    await expect(store.flush()).resolves.toMatchObject({ ok: true, outcome: 'unchanged' });
    await expect(store.readRawSnapshot((key) => key === 'gc.recovered')).resolves.toEqual(
      new Map([['gc.recovered', '1']]),
    );
  });

  it('never exposes the native schema version as a removable data key', async () => {
    const backend = new FakeNativeBackend();
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);

    expect(store.knownKeys(() => true)).not.toContain(NATIVE_STORAGE_VERSION_KEY);
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

  it('registers durability before a reentrant key listener queues another write', async () => {
    const backend = new FakeNativeBackend();
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);

    let reentrant: Promise<unknown> | null = null;
    let triggered = false;
    store.subscribeKey('gc.reentrant', () => {
      if (triggered) return;
      triggered = true;
      reentrant = store.update<number>('gc.reentrant', 0, value => value + 1);
    });

    const first = store.update<number>('gc.reentrant', 0, value => value + 1);
    expect(store.read('gc.reentrant', 0)).toBe(2);
    expect((await first).ok).toBe(true);
    expect(reentrant).not.toBeNull();
    expect((await reentrant!).ok).toBe(true);
    expect(store.read('gc.reentrant', 0)).toBe(2);
    expect(backend.values.get('gc.reentrant')).toBe('2');
  });

  it('publishes a failed multi-key reconciliation only after every key is restored', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set('gc.rollback.a', '1');
    backend.values.set('gc.rollback.b', '1');
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    backend.failOnce = (key, value) => key === 'gc.rollback.b' && value === '2';

    const observedB: number[] = [];
    store.subscribeKey('gc.rollback.a', () => {
      observedB.push(store.read('gc.rollback.b', 0));
    });
    const result = await store.runTransaction(() => {
      void store.update('gc.rollback.a', 0, 2);
      void store.update('gc.rollback.b', 0, 2);
    });

    expect(result.ok).toBe(false);
    expect(observedB).toEqual([2, 1]);
    expect(store.read('gc.rollback.a', 0)).toBe(1);
    expect(store.read('gc.rollback.b', 0)).toBe(1);
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

  it('rejects async callbacks and blocks global writes from their late continuation', async () => {
    const backend = new FakeNativeBackend();
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    backend.journalWrites.length = 0;

    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    let continuationFinished!: () => void;
    const continuation = new Promise<void>((resolve) => { continuationFinished = resolve; });

    const result = await store.runTransaction(async (transaction) => {
      transaction.setRaw('gc.async-prefix', '1');
      await gate;
      try {
        void store.update('gc.async-global-suffix', 0, 2);
        transaction.setRaw('gc.async-captured-suffix', '2');
      } finally {
        continuationFinished();
      }
    });

    expect(result).toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'transaction_failed', message: expect.stringContaining('synchronous') },
    });
    expect(backend.values.has('gc.async-prefix')).toBe(false);
    expect(backend.journalWrites).toHaveLength(0);

    resume();
    await continuation;
    await Promise.resolve();
    expect(backend.values.has('gc.async-global-suffix')).toBe(false);
    expect(backend.values.has('gc.async-captured-suffix')).toBe(false);

    expect((await store.update('gc.async-retry', 0, 1)).ok).toBe(true);
    expect(backend.values.get('gc.async-retry')).toBe('1');
  });

  it('rejects async functional updaters without persisting a Promise-shaped value', async () => {
    const backend = new FakeNativeBackend();
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);

    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    let continuationFinished!: () => void;
    const continuation = new Promise<void>((resolve) => { continuationFinished = resolve; });
    const asyncUpdater = (async (previous: number) => {
      await gate;
      try {
        void store.update('gc.async-updater-suffix', 0, 1);
        return previous + 1;
      } finally {
        continuationFinished();
      }
    }) as unknown as (previous: number) => number;

    const result = await store.update('gc.async-updater', 0, asyncUpdater);
    expect(result).toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'transaction_failed', key: 'gc.async-updater' },
    });
    expect(backend.values.has('gc.async-updater')).toBe(false);

    resume();
    await continuation;
    await Promise.resolve();
    expect(backend.values.has('gc.async-updater-suffix')).toBe(false);
  });

  it('persists mutating functional updaters without aliasing the committed cache', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set('gc.mutable', JSON.stringify({ count: 1 }));
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);

    const result = await store.update('gc.mutable', { count: 0 }, (previous) => {
      previous.count = 2;
      return previous;
    });

    expect(result.ok).toBe(true);
    expect(store.read('gc.mutable', { count: 0 })).toEqual({ count: 2 });
    expect(JSON.parse(backend.values.get('gc.mutable') ?? '{}')).toEqual({ count: 2 });
  });

  it('isolates a missing key updater from its caller-owned object seed', async () => {
    const backend = new FakeNativeBackend();
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    const seed = { count: 0 };

    const result = await store.update('gc.mutable-seed', seed, (previous) => {
      previous.count = 1;
      return previous;
    });

    expect(result.ok).toBe(true);
    expect(seed).toEqual({ count: 0 });
    expect(store.read('gc.mutable-seed', seed)).toEqual({ count: 1 });
  });

  it('isolates a missing-key transaction read from its caller-owned seed', async () => {
    const backend = new FakeNativeBackend();
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    const seed = { nested: { count: 0 } };

    const result = await store.runTransaction((transaction) => {
      const value = transaction.read('gc.read-seed', seed);
      value.nested.count = 1;
    });

    expect(result).toMatchObject({ ok: true, outcome: 'unchanged' });
    expect(seed).toEqual({ nested: { count: 0 } });
  });

  it('rejects malformed raw JSON before it can enter native storage', async () => {
    const backend = new FakeNativeBackend();
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);

    const result = await store.runTransaction((transaction) => {
      transaction.setRaw('gc.malformed', '{nope');
    });

    expect(result).toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'serialization_failed', key: 'gc.malformed' },
    });
    expect(backend.values.has('gc.malformed')).toBe(false);
  });

  it('rejects parseable but incompatible values before they enter native storage', async () => {
    const backend = new FakeNativeBackend();
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);

    const updateResult = await store.update(
      'gc.c1.xp',
      { current: 0, spent: 0, log: [] },
      [] as never,
    );
    expect(updateResult).toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'invalid_data', key: 'gc.c1.xp' },
    });

    const rawResult = await store.runTransaction((transaction) => {
      transaction.setRaw('gc.c1.conditions', JSON.stringify({ Fatigued: 'many' }));
    });
    expect(rawResult).toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'invalid_data', key: 'gc.c1.conditions' },
    });
    expect(backend.values.has('gc.c1.xp')).toBe(false);
    expect(backend.values.has('gc.c1.conditions')).toBe(false);

    await expect(store.update('gc.future.overlay', null, { shape: ['preserved'] })).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(backend.values.get('gc.future.overlay') ?? 'null')).toEqual({ shape: ['preserved'] });
  });

  it('groups the native character-creation lifecycle into one four-key journal', async () => {
    const backend = new FakeNativeBackend();
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set('gc.activeCharId', JSON.stringify('c1'));
    backend.values.set('gc.newchar.draft', JSON.stringify({
      name: 'Marta', species: 'Human', archetypeKey: 'warrior', inits: {},
    }));
    backend.values.set('gc.newchar.step', '3');
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    backend.journalWrites.length = 0;

    const created = { ...CHARACTER_TEMPLATES.c1, id: 'c5', name: 'Marta' };
    const result = await store.runTransaction(() => {
      void store.update<Record<string, unknown>>('gc.customChars', {}, previous => ({
        ...previous,
        [created.id]: created,
      }));
      void store.update('gc.activeCharId', 'c1', created.id);
      void store.update(
        'gc.newchar.draft',
        { name: '', species: 'Human', archetypeKey: 'warrior', inits: {} },
        { name: '', species: 'Human', archetypeKey: 'warrior', inits: {} },
      );
      void store.update('gc.newchar.step', 0, 0);
    });

    expect(result.ok).toBe(true);
    expect(backend.journalWrites).toHaveLength(1);
    const journal = JSON.parse(backend.journalWrites[0]) as {
      operations: Array<{ key: string }>;
    };
    expect(journal.operations.map(operation => operation.key).sort()).toEqual([
      'gc.activeCharId',
      'gc.customChars',
      'gc.newchar.draft',
      'gc.newchar.step',
    ]);
    expect(JSON.parse(backend.values.get('gc.customChars') ?? '{}')).toEqual({ c5: created });
    expect(JSON.parse(backend.values.get('gc.activeCharId') ?? 'null')).toBe('c5');
    expect(JSON.parse(backend.values.get('gc.newchar.draft') ?? 'null')).toEqual({
      name: '', species: 'Human', archetypeKey: 'warrior', inits: {},
    });
    expect(backend.values.get('gc.newchar.step')).toBe('0');
  });

  it('rolls back the native roster lifecycle when its final active-id write fails', async () => {
    const backend = new FakeNativeBackend();
    const customId = 'custom-native-delete';
    const customRaw = JSON.stringify({
      [customId]: { ...CHARACTER_TEMPLATES.c1, id: customId, name: 'Marta' },
    });
    const activeRaw = JSON.stringify(customId);
    const woundsRaw = '7';
    const xpRaw = JSON.stringify({ current: 125, spent: 50, log: [] });
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set('gc.customChars', customRaw);
    backend.values.set('gc.activeCharId', activeRaw);
    backend.values.set(`gc.${customId}.wounds`, woundsRaw);
    backend.values.set(`gc.${customId}.xp`, xpRaw);
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    backend.journalWrites.length = 0;
    backend.failOnce = (key, value) => (
      key === 'gc.activeCharId' && value === JSON.stringify('c1')
    );

    const result = await store.runTransaction(() => {
      // Mirrors RosterScreen -> useRoster.remove: the nested operations join
      // the screen's ambient transaction with the active-character fallback.
      void store.runTransaction((transaction) => {
        for (const key of store.knownKeys(key => key.startsWith(`gc.${customId}.`))) {
          transaction.remove(key);
        }
        void store.update<Record<string, unknown>>('gc.customChars', {}, previous => {
          const { [customId]: _drop, ...remaining } = previous;
          return remaining;
        });
      });
      void store.update('gc.activeCharId', 'c1', 'c1');
    });

    expect(result).toMatchObject({ ok: false, outcome: 'rolled-back' });
    expect(backend.journalWrites).toHaveLength(1);
    const journal = JSON.parse(backend.journalWrites[0]) as {
      operations: Array<{ key: string }>;
    };
    expect(journal.operations.map(operation => operation.key).sort()).toEqual([
      'gc.activeCharId',
      'gc.customChars',
      `gc.${customId}.wounds`,
      `gc.${customId}.xp`,
    ].sort());
    expect(backend.values.get('gc.customChars')).toBe(customRaw);
    expect(backend.values.get('gc.activeCharId')).toBe(activeRaw);
    expect(backend.values.get(`gc.${customId}.wounds`)).toBe(woundsRaw);
    expect(backend.values.get(`gc.${customId}.xp`)).toBe(xpRaw);
    expect(backend.values.has(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(false);
    expect(store.read('gc.activeCharId', 'c1')).toBe(customId);
  });

  it('rolls Fortune, critical healing, and condition clocks back together', async () => {
    const backend = new FakeNativeBackend();
    const vitalsKey = 'gc.c1.vitals';
    const criticalsKey = 'gc.c1.criticals';
    const conditionsKey = 'gc.c1.conditions';
    const vitals = {
      fate: 2,
      fortune: 0,
      resilience: 1,
      resolve: 1,
      corruption: 0,
    };
    const criticals = [
      { loc: 'Head', roll: 11, name: 'Closing cut', effect: 'Nearly healed.', days: 1 },
      { loc: 'Body', roll: 55, name: 'Deep bruise', effect: 'Still painful.', days: 3 },
    ];
    const conditions = { Bleeding: 2, Surprised: 3, Prone: 0 };
    const vitalsRaw = JSON.stringify(vitals);
    const criticalsRaw = JSON.stringify(criticals);
    const conditionsRaw = JSON.stringify(conditions);
    backend.values.set(NATIVE_STORAGE_VERSION_KEY, '1');
    backend.values.set(vitalsKey, vitalsRaw);
    backend.values.set(criticalsKey, criticalsRaw);
    backend.values.set(conditionsKey, conditionsRaw);
    const store = new NativeStorageStore(backend, coordinatorFor(backend));
    expect((await store.initialize()).ready).toBe(true);
    backend.journalWrites.length = 0;
    backend.failOnce = (key, value) => key === conditionsKey && value !== conditionsRaw;

    let summary = { healed: 0, removedConditions: 0 };
    const result = await store.runTransaction(() => {
      summary = applyNativeEndOfSceneUpdates({
        refreshFortune: () => store.update(vitalsKey, vitals, previous => ({
          ...previous,
          fortune: previous.fate,
        })),
        replaceCriticals: update => store.update(criticalsKey, criticals, update),
        updateConditions: update => store.update(conditionsKey, conditions, update),
      });
    });

    expect(summary).toEqual({ healed: 1, removedConditions: 1 });
    expect(result).toMatchObject({ ok: false, outcome: 'rolled-back' });
    expect(backend.journalWrites).toHaveLength(1);
    const journal = JSON.parse(backend.journalWrites[0]) as {
      operations: Array<{ key: string }>;
    };
    expect(journal.operations.map(operation => operation.key)).toEqual([
      vitalsKey,
      criticalsKey,
      conditionsKey,
    ]);
    expect(backend.values.get(vitalsKey)).toBe(vitalsRaw);
    expect(backend.values.get(criticalsKey)).toBe(criticalsRaw);
    expect(backend.values.get(conditionsKey)).toBe(conditionsRaw);
    expect(backend.values.has(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(false);
    expect(store.read(vitalsKey, null)).toEqual(vitals);
    expect(store.read(criticalsKey, null)).toEqual(criticals);
    expect(store.read(conditionsKey, null)).toEqual(conditions);
  });

  it('resolves only the selected occurrence among equal native criticals', () => {
    const first = {
      loc: 'Head', roll: 22, name: 'Identical cut', effect: 'Same effect.', days: 4,
    };
    const selected = { ...first };
    const other = {
      loc: 'Arm', roll: 73, name: 'Other wound', effect: 'Different effect.', days: 2,
    };
    const located = locateCriticalOccurrence([first, selected, other], 1);

    expect(located).toEqual({ critical: selected, occurrence: 1 });
    const removal = removeCriticalOccurrence(
      [first, selected, other],
      located!.critical,
      located!.occurrence,
    );

    expect(removal.removed).toBe(true);
    expect(removal.criticals).toHaveLength(2);
    expect(removal.criticals[0]).toBe(first);
    expect(removal.criticals[1]).toBe(other);
    expect(removal.criticals).not.toContain(selected);
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
