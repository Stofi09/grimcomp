import {
  STORAGE_TRANSACTION_JOURNAL_KEY,
  createStorageCoordinator,
  type RawAsyncKeyValue,
  type StorageTransactionCoordinator,
} from '@grimcomp/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StorageBackend } from '@/hooks/storageCore';
import {
  STORAGE_VERSION,
  STORAGE_VERSION_KEY,
  readStorageVersion,
  runStorageMigrationPlan,
  type StorageMigration,
} from './migrations';

interface FaultBackend extends StorageBackend {
  readonly store: Map<string, string>;
  failNextSetFor: string | null;
}

function makeBackend(): FaultBackend {
  const store = new Map<string, string>();
  const backend: FaultBackend = {
    store,
    failNextSetFor: null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      if (backend.failNextSetFor === key) {
        backend.failNextSetFor = null;
        throw new Error(`injected set failure for ${key}`);
      }
      store.set(key, value);
    },
    removeItem: (key) => { store.delete(key); },
    keys: () => [...store.keys()],
  };
  return backend;
}

function rawStore(backend: StorageBackend): RawAsyncKeyValue {
  return {
    getItem: async (key) => backend.getItem(key),
    setItem: async (key, value) => { backend.setItem(key, value); },
    removeItem: async (key) => { backend.removeItem(key); },
  };
}

let id = 0;
async function coordinatorFor(backend: StorageBackend): Promise<StorageTransactionCoordinator> {
  const coordinator = createStorageCoordinator(rawStore(backend), {
    createTransactionId: () => `migration-test-${++id}`,
  });
  const recovery = await coordinator.recover();
  expect(recovery.ok).toBe(true);
  return coordinator;
}

describe('strict storage version decoding', () => {
  let backend: FaultBackend;
  beforeEach(() => { backend = makeBackend(); });

  it('distinguishes a fresh store from unstamped legacy data', () => {
    expect(readStorageVersion(backend)).toEqual({
      ok: true,
      state: { version: STORAGE_VERSION, raw: null, unstamped: true },
    });
    backend.setItem('gc.activeCharId', JSON.stringify('c1'));
    expect(readStorageVersion(backend)).toEqual({
      ok: true,
      state: { version: 1, raw: null, unstamped: true },
    });
  });

  it('marks equivalent noncanonical JSON for journaled normalization', () => {
    backend.setItem(STORAGE_VERSION_KEY, '1.0');
    expect(readStorageVersion(backend)).toEqual({
      ok: true,
      state: { version: 1, raw: '1.0', unstamped: true },
    });
  });

  it.each([
    ['invalid JSON', '{', 'corrupt_version'],
    ['numeric string', JSON.stringify('1'), 'corrupt_version'],
    ['fractional number', JSON.stringify(1.5), 'corrupt_version'],
    ['zero', JSON.stringify(0), 'corrupt_version'],
    ['future version', JSON.stringify(STORAGE_VERSION + 1), 'future_version'],
  ])('rejects %s', (_label, raw, code) => {
    backend.setItem(STORAGE_VERSION_KEY, raw);
    expect(readStorageVersion(backend)).toMatchObject({ ok: false, error: { code } });
  });

  it('reports storage access failures structurally', () => {
    const throwing: Pick<StorageBackend, 'getItem' | 'keys'> = {
      getItem: () => { throw new Error('privacy mode'); },
      keys: () => [],
    };
    expect(readStorageVersion(throwing)).toMatchObject({
      ok: false,
      error: { code: 'read_failed', cause: expect.stringContaining('privacy mode') },
    });
  });

  it('contains hostile thrown values while reporting version read failures', () => {
    const hostile = new Proxy({}, {
      getPrototypeOf: () => { throw new Error('prototype trap'); },
      get: () => { throw new Error('string trap'); },
    });
    const throwing: Pick<StorageBackend, 'getItem' | 'keys'> = {
      getItem: () => { throw hostile; },
      keys: () => [],
    };

    expect(() => readStorageVersion(throwing)).not.toThrow();
    expect(readStorageVersion(throwing)).toMatchObject({
      ok: false,
      error: { code: 'read_failed', cause: 'Unprintable thrown value' },
    });
  });
});

