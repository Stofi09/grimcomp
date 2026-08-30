import {
  MAX_TRANSACTION_OPERATIONS,
  STORAGE_TRANSACTION_JOURNAL_KEY,
  STORAGE_TRANSACTION_JOURNAL_KIND,
  STORAGE_TRANSACTION_JOURNAL_VERSION,
  createStorageCoordinator,
  serializeStorageJournal,
  type RawAsyncKeyValue,
  type StorageExclusiveLock,
  type StorageTransactionCoordinator,
} from '@grimcomp/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  StorageCore,
  type StorageBackend,
  type StorageCoreOptions,
} from './storageCore';
import { STORAGE_VERSION, STORAGE_VERSION_KEY } from '@/storage/storageSchema';

interface FakeBackend extends StorageBackend {
  readonly store: Map<string, string>;
  readonly setLog: string[];
}

function fakeBackend(): FakeBackend {
  const store = new Map<string, string>();
  const setLog: string[] = [];
  return {
    store,
    setLog,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { setLog.push(key); store.set(key, value); },
    removeItem: (key) => { store.delete(key); },
    keys: () => [...store.keys()],
  };
}

function rawStore(backend: StorageBackend): RawAsyncKeyValue {
  return {
    getItem: async (key) => backend.getItem(key),
    setItem: async (key, value) => { backend.setItem(key, value); },
    removeItem: async (key) => { backend.removeItem(key); },
  };
}

let transactionId = 0;
async function initializedCore(
  backend: FakeBackend,
  lock?: StorageExclusiveLock,
  options?: StorageCoreOptions,
): Promise<{ core: StorageCore; coordinator: StorageTransactionCoordinator }> {
  const coordinator = createStorageCoordinator(rawStore(backend), {
    ...(lock ? { withExclusiveLock: lock } : {}),
    createTransactionId: () => `web-test-${++transactionId}`,
  });
  const recovery = await coordinator.recover();
  expect(recovery.ok).toBe(true);
  return { core: new StorageCore(backend, coordinator, options), coordinator };
}

const fenceOptions: StorageCoreOptions = {
  reservedFence: {
    key: STORAGE_VERSION_KEY,
    expectedRaw: JSON.stringify(STORAGE_VERSION),
  },
};

function fifoExclusiveLock(): StorageExclusiveLock {
  let tail = Promise.resolve();
  return async <T>(work: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let release = () => undefined;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  };
}