describe('journaled migration runner', () => {
  let backend: FaultBackend;
  let coordinator: StorageTransactionCoordinator;

  beforeEach(async () => {
    backend = makeBackend();
    coordinator = await coordinatorFor(backend);
  });

  const run = (targetVersion: number, migrations: Readonly<Record<number, StorageMigration>>) => (
    runStorageMigrationPlan({ targetVersion, migrations, backend, coordinator })
  );

  it('stamps a fresh install and is idempotent on the next boot', async () => {
    await expect(run(1, {})).resolves.toMatchObject({ ok: true, outcome: 'stamped' });
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBe('1');
    await expect(run(1, {})).resolves.toMatchObject({ ok: true, outcome: 'current' });
  });

  it('normalizes a noncanonical current marker through an atomic CAS transaction', async () => {
    backend.setItem(STORAGE_VERSION_KEY, '1.0');

    await expect(run(1, {})).resolves.toMatchObject({ ok: true, outcome: 'stamped' });
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBe('1');
    expect(backend.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
  });

  it('never overwrites a newer marker that races noncanonical normalization', async () => {
    backend.setItem(STORAGE_VERSION_KEY, '1.0');
    let lockCalls = 0;
    const racingCoordinator = createStorageCoordinator(rawStore(backend), {
      withExclusiveLock: async (work) => {
        lockCalls += 1;
        if (lockCalls === 2) backend.setItem(STORAGE_VERSION_KEY, '2');
        return work();
      },
      createTransactionId: () => `normalization-race-${++id}`,
    });
    await expect(racingCoordinator.recover()).resolves.toMatchObject({ ok: true });

    const result = await runStorageMigrationPlan({
      targetVersion: 1,
      migrations: {},
      backend,
      coordinator: racingCoordinator,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'transaction_failed' } });
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBe('2');
    expect(backend.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
  });

  it('preflights the whole path and never stamps when a step is missing', async () => {
    backend.setItem(STORAGE_VERSION_KEY, '1');
    const stepOne: StorageMigration = () => [{ key: 'gc.value', value: '2' }];

    await expect(run(3, { 1: stepOne })).resolves.toMatchObject({
      ok: false,
      error: { code: 'missing_migration', fromVersion: 2 },
    });
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBe('1');
    expect(backend.getItem('gc.value')).toBeNull();
  });

  it('does not stamp after a throwing migration', async () => {
    backend.setItem(STORAGE_VERSION_KEY, '1');
    const explode: StorageMigration = () => { throw new Error('transform exploded'); };

    await expect(run(2, { 1: explode })).resolves.toMatchObject({
      ok: false,
      error: { code: 'migration_failed', cause: expect.stringContaining('transform exploded') },
    });
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBe('1');
  });

  it.each([null, { key: 'gc.x', value: '2' }, [null], [{ key: STORAGE_VERSION_KEY, value: '2' }]])(
    'blocks malformed migration output %#',
    async (output) => {
      backend.setItem(STORAGE_VERSION_KEY, '1');
      const malformed = (() => output) as unknown as StorageMigration;
      const result = await run(2, { 1: malformed });
      expect(result).toMatchObject({ ok: false, error: { code: expect.stringMatching(/invalid_migration|transaction_failed/) } });
      expect(backend.getItem(STORAGE_VERSION_KEY)).toBe('1');
    },
  );

  it('commits transformed data and its next-version stamp atomically', async () => {
    backend.setItem(STORAGE_VERSION_KEY, '1');
    backend.setItem('gc.value', JSON.stringify({ old: true }));
    const migrate: StorageMigration = ({ readRaw }) => [{
      key: 'gc.value',
      value: JSON.stringify({ previous: readRaw('gc.value') }),
    }];

    await expect(run(2, { 1: migrate })).resolves.toMatchObject({ ok: true, outcome: 'migrated' });
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBe('2');
    expect(JSON.parse(backend.getItem('gc.value') ?? 'null')).toEqual({ previous: '{"old":true}' });
    expect(backend.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
  });

  it('CAS-guards read-only dependencies used to derive migrated output', async () => {
    backend.setItem(STORAGE_VERSION_KEY, '1');
    backend.setItem('gc.source', '"old"');
    let lockCalls = 0;
    const racingCoordinator = createStorageCoordinator(rawStore(backend), {
      withExclusiveLock: async (work) => {
        lockCalls += 1;
        if (lockCalls === 2) backend.setItem('gc.source', '"changed-in-another-tab"');
        return work();
      },
      createTransactionId: () => `migration-race-${++id}`,
    });
    await expect(racingCoordinator.recover()).resolves.toMatchObject({ ok: true });

    const result = await runStorageMigrationPlan({
      targetVersion: 2,
      migrations: {
        1: ({ readRaw }) => [{ key: 'gc.derived', value: readRaw('gc.source') }],
      },
      backend,
      coordinator: racingCoordinator,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'transaction_failed' } });
    expect(backend.getItem('gc.source')).toBe('"changed-in-another-tab"');
    expect(backend.getItem('gc.derived')).toBeNull();
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBe('1');
  });

  it('revalidates the operation limit after adding read-only dependency guards', async () => {
    backend.setItem(STORAGE_VERSION_KEY, '1');
    const dependencyHeavy: StorageMigration = ({ readRaw }) => {
      for (let index = 0; index < 1_000; index += 1) readRaw(`gc.dependency.${index}`);
      return [];
    };

    await expect(run(2, { 1: dependencyHeavy })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_migration',
        message: expect.stringContaining('at most 1000 operations'),
      },
    });
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBe('1');
    expect(backend.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
  });

  it('rolls transformed data back and preserves the old stamp on a write fault', async () => {
    backend.setItem(STORAGE_VERSION_KEY, '1');
    backend.setItem('gc.value', '"old"');
    backend.failNextSetFor = 'gc.value';
    const migrate: StorageMigration = () => [{ key: 'gc.value', value: '"new"' }];

    await expect(run(2, { 1: migrate })).resolves.toMatchObject({ ok: false, error: { code: 'transaction_failed' } });
    expect(backend.getItem('gc.value')).toBe('"old"');
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBe('1');
    expect(backend.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
  });

  it('contains an unexpected coordinator rejection', async () => {
    backend.setItem(STORAGE_VERSION_KEY, '1');
    const rejecting = {
      ...coordinator,
      transact: async () => { throw new Error('unexpected rejection'); },
      recover: coordinator.recover.bind(coordinator),
      getStatus: coordinator.getStatus.bind(coordinator),
      subscribe: coordinator.subscribe.bind(coordinator),
    } satisfies StorageTransactionCoordinator;

    const result = await runStorageMigrationPlan({
      targetVersion: 2,
      migrations: { 1: () => [{ key: 'gc.x', value: '1' }] },
      backend,
      coordinator: rejecting,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'transaction_failed', cause: expect.stringContaining('unexpected rejection') },
    });
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBe('1');
  });
});