describe('StorageCore durable publication', () => {
  let backend: FakeBackend;
  let core: StorageCore;
  let coordinator: StorageTransactionCoordinator;

  beforeEach(async () => {
    backend = fakeBackend();
    ({ core, coordinator } = await initializedCore(backend));
  });

  it('does not publish until persistence commits', async () => {
    let notifications = 0;
    core.subscribe('gc.x', () => { notifications += 1; });

    const ticket = core.update('gc.x', 0, 7);
    expect(ticket.value).toBe(7);
    expect(core.read('gc.x', 0)).toBe(0);
    expect(notifications).toBe(0);
    expect(core.getStatus()).toMatchObject({ pending: 1, dirty: true });

    await expect(ticket.completion).resolves.toMatchObject({ ok: true, outcome: 'committed' });
    expect(backend.getItem('gc.x')).toBe('7');
    expect(core.read('gc.x', 0)).toBe(7);
    expect(notifications).toBe(1);
    expect(core.getStatus()).toMatchObject({ pending: 0, dirty: false });
  });

  it('resolves queued functional updates synchronously in call order', async () => {
    const first = core.update<number>('gc.n', 0, previous => previous + 1);
    const second = core.update<number>('gc.n', 0, previous => previous + 1);

    expect(first.value).toBe(1);
    expect(second.value).toBe(2);
    await Promise.all([first.completion, second.completion]);
    expect(core.read('gc.n', 0)).toBe(2);
    expect(backend.getItem('gc.n')).toBe('2');
  });

  it('does not report an identical queued value durable before its dependency settles', async () => {
    const originalSet = backend.setItem;
    let fail = true;
    backend.setItem = (key, value) => {
      if (key === 'gc.same' && fail) {
        fail = false;
        throw new Error('injected first-write failure');
      }
      originalSet(key, value);
    };

    const first = core.update('gc.same', 0, 1);
    const same = core.update('gc.same', 0, 1);
    expect(same.value).toBe(1);
    await expect(first.completion).resolves.toMatchObject({ ok: false });
    await expect(same.completion).resolves.toMatchObject({ ok: false });
    expect(backend.getItem('gc.same')).toBeNull();
  });

  it('guards a transaction derived from a preceding queued value', async () => {
    const originalSet = backend.setItem;
    let fail = true;
    backend.setItem = (key, value) => {
      if (key === 'gc.a' && fail) {
        fail = false;
        throw new Error('injected dependency failure');
      }
      originalSet(key, value);
    };

    const first = core.update('gc.a', 0, 1);
    const derived = core.transaction((draft) => {
      const plannedA = draft.read('gc.a', 0);
      draft.set('gc.b', plannedA);
    });
    await expect(first.completion).resolves.toMatchObject({ ok: false });
    await expect(derived.completion).resolves.toMatchObject({
      ok: false,
      error: { code: 'precondition_failed', key: 'gc.a' },
    });
    expect(backend.getItem('gc.b')).toBeNull();
  });

  it('uses one authoritative raw read for updater calculation and CAS', async () => {
    backend.setItem('gc.n', '1');
    expect(core.read('gc.n', 0)).toBe(1);
    // Simulate a missed cross-tab event between render and click.
    backend.setItem('gc.n', '5');

    const ticket = core.update<number>('gc.n', 0, previous => previous + 1);
    expect(ticket.value).toBe(6);
    await expect(ticket.completion).resolves.toMatchObject({ ok: true });
    expect(backend.getItem('gc.n')).toBe('6');
  });

  it('reconciles from durable storage when CAS detects a cross-tab race', async () => {
    backend.setItem('gc.n', '1');
    let lockCalls = 0;
    const lock: StorageExclusiveLock = async (work) => {
      lockCalls += 1;
      if (lockCalls === 2) backend.setItem('gc.n', '9');
      return work();
    };
    ({ core } = await initializedCore(backend, lock));
    expect(core.read('gc.n', 0)).toBe(1);

    const ticket = core.update<number>('gc.n', 0, previous => previous + 1);
    await expect(ticket.completion).resolves.toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'precondition_failed' },
    });
    expect(core.read('gc.n', 0)).toBe(9);
    expect(core.getStatus()).toMatchObject({ pending: 0, dirty: false });
  });

  it('CAS-guards ordinary read dependencies used by a mutating transaction', async () => {
    backend.setItem('gc.dependency', '1');
    let lockCalls = 0;
    const lock: StorageExclusiveLock = async (work) => {
      lockCalls += 1;
      if (lockCalls === 2) backend.setItem('gc.dependency', '2');
      return work();
    };
    ({ core } = await initializedCore(backend, lock));

    const ticket = core.transaction((draft) => {
      const dependency = draft.read('gc.dependency', 0);
      draft.set('gc.result', dependency + 1);
    });

    await expect(ticket.completion).resolves.toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'precondition_failed', key: 'gc.dependency' },
    });
    expect(backend.getItem('gc.result')).toBeNull();
  });

  it('does not reconcile half-applied values after an existing journal blocks a write', async () => {
    backend.setItem(STORAGE_VERSION_KEY, JSON.stringify(STORAGE_VERSION));
    backend.setItem('gc.value', '1');
    ({ core } = await initializedCore(backend, undefined, fenceOptions));
    expect(core.read('gc.value', 0)).toBe(1);

    backend.setItem(STORAGE_TRANSACTION_JOURNAL_KEY, serializeStorageJournal({
      kind: STORAGE_TRANSACTION_JOURNAL_KIND,
      version: STORAGE_TRANSACTION_JOURNAL_VERSION,
      transactionId: 'crashed-writer',
      operations: [{ key: 'gc.value', before: '1', after: '2' }],
    }));
    backend.setItem('gc.value', '2');

    const ticket = core.update('gc.value', 0, previous => previous + 1);
    await expect(ticket.completion).resolves.toMatchObject({
      ok: false,
      outcome: 'blocked',
      error: { code: 'journal_present' },
    });
    expect(core.read('gc.value', 0)).toBe(1);
    expect(core.getStatus()).toMatchObject({ blocked: true, dirty: true });
  });

  it('publishes every cache entry before notifying any batch listener', async () => {
    const observations: number[] = [];
    core.subscribe('gc.a', () => { observations.push(core.read('gc.b', 0)); });

    const ticket = core.transaction((draft) => {
      draft.update('gc.a', 0, 1);
      draft.update('gc.b', 0, 2);
    });
    await ticket.completion;

    expect(observations).toEqual([2]);
  });

  it('publishes every external batch cache entry before notifying any key listener', () => {
    const observations: Array<{ a: number; b: number }> = [];
    core.subscribe('gc.a', () => {
      observations.push({
        a: core.read('gc.a', 0),
        b: core.read('gc.b', 0),
      });
    });

    core.applyExternalBatch(new Map([
      ['gc.a', '1'],
      ['gc.b', '2'],
    ]));

    expect(observations).toEqual([{ a: 1, b: 2 }]);
  });

  it('returns a stable status snapshot until observable status changes', () => {
    const clean = core.getStatus();
    expect(core.getStatus()).toBe(clean);

    core.applyExternal('gc.bad', '{bad');
    const dirty = core.getStatus();
    expect(dirty).not.toBe(clean);
    expect(core.getStatus()).toBe(dirty);
  });

  it('joins nested updates into one ambient journal transaction', async () => {
    let firstCompletion: Promise<unknown> | null = null;
    let secondCompletion: Promise<unknown> | null = null;
    const outer = core.transaction(() => {
      firstCompletion = core.update('gc.a', 0, 1).completion;
      const nested = core.transaction(() => {
        secondCompletion = core.update('gc.b', 0, 2).completion;
      });
      expect(nested.completion).toBe(firstCompletion);
    });

    expect(outer.completion).toBe(firstCompletion);
    expect(secondCompletion).toBe(firstCompletion);
    await outer.completion;
    expect(backend.getItem('gc.a')).toBe('1');
    expect(backend.getItem('gc.b')).toBe('2');
    expect(backend.setLog.filter(key => key === STORAGE_TRANSACTION_JOURNAL_KEY)).toHaveLength(1);
  });

  it('rejects an async callback without committing its synchronous prefix or stranding completion', async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });

    const ticket = core.transaction(async (draft) => {
      draft.set('gc.async-prefix', 1);
      await gate;
      draft.set('gc.async-suffix', 2);
    });

    await expect(ticket.completion).resolves.toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: {
        code: 'transaction_failed',
        message: expect.stringContaining('must complete synchronously'),
      },
    });
    resume();
    await Promise.resolve();
    await core.flush();

    expect(backend.getItem('gc.async-prefix')).toBeNull();
    expect(backend.getItem('gc.async-suffix')).toBeNull();
    expect(backend.setLog).not.toContain(STORAGE_TRANSACTION_JOURNAL_KEY);
    expect(core.getStatus()).toMatchObject({ pending: 0, dirty: false });
  });

  it('keeps a failed async callback behind a barrier until its global update continuation settles', async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const failed = core.transaction(async () => {
      await gate;
      core.update('gc.callback-leak', 0, 1);
    });

    await expect(failed.completion).resolves.toMatchObject({ ok: false });
    expect(core.getStatus()).toMatchObject({ pending: 1, dirty: true });
    resume();
    await Promise.resolve();
    await Promise.resolve();
    expect(backend.getItem('gc.callback-leak')).toBeNull();
    expect(core.getStatus()).toMatchObject({ pending: 0, dirty: false });

    await expect(core.update('gc.after-callback', 0, 1).completion).resolves.toMatchObject({ ok: true });
  });

  it('contains hostile callback errors without stranding the transaction boundary', async () => {
    const hostile = new Proxy({}, {
      has: () => { throw new Error('has trap'); },
      getPrototypeOf: () => { throw new Error('prototype trap'); },
      get: () => { throw new Error('get trap'); },
    });

    const failed = core.transaction((draft) => {
      draft.set('gc.hostile-prefix', 1);
      throw hostile;
    });
    await expect(failed.completion).resolves.toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: {
        code: 'transaction_failed',
        cause: 'Unprintable thrown value',
      },
    });
    expect(backend.getItem('gc.hostile-prefix')).toBeNull();

    const retry = core.update('gc.hostile-retry', 0, 1);
    await expect(retry.completion).resolves.toMatchObject({ ok: true });
    expect(backend.getItem('gc.hostile-retry')).toBe('1');
    expect(core.getStatus()).toMatchObject({ pending: 0, dirty: false });
  });

  it('aborts the outer batch when an ignored nested callback returns a thenable', async () => {
    const thenable = {
      then(resolve: (value?: unknown) => void) { resolve(); },
    } as unknown as PromiseLike<void>;

    const ticket = core.transaction((draft) => {
      draft.set('gc.outer', 1);
      core.transaction((nestedDraft) => {
        nestedDraft.set('gc.nested', 2);
        return thenable;
      });
      draft.set('gc.unreachable', 3);
    });

    await expect(ticket.completion).resolves.toMatchObject({
      ok: false,
      error: { code: 'transaction_failed', message: expect.stringContaining('Promise or thenable') },
    });
    expect(backend.getItem('gc.outer')).toBeNull();
    expect(backend.getItem('gc.nested')).toBeNull();
    expect(backend.getItem('gc.unreachable')).toBeNull();
    expect(core.getStatus()).toMatchObject({ pending: 0, dirty: false });
  });

  it('aborts an outer batch even when user code catches a nested async-callback rejection', async () => {
    const ticket = core.transaction((draft) => {
      draft.set('gc.before-caught-async', 1);
      try {
        core.transaction(async (nestedDraft) => {
          nestedDraft.set('gc.caught-async', 2);
        });
      } catch {
        // Catching the synchronous API error cannot make its staged prefix safe.
      }
      draft.set('gc.after-caught-async', 3);
    });

    await expect(ticket.completion).resolves.toMatchObject({ ok: false });
    await Promise.resolve();
    expect(backend.getItem('gc.before-caught-async')).toBeNull();
    expect(backend.getItem('gc.caught-async')).toBeNull();
    expect(backend.getItem('gc.after-caught-async')).toBeNull();
  });

  it('unwinds planned and pending state when coordinator.transact throws synchronously', async () => {
    let throwSynchronously = true;
    const throwingCoordinator: StorageTransactionCoordinator = {
      transact: (mutations) => {
        if (throwSynchronously) throw new Error('synchronous coordinator fault');
        return coordinator.transact(mutations);
      },
      recover: () => coordinator.recover(),
      getStatus: () => coordinator.getStatus(),
      subscribe: (listener) => coordinator.subscribe(listener),
    };
    const throwingCore = new StorageCore(backend, throwingCoordinator);

    const failed = throwingCore.update<number>('gc.retry', 0, previous => previous + 1);
    expect(failed.value).toBe(1);
    await expect(failed.completion).resolves.toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'transaction_failed', cause: expect.stringContaining('synchronous coordinator fault') },
    });
    expect(backend.getItem('gc.retry')).toBeNull();
    expect(throwingCore.getStatus()).toMatchObject({ pending: 0, dirty: false });

    throwSynchronously = false;
    const retry = throwingCore.update<number>('gc.retry', 0, previous => previous + 1);
    expect(retry.value).toBe(1);
    await expect(retry.completion).resolves.toMatchObject({ ok: true, outcome: 'committed' });
    expect(backend.getItem('gc.retry')).toBe('1');
    expect(throwingCore.getStatus()).toMatchObject({ pending: 0, dirty: false });
  });

  it('isolates listener failures after a durable commit', async () => {
    let healthyListenerCalls = 0;
    core.subscribe('gc.x', () => { throw new Error('listener exploded'); });
    core.subscribe('gc.x', () => { healthyListenerCalls += 1; });

    await core.update('gc.x', 0, 1).completion;
    expect(healthyListenerCalls).toBe(1);
    expect(core.read('gc.x', 0)).toBe(1);
    expect(core.getStatus().lastError).toMatchObject({ code: 'listener_failed' });
  });

  it('does not persist or notify a no-op update', async () => {
    backend.setItem('gc.x', '3');
    let hits = 0;
    core.subscribe('gc.x', () => { hits += 1; });
    const beforeJournalWrites = backend.setLog.filter(key => key === STORAGE_TRANSACTION_JOURNAL_KEY).length;

    const result = await core.update('gc.x', 0, 3).completion;
    expect(result).toMatchObject({ ok: true, outcome: 'unchanged' });
    expect(hits).toBe(1); // authoritative initial refresh, not a write publish
    expect(backend.setLog.filter(key => key === STORAGE_TRANSACTION_JOURNAL_KEY)).toHaveLength(beforeJournalWrites);
  });

  it('does not materialize an absent key when an updater returns its detached seed unchanged', async () => {
    const seed = { refunded: false };
    const ticket = core.update('gc.absent-refund', seed, previous => previous);

    expect(ticket.value).toEqual(seed);
    expect(ticket.value).not.toBe(seed);
    await expect(ticket.completion).resolves.toMatchObject({ ok: true, outcome: 'unchanged' });
    expect(backend.getItem('gc.absent-refund')).toBeNull();
    expect(backend.setLog).not.toContain(STORAGE_TRANSACTION_JOURNAL_KEY);
  });

  it('clears matching keys in one durable batch', async () => {
    await Promise.all([
      core.update('gc.c1.wounds', 0, 8).completion,
      core.update('gc.c1.xp', 0, 100).completion,
      core.update('gc.c2.wounds', 0, 5).completion,
    ]);
    const ticket = core.clearMatching(key => key.startsWith('gc.c1.'));
    await expect(ticket.completion).resolves.toMatchObject({
      ok: true,
      outcome: 'committed',
      metadata: 2,
    });

    expect(backend.getItem('gc.c1.wounds')).toBeNull();
    expect(backend.getItem('gc.c1.xp')).toBeNull();
    expect(backend.getItem('gc.c2.wounds')).toBe('5');
    expect(core.read('gc.c1.wounds', -1)).toBe(-1);
  });

  it('discovers and removes a same-tab key queued before clearMatching', async () => {
    let lockCalls = 0;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const gateEntered = new Promise<void>((resolve) => { entered = resolve; });
    const lock: StorageExclusiveLock = async (work) => {
      lockCalls += 1;
      if (lockCalls === 2) {
        entered();
        await gate;
      }
      return work();
    };
    ({ core } = await initializedCore(backend, lock));

    const write = core.update('gc.queued', 0, 7);
    await gateEntered;
    const clear = core.clearMatching(key => key === 'gc.queued');
    release();

    await expect(write.completion).resolves.toMatchObject({ ok: true });
    await expect(clear.completion).resolves.toMatchObject({ ok: true, metadata: 1 });
    expect(backend.getItem('gc.queued')).toBeNull();
    expect(core.read('gc.queued', 0)).toBe(0);
  });

  it('combines nested fixed writes and locked matching removals in one atomic publication', async () => {
    backend.setItem('gc.c1.wounds', '8');
    expect(core.read('gc.c1.wounds', 0)).toBe(8);
    const observations: Array<{ roster: unknown; wounds: number }> = [];
    core.subscribe('gc.customChars', () => {
      observations.push({
        roster: core.read('gc.customChars', null),
        wounds: core.read('gc.c1.wounds', 0),
      });
    });

    let clear!: ReturnType<StorageCore['clearMatching']>;
    const outer = core.transaction((draft) => {
      clear = core.clearMatching(key => key.startsWith('gc.c1.'));
      draft.set('gc.customChars', { survivor: true });
    });

    await expect(outer.completion).resolves.toMatchObject({ ok: true, outcome: 'committed' });
    await expect(clear.completion).resolves.toMatchObject({ ok: true, metadata: 1 });
    expect(observations).toEqual([{ roster: { survivor: true }, wounds: 0 }]);
    expect(backend.getItem('gc.c1.wounds')).toBeNull();
    expect(backend.setLog.filter(key => key === STORAGE_TRANSACTION_JOURNAL_KEY)).toHaveLength(1);
  });

  it('repairs a stale cache on authoritative raw no-op set and remove operations', async () => {
    backend.setItem('gc.set', '1');
    backend.setItem('gc.remove', '2');
    expect(core.read('gc.set', 0)).toBe(1);
    expect(core.read('gc.remove', 0)).toBe(2);
    backend.setItem('gc.set', '3');
    backend.removeItem('gc.remove');
    let setHits = 0;
    let removeHits = 0;
    core.subscribe('gc.set', () => { setHits += 1; });
    core.subscribe('gc.remove', () => { removeHits += 1; });

    const set = core.transaction(draft => draft.set('gc.set', 3));
    const remove = core.transaction(draft => draft.remove('gc.remove'));
    await expect(set.completion).resolves.toMatchObject({ ok: true, outcome: 'unchanged' });
    await expect(remove.completion).resolves.toMatchObject({ ok: true, outcome: 'unchanged' });

    expect(core.read('gc.set', 0)).toBe(3);
    expect(core.read('gc.remove', 0)).toBe(0);
    expect(setHits).toBe(1);
    expect(removeHits).toBe(1);
  });

  it('clears a repaired raw-read error with exactly one status notification', async () => {
    const originalGet = backend.getItem;
    let fail = true;
    backend.getItem = (key) => {
      if (fail && key === 'gc.repaired') throw new Error('one-shot fault');
      return originalGet(key);
    };
    expect(core.read('gc.repaired', 0)).toBe(0);
    fail = false;
    let statusHits = 0;
    core.subscribeStatus(() => { statusHits += 1; });

    const repair = core.transaction(draft => draft.remove('gc.repaired'));
    await expect(repair.completion).resolves.toMatchObject({ ok: true, outcome: 'unchanged' });
    expect(core.getStatus()).toMatchObject({ dirty: false, lastError: null });
    expect(statusHits).toBe(1);
  });

  it('rejects thenables returned by functional updaters without writing their placeholder shape', async () => {
    const ticket = core.update<number>(
      'gc.async-updater',
      0,
      (() => Promise.resolve(4)) as unknown as (previous: number) => number,
    );
    await expect(ticket.completion).resolves.toMatchObject({
      ok: false,
      error: { code: 'transaction_failed', message: expect.stringContaining('Promise or thenable') },
    });
    expect(backend.getItem('gc.async-updater')).toBeNull();
    expect(backend.setLog).not.toContain(STORAGE_TRANSACTION_JOURNAL_KEY);
  });

  it('keeps a failed async functional updater behind the callback barrier', async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const failed = core.update<number>(
      'gc.async-updater',
      0,
      (async () => {
        await gate;
        core.update('gc.updater-leak', 0, 1);
        return 4;
      }) as unknown as (previous: number) => number,
    );

    await expect(failed.completion).resolves.toMatchObject({ ok: false });
    expect(core.getStatus()).toMatchObject({ pending: 1, dirty: true });
    resume();
    await Promise.resolve();
    await Promise.resolve();
    expect(backend.getItem('gc.updater-leak')).toBeNull();
    expect(core.getStatus()).toMatchObject({ pending: 0, dirty: false });
  });

  it('snapshots mutable set values and detects an in-place functional update', async () => {
    const input = { count: 1 };
    const set = core.transaction(draft => draft.set('gc.object', input));
    input.count = 99;
    await expect(set.completion).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(backend.getItem('gc.object') ?? 'null')).toEqual({ count: 1 });
    expect(core.read('gc.object', null)).toEqual({ count: 1 });

    const updated = core.update('gc.in-place', { count: 0 }, (previous) => {
      previous.count += 1;
      return previous;
    });
    await expect(updated.completion).resolves.toMatchObject({ ok: true, outcome: 'committed' });
    expect(backend.getItem('gc.in-place')).toBe('{"count":1}');
  });

  it('contains predicate and subscriber exceptions', async () => {
    backend.setItem('gc.x', '1');
    const failed = core.clearMatching(() => { throw new Error('bad predicate'); });
    await expect(failed.completion).resolves.toMatchObject({
      ok: false,
      error: { code: 'enumerate_failed' },
    });
    expect(backend.getItem('gc.x')).toBe('1');

    core.subscribeStatus(() => { throw new Error('bad status observer'); });
    await expect(core.update('gc.y', 0, 2).completion).resolves.toMatchObject({ ok: true });
  });

  it('rejects async clear predicates without treating their Promise as a match', async () => {
    backend.setItem('gc.keep', '1');
    const failed = core.clearMatching(
      (async () => true) as unknown as (key: string) => boolean,
    );

    await expect(failed.completion).resolves.toMatchObject({
      ok: false,
      error: { code: 'enumerate_failed', cause: expect.stringContaining('must complete synchronously') },
    });
    expect(backend.getItem('gc.keep')).toBe('1');
  });

  it('aborts an ambient batch when key enumeration fails', async () => {
    backend.keys = () => { throw new Error('enumeration failed'); };
    const ticket = core.transaction(() => {
      core.clearMatching(key => key.startsWith('gc.dead.'));
      core.update('gc.customChars', {}, { survivor: true });
    });
    await expect(ticket.completion).resolves.toMatchObject({
      ok: false,
      error: { code: 'enumerate_failed' },
    });
    expect(backend.getItem('gc.customChars')).toBeNull();
  });

  it('surfaces corrupt durable JSON instead of silently treating it as clean', () => {
    backend.setItem('gc.bad', '{not json');
    expect(core.read('gc.bad', 'seed')).toBe('seed');
    expect(core.getStatus()).toMatchObject({
      dirty: true,
      lastError: { code: 'decode_failed', key: 'gc.bad' },
    });
  });

  it('does not clear an unrelated corrupt-key fault after a successful commit', async () => {
    backend.setItem('gc.bad', '{not json');
    expect(core.read('gc.bad', 'seed')).toBe('seed');

    await core.update('gc.good', 0, 1).completion;
    expect(core.getStatus()).toMatchObject({
      dirty: true,
      lastError: { code: 'decode_failed', key: 'gc.bad' },
    });
  });

  it('removes corrupt JSON without decoding it and clears that dirty fault', async () => {
    backend.setItem('gc.corrupt', '{bad');
    expect(core.read('gc.corrupt', null)).toBeNull();
    expect(core.getStatus().dirty).toBe(true);

    const result = await core.clearMatching(key => key === 'gc.corrupt').completion;
    expect(result).toMatchObject({ ok: true, outcome: 'committed' });
    expect(backend.getItem('gc.corrupt')).toBeNull();
    expect(core.getStatus().dirty).toBe(false);
  });

  it('clears a stale corrupt raw-cache ghost even when the durable key is already absent', async () => {
    backend.setItem('gc.corrupt', '{bad');
    core.applyExternal('gc.corrupt', '{bad');
    expect(core.read('gc.corrupt', 'seed')).toBe('seed');
    expect(core.getStatus().dirty).toBe(true);
    backend.removeItem('gc.corrupt');

    await expect(core.clearMatching(key => key === 'gc.corrupt').completion).resolves.toMatchObject({
      ok: true,
      metadata: 0,
    });
    expect(core.getStatus().dirty).toBe(false);
    expect(core.read('gc.corrupt', 'seed')).toBe('seed');
  });

  it('marks invalid external JSON dirty until a durable repair arrives', () => {
    core.applyExternal('gc.external', '{bad');
    expect(core.getStatus()).toMatchObject({
      dirty: true,
      lastError: { code: 'decode_failed', key: 'gc.external' },
    });
    core.applyExternal('gc.external', JSON.stringify({ repaired: true }));
    expect(core.getStatus().dirty).toBe(false);
    expect(core.read('gc.external', null)).toEqual({ repaired: true });
  });

  it('clears a one-shot read fault after an authoritative missing read succeeds', () => {
    const originalGet = backend.getItem;
    let fail = true;
    backend.getItem = (key) => {
      if (fail && key === 'gc.once') throw new Error('one-shot read fault');
      return originalGet(key);
    };
    expect(core.read('gc.once', 'seed')).toBe('seed');
    expect(core.getStatus().dirty).toBe(true);

    fail = false;
    expect(core.read('gc.once', 'seed')).toBe('seed');
    expect(core.getStatus().dirty).toBe(false);
  });

  it('clears an external decode fault when that key is durably removed', () => {
    core.applyExternal('gc.external', '{bad');
    expect(core.getStatus().dirty).toBe(true);
    core.applyExternal('gc.external', null);
    expect(core.getStatus().dirty).toBe(false);
  });

  it('contains hostile thrown values while surfacing backend faults', () => {
    const hostile = new Proxy({}, {
      getPrototypeOf: () => { throw new Error('prototype trap'); },
      get: () => { throw new Error('string trap'); },
    });
    const broken: StorageBackend = {
      getItem: () => { throw hostile; },
      setItem: () => undefined,
      removeItem: () => undefined,
      keys: () => [],
    };
    const brokenCoordinator = createStorageCoordinator(rawStore(broken));
    const brokenCore = new StorageCore(broken, brokenCoordinator);

    expect(() => brokenCore.read('gc.x', 1)).not.toThrow();
    expect(brokenCore.getStatus().lastError?.cause).toBe('Unprintable thrown value');
  });
});

describe('StorageCore schema-version fence', () => {
  it('treats keys absent from a locked snapshot as absent until the next snapshot', async () => {
    const backend = fakeBackend();
    const expected = JSON.stringify(STORAGE_VERSION);
    backend.setItem(STORAGE_VERSION_KEY, expected);
    backend.setItem('gc.old', '1');
    const { core } = await initializedCore(backend, undefined, fenceOptions);

    expect(core.applyExternalSnapshot(new Map([
      [STORAGE_VERSION_KEY, expected],
      ['gc.old', '1'],
    ]))).toBe(true);
    // A committed key whose storage event was missed cannot be mixed into the
    // older complete snapshot by a synchronous cache miss.
    backend.setItem('gc.new', '9');
    expect(core.read('gc.new', 0)).toBe(0);

    expect(core.applyExternalSnapshot(new Map([
      [STORAGE_VERSION_KEY, expected],
      ['gc.old', '1'],
      ['gc.new', '9'],
    ]))).toBe(true);
    expect(core.read('gc.new', 0)).toBe(9);
  });

  it('never publishes a raw partial value through a fenced no-op/cache repair', async () => {
    const backend = fakeBackend();
    const expected = JSON.stringify(STORAGE_VERSION);
    let resyncRequests = 0;
    backend.setItem(STORAGE_VERSION_KEY, expected);
    backend.setItem('gc.value', '1');
    const { core } = await initializedCore(backend, undefined, {
      ...fenceOptions,
      requestAuthoritativeResync: () => { resyncRequests += 1; },
    });
    core.applyExternalSnapshot(new Map([
      [STORAGE_VERSION_KEY, expected],
      ['gc.value', '1'],
    ]));
    let notifications = 0;
    core.subscribe('gc.value', () => { notifications += 1; });

    backend.setItem(STORAGE_TRANSACTION_JOURNAL_KEY, serializeStorageJournal({
      kind: STORAGE_TRANSACTION_JOURNAL_KIND,
      version: STORAGE_TRANSACTION_JOURNAL_VERSION,
      transactionId: 'partial-other-tab',
      operations: [{ key: 'gc.value', before: '1', after: '2' }],
    }));
    backend.setItem('gc.value', '2');

    const ticket = core.transaction(draft => draft.set('gc.value', 2));
    await expect(ticket.completion).resolves.toMatchObject({ ok: false, outcome: 'blocked' });
    expect(core.read('gc.value', 0)).toBe(1);
    expect(notifications).toBe(0);
    expect(resyncRequests).toBeGreaterThan(0);
  });

  it('preserves the locked cache and requests resync after a fenced CAS race', async () => {
    const backend = fakeBackend();
    const expected = JSON.stringify(STORAGE_VERSION);
    backend.setItem(STORAGE_VERSION_KEY, expected);
    backend.setItem('gc.value', '1');
    let lockCalls = 0;
    const lock: StorageExclusiveLock = async (work) => {
      lockCalls += 1;
      if (lockCalls === 2) backend.setItem('gc.value', '9');
      return work();
    };
    let resyncRequests = 0;
    const { core } = await initializedCore(backend, lock, {
      ...fenceOptions,
      requestAuthoritativeResync: () => { resyncRequests += 1; },
    });
    core.applyExternalSnapshot(new Map([
      [STORAGE_VERSION_KEY, expected],
      ['gc.value', '1'],
    ]));

    const ticket = core.update<number>('gc.value', 0, previous => previous + 1);
    await expect(ticket.completion).resolves.toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'precondition_failed' },
    });
    expect(core.read('gc.value', 0)).toBe(1);
    expect(resyncRequests).toBe(1);
  });

  it('CAS-verifies an explicit fenced set even when it equals the cached snapshot', async () => {
    const backend = fakeBackend();
    const expected = JSON.stringify(STORAGE_VERSION);
    backend.setItem(STORAGE_VERSION_KEY, expected);
    backend.setItem('gc.value', '1');
    let resyncRequests = 0;
    const { core } = await initializedCore(backend, undefined, {
      ...fenceOptions,
      requestAuthoritativeResync: () => { resyncRequests += 1; },
    });
    core.applyExternalSnapshot(new Map([
      [STORAGE_VERSION_KEY, expected],
      ['gc.value', '1'],
    ]));

    // The event for this other-tab commit is delayed. Reporting unchanged here
    // would falsely claim the explicit value is durable.
    backend.setItem('gc.value', '9');
    const ticket = core.transaction(draft => draft.set('gc.value', 1));
    await expect(ticket.completion).resolves.toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'precondition_failed', key: 'gc.value' },
    });
    expect(backend.getItem('gc.value')).toBe('9');
    expect(core.read('gc.value', 0)).toBe(1);
    expect(resyncRequests).toBe(1);
  });

  it('CAS-verifies a functional fenced update that is a no-op on stale cache', async () => {
    const backend = fakeBackend();
    const expected = JSON.stringify(STORAGE_VERSION);
    backend.setItem(STORAGE_VERSION_KEY, expected);
    backend.setItem('gc.value', '5');
    let resyncRequests = 0;
    const { core } = await initializedCore(backend, undefined, {
      ...fenceOptions,
      requestAuthoritativeResync: () => { resyncRequests += 1; },
    });
    core.applyExternalSnapshot(new Map([
      [STORAGE_VERSION_KEY, expected],
      ['gc.value', '5'],
    ]));

    backend.setItem('gc.value', '15');
    const ticket = core.update<number>('gc.value', 0, value => Math.min(value, 10));
    expect(ticket.value).toBe(5);
    await expect(ticket.completion).resolves.toMatchObject({
      ok: false,
      outcome: 'rejected',
      error: { code: 'precondition_failed', key: 'gc.value' },
    });
    expect(backend.getItem('gc.value')).toBe('15');
    expect(core.read('gc.value', 0)).toBe(5);
    expect(resyncRequests).toBe(1);
  });

  it('retains corrupt snapshot bytes so a fenced raw set can repair them', async () => {
    const backend = fakeBackend();
    const expected = JSON.stringify(STORAGE_VERSION);
    backend.setItem(STORAGE_VERSION_KEY, expected);
    backend.setItem('gc.corrupt', '{bad');
    const { core } = await initializedCore(backend, undefined, fenceOptions);

    expect(core.applyExternalSnapshot(new Map([
      [STORAGE_VERSION_KEY, expected],
      ['gc.corrupt', '{bad'],
    ]))).toBe(true);
    expect(core.getStatus()).toMatchObject({
      dirty: true,
      lastError: { code: 'decode_failed', key: 'gc.corrupt' },
    });

    const repair = core.transaction(draft => draft.set('gc.corrupt', { repaired: true }));
    await expect(repair.completion).resolves.toMatchObject({ ok: true, outcome: 'committed' });
    expect(core.read('gc.corrupt', null)).toEqual({ repaired: true });
    expect(core.getStatus().dirty).toBe(false);
  });

  it('clears a corrupt-key fault when a later complete snapshot omits the key', async () => {
    const backend = fakeBackend();
    const expected = JSON.stringify(STORAGE_VERSION);
    backend.setItem(STORAGE_VERSION_KEY, expected);
    backend.setItem('gc.corrupt', '{bad');
    const { core } = await initializedCore(backend, undefined, fenceOptions);
    core.applyExternalSnapshot(new Map([
      [STORAGE_VERSION_KEY, expected],
      ['gc.corrupt', '{bad'],
    ]));
    expect(core.getStatus().dirty).toBe(true);

    backend.removeItem('gc.corrupt');
    expect(core.applyExternalSnapshot(new Map([
      [STORAGE_VERSION_KEY, expected],
    ]))).toBe(true);
    expect(core.read('gc.corrupt', 'seed')).toBe('seed');
    expect(core.getStatus()).toMatchObject({ dirty: false, lastError: null });
  });

  it('checks the fence first and never reconciles future values when a migration wins', async () => {
    const backend = fakeBackend();
    const expected = JSON.stringify(STORAGE_VERSION);
    backend.setItem(STORAGE_VERSION_KEY, expected);
    backend.setItem('gc.stale-write', '1');
    const lock = fifoExclusiveLock();
    const oldCoordinator = createStorageCoordinator(rawStore(backend), {
      withExclusiveLock: lock,
      createTransactionId: () => 'old-tab-write',
    });
    const migrationCoordinator = createStorageCoordinator(rawStore(backend), {
      withExclusiveLock: lock,
      createTransactionId: () => 'new-tab-migration',
    });
    await Promise.all([oldCoordinator.recover(), migrationCoordinator.recover()]);
    const oldCore = new StorageCore(backend, oldCoordinator, fenceOptions);
    expect(oldCore.read('gc.stale-write', 0)).toBe(1);

    const migration = migrationCoordinator.transact([
      {
        key: STORAGE_VERSION_KEY,
        value: JSON.stringify(STORAGE_VERSION + 1),
        expected,
      },
      { key: 'gc.stale-write', value: '99', expected: '1' },
    ]);
    const staleWrite = oldCore.update('gc.stale-write', 0, 2);

    await expect(migration).resolves.toMatchObject({ ok: true });
    await expect(staleWrite.completion).resolves.toMatchObject({
      ok: false,
      outcome: 'blocked',
      error: { code: 'schema_mismatch', key: STORAGE_VERSION_KEY },
    });
    expect(backend.getItem('gc.stale-write')).toBe('99');
    expect(oldCore.read('gc.stale-write', 0)).toBe(1);
    expect(oldCore.getStatus()).toMatchObject({
      dirty: true,
      blocked: true,
      lastError: { code: 'schema_mismatch' },
    });

    let retryRan = false;
    const retry = oldCore.transaction(() => { retryRan = true; });
    await expect(retry.completion).resolves.toMatchObject({ ok: false, outcome: 'blocked' });
    expect(retryRan).toBe(false);
    let updaterRan = false;
    const blockedUpdate = oldCore.update('gc.stale-write', 0, () => {
      updaterRan = true;
      return 3;
    });
    expect(blockedUpdate.value).toBe(1);
    expect(updaterRan).toBe(false);
  });

  it('fences computed clears after locked discovery and preserves every app key on mismatch', async () => {
    const backend = fakeBackend();
    const expected = JSON.stringify(STORAGE_VERSION);
    backend.setItem(STORAGE_VERSION_KEY, expected);
    backend.setItem('gc.remove-me', '1');
    const lock = fifoExclusiveLock();
    const oldCoordinator = createStorageCoordinator(rawStore(backend), {
      withExclusiveLock: lock,
      createTransactionId: () => 'old-tab-clear',
    });
    const migrationCoordinator = createStorageCoordinator(rawStore(backend), {
      withExclusiveLock: lock,
      createTransactionId: () => 'new-tab-version',
    });
    await Promise.all([oldCoordinator.recover(), migrationCoordinator.recover()]);
    const oldCore = new StorageCore(backend, oldCoordinator, fenceOptions);

    const migration = migrationCoordinator.transact([{
      key: STORAGE_VERSION_KEY,
      value: JSON.stringify(STORAGE_VERSION + 1),
      expected,
    }]);
    const clear = oldCore.clearMatching(key => key.startsWith('gc.'));

    await expect(migration).resolves.toMatchObject({ ok: true });
    await expect(clear.completion).resolves.toMatchObject({
      ok: false,
      outcome: 'blocked',
      metadata: null,
      error: { code: 'schema_mismatch' },
    });
    expect(backend.getItem('gc.remove-me')).toBe('1');
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBe(JSON.stringify(STORAGE_VERSION + 1));
  });

  it('rejects draft writes to the reserved fence and never offers it to clear predicates', async () => {
    const backend = fakeBackend();
    const expected = JSON.stringify(STORAGE_VERSION);
    backend.setItem(STORAGE_VERSION_KEY, expected);
    backend.setItem('gc.user-data', '1');
    const { core } = await initializedCore(backend, undefined, fenceOptions);

    const attempts = [
      core.transaction(draft => draft.set(STORAGE_VERSION_KEY, STORAGE_VERSION + 1)),
      core.update(STORAGE_VERSION_KEY, STORAGE_VERSION, STORAGE_VERSION + 1),
      core.transaction(draft => draft.remove(STORAGE_VERSION_KEY)),
    ];
    for (const attempt of attempts) {
      await expect(attempt.completion).resolves.toMatchObject({
        ok: false,
        error: { code: 'transaction_failed', key: STORAGE_VERSION_KEY },
      });
    }

    let sawFence = false;
    const clear = core.clearMatching((key) => {
      if (key === STORAGE_VERSION_KEY) sawFence = true;
      return true;
    });
    await expect(clear.completion).resolves.toMatchObject({ ok: true, metadata: 1 });
    expect(sawFence).toBe(false);
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBe(expected);
    expect(backend.getItem('gc.user-data')).toBeNull();
  });

  it('CAS-verifies app updates while keeping a cache-only clear journal-free', async () => {
    const backend = fakeBackend();
    backend.setItem(STORAGE_VERSION_KEY, JSON.stringify(STORAGE_VERSION));
    const { core } = await initializedCore(backend, undefined, fenceOptions);
    backend.setLog.length = 0;

    await expect(core.update('gc.absent', 0, previous => previous).completion).resolves.toMatchObject({
      ok: true,
      outcome: 'committed',
    });
    core.applyExternal('gc.cache-only', '1');
    await expect(core.clearMatching(key => key === 'gc.cache-only').completion).resolves.toMatchObject({
      ok: true,
      outcome: 'unchanged',
      metadata: 0,
    });

    expect(backend.setLog).toEqual([]);
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBe(JSON.stringify(STORAGE_VERSION));
  });

  it('latches a late external mismatch before publishing the incompatible batch', async () => {
    const backend = fakeBackend();
    backend.setItem(STORAGE_VERSION_KEY, JSON.stringify(STORAGE_VERSION));
    const { core } = await initializedCore(backend, undefined, fenceOptions);
    let keyHits = 0;
    core.subscribe('gc.future-shape', () => { keyHits += 1; });

    core.applyExternalBatch(new Map([
      ['gc.future-shape', JSON.stringify({ version: STORAGE_VERSION + 1 })],
      [STORAGE_VERSION_KEY, JSON.stringify(STORAGE_VERSION + 1)],
    ]));

    expect(keyHits).toBe(0);
    expect(core.getStatus()).toMatchObject({
      blocked: true,
      dirty: true,
      lastError: { code: 'schema_mismatch', key: STORAGE_VERSION_KEY },
    });
    await expect(core.update('gc.after-mismatch', 0, 1).completion).resolves.toMatchObject({
      ok: false,
      outcome: 'blocked',
      error: { code: 'schema_mismatch' },
    });
    expect(backend.getItem('gc.after-mismatch')).toBeNull();
  });

  it('checks the authoritative marker for every external batch and quarantines forever after mismatch', async () => {
    const backend = fakeBackend();
    const expected = JSON.stringify(STORAGE_VERSION);
    backend.setItem(STORAGE_VERSION_KEY, expected);
    const { core } = await initializedCore(backend, undefined, fenceOptions);
    let hits = 0;
    core.subscribe('gc.future', () => { hits += 1; });

    backend.setItem(STORAGE_VERSION_KEY, JSON.stringify(STORAGE_VERSION + 1));
    backend.setItem('gc.future', JSON.stringify({ from: 'future-schema' }));
    expect(core.applyExternalBatch(new Map([['gc.future', '2']]))).toBe(false);
    expect(hits).toBe(0);
    expect(core.read('gc.future', 0)).toBe(0);

    // Even a hostile rollback of the raw marker cannot reopen a loaded core.
    backend.setItem(STORAGE_VERSION_KEY, expected);
    expect(core.applyExternalBatch(new Map([['gc.future', '3']]))).toBe(false);
    expect(hits).toBe(0);
    expect(core.read('gc.future', 0)).toBe(0);
    expect(core.getStatus()).toMatchObject({ blocked: true, lastError: { code: 'schema_mismatch' } });
  });

  it('checks the authoritative fence before hydrating an uncached backend value', async () => {
    const backend = fakeBackend();
    backend.setItem(STORAGE_VERSION_KEY, JSON.stringify(STORAGE_VERSION));
    const { core } = await initializedCore(backend, undefined, fenceOptions);

    backend.setItem(STORAGE_VERSION_KEY, JSON.stringify(STORAGE_VERSION + 1));
    backend.setItem('gc.future-only', JSON.stringify({ incompatible: true }));

    expect(core.read('gc.future-only', { safe: true })).toEqual({ safe: true });
    expect(core.getStatus()).toMatchObject({
      blocked: true,
      lastError: { code: 'schema_mismatch', key: STORAGE_VERSION_KEY },
    });
  });

  it('reserves additional internal keys from drafts, snapshots, and clear predicates', async () => {
    const backend = fakeBackend();
    const expected = JSON.stringify(STORAGE_VERSION);
    const internalKey = 'gc.storage.internal-reset';
    backend.setItem(STORAGE_VERSION_KEY, expected);
    backend.setItem(internalKey, '"intent"');
    backend.setItem('gc.user', '1');
    const { core } = await initializedCore(backend, undefined, {
      ...fenceOptions,
      reservedKeys: [internalKey],
    });

    await expect(core.transaction(draft => draft.set(internalKey, 'overwrite')).completion)
      .resolves.toMatchObject({ ok: false, error: { key: internalKey } });
    let sawInternal = false;
    await expect(core.clearMatching((key) => {
      if (key === internalKey) sawInternal = true;
      return true;
    }).completion).resolves.toMatchObject({ ok: true, metadata: 1 });
    expect(sawInternal).toBe(false);
    expect(backend.getItem(internalKey)).toBe('"intent"');

    core.applyExternalSnapshot(new Map([
      [STORAGE_VERSION_KEY, expected],
      [internalKey, '"leak"'],
    ]));
    expect(core.read(internalKey, 'seed')).toBe('seed');
  });

  it('reserves one operation slot for the fence in fixed and computed transactions', async () => {
    const fixedBackend = fakeBackend();
    fixedBackend.setItem(STORAGE_VERSION_KEY, JSON.stringify(STORAGE_VERSION));
    const { core: fixedCore } = await initializedCore(fixedBackend, undefined, fenceOptions);

    const maximum = fixedCore.transaction((draft) => {
      for (let index = 0; index < MAX_TRANSACTION_OPERATIONS - 1; index += 1) {
        draft.set(`gc.max.${index}`, index);
      }
    });
    await expect(maximum.completion).resolves.toMatchObject({ ok: true, outcome: 'committed' });

    const overBackend = fakeBackend();
    overBackend.setItem(STORAGE_VERSION_KEY, JSON.stringify(STORAGE_VERSION));
    const { core: overCore } = await initializedCore(overBackend, undefined, fenceOptions);
    const over = overCore.transaction((draft) => {
      for (let index = 0; index < MAX_TRANSACTION_OPERATIONS; index += 1) {
        draft.set(`gc.over.${index}`, index);
      }
    });
    await expect(over.completion).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_operations' },
    });
    expect(overBackend.keys().filter(key => key.startsWith('gc.over.'))).toHaveLength(0);

    const clearBackend = fakeBackend();
    clearBackend.setItem(STORAGE_VERSION_KEY, JSON.stringify(STORAGE_VERSION));
    for (let index = 0; index < MAX_TRANSACTION_OPERATIONS; index += 1) {
      clearBackend.setItem(`gc.clear-over.${index}`, String(index));
    }
    const { core: clearCore } = await initializedCore(clearBackend, undefined, fenceOptions);
    await expect(clearCore.clearMatching(key => key.startsWith('gc.clear-over.')).completion).resolves.toMatchObject({
      ok: false,
      error: { code: 'transaction_failed' },
      metadata: null,
    });
    expect(clearBackend.keys().filter(key => key.startsWith('gc.clear-over.'))).toHaveLength(
      MAX_TRANSACTION_OPERATIONS,
    );
  });
});
