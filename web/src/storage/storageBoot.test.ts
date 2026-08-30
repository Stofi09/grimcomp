// @vitest-environment jsdom

import {
  STORAGE_TRANSACTION_JOURNAL_KEY,
  STORAGE_TRANSACTION_JOURNAL_KIND,
  STORAGE_TRANSACTION_JOURNAL_VERSION,
  createStorageCoordinator,
  type RawAsyncKeyValue,
  type StorageTransactionCoordinator,
} from '@grimcomp/core';
import { describe, expect, it, vi } from 'vitest';
import type { StorageBackend } from '@/hooks/storageCore';
import { STORAGE_VERSION_KEY } from './migrations';
import {
  STORAGE_RECOVERY_RESET_INTENT_KEY,
  STORAGE_RECOVERY_RESET_INTENT_RAW,
  STORAGE_RECOVERY_RESET_WITNESS_KEY,
  STORAGE_RECOVERY_RESET_WITNESS_RAW,
} from './storageSchema';
import {
  buildWebRecoveryDiagnosticExport,
  completePendingWebRecoveryReset,
  forceResetWebStorageForRecovery,
  initializeWebStorage,
  renderStorageBootFailure,
  resetWebStorageForRecovery,
} from './storageBoot';

function backendFor(store: Map<string, string>): StorageBackend {
  return {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: key => { store.delete(key); },
    keys: () => [...store.keys()],
  };
}

type FaultOperation = 'set' | 'remove';

function faultBackendFor(
  store: Map<string, string>,
  shouldFail: (operation: FaultOperation, key: string, value: string | null) => boolean,
): StorageBackend {
  let failed = false;
  return {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => {
      if (!failed && shouldFail('set', key, value)) {
        failed = true;
        throw new Error(`injected set crash for ${key}`);
      }
      store.set(key, value);
    },
    removeItem: key => {
      if (!failed && shouldFail('remove', key, null)) {
        failed = true;
        throw new Error(`injected remove crash for ${key}`);
      }
      store.delete(key);
    },
    keys: () => [...store.keys()],
  };
}

const unlocked = async <T>(work: () => Promise<T>): Promise<T> => work();

function rawStore(backend: StorageBackend): RawAsyncKeyValue {
  return {
    getItem: async key => backend.getItem(key),
    setItem: async (key, value) => { backend.setItem(key, value); },
    removeItem: async key => { backend.removeItem(key); },
  };
}

async function coordinatorFor(backend: StorageBackend): Promise<StorageTransactionCoordinator> {
  const coordinator = createStorageCoordinator(rawStore(backend), {
    createTransactionId: () => 'web-recovery-reset-test',
  });
  await expect(coordinator.recover()).resolves.toMatchObject({ ok: true });
  return coordinator;
}

describe('web storage recovery actions', () => {
  it('exports exact raw values, including a malformed value and the recovery journal', () => {
    const store = new Map<string, string>([
      ['unrelated', 'ignored'],
      ['gc.broken', '{not-json'],
      [STORAGE_TRANSACTION_JOURNAL_KEY, '{also-not-json'],
      [STORAGE_VERSION_KEY, '999'],
    ]);
    const parsed = JSON.parse(buildWebRecoveryDiagnosticExport({
      stage: 'recovery',
      title: 'Blocked',
      message: 'Journal is corrupt.',
    }, backendFor(store))) as {
      $schema: string;
      platform: string;
      raw: Record<string, string>;
    };

    expect(parsed.$schema).toBe('grimcomp.storage-diagnostic.v1');
    expect(parsed.platform).toBe('web');
    expect(parsed.raw).toEqual({
      'gc.broken': '{not-json',
      [STORAGE_TRANSACTION_JOURNAL_KEY]: '{also-not-json',
      [STORAGE_VERSION_KEY]: '999',
    });
  });

  it('atomically removes gameplay data and installs the current version marker', async () => {
    const store = new Map<string, string>([
      ['unrelated', 'kept'],
      ['gc.a', '1'],
      ['gc.b', '2'],
      [STORAGE_VERSION_KEY, '999'],
    ]);
    const backend = backendFor(store);
    const coordinator = await coordinatorFor(backend);

    await expect(resetWebStorageForRecovery({ backend, coordinator, targetVersion: 3 }))
      .resolves.toEqual({ ok: true, removed: 2, message: 'Removed 2 local data entries.' });
    expect(store).toEqual(new Map([
      ['unrelated', 'kept'],
      [STORAGE_VERSION_KEY, '3'],
    ]));
    expect(store.has(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(false);
  });

  it('preserves every raw value when recovery remains blocked', async () => {
    const store = new Map<string, string>([
      ['gc.a', '1'],
      [STORAGE_TRANSACTION_JOURNAL_KEY, '{corrupt'],
    ]);
    const backend = backendFor(store);
    const coordinator = createStorageCoordinator(rawStore(backend));
    const before = new Map(store);

    await expect(resetWebStorageForRecovery({ backend, coordinator }))
      .resolves.toMatchObject({ ok: false, removed: 0, message: expect.stringContaining('not safe to discard') });
    expect(store).toEqual(before);
  });

  it('requires the non-importable confirmation witness before honoring an intent', async () => {
    const store = new Map<string, string>([
      ['gc.keep', '1'],
      [STORAGE_RECOVERY_RESET_INTENT_KEY, STORAGE_RECOVERY_RESET_INTENT_RAW],
    ]);
    const before = new Map(store);

    await expect(completePendingWebRecoveryReset({
      backend: backendFor(store),
      withExclusiveLock: unlocked,
    })).resolves.toMatchObject({ ok: false, message: expect.stringContaining('confirmation witness') });
    expect(store).toEqual(before);
  });

  it('blocks a historical journal that tries to forge the non-gc reset witness', async () => {
    const forgedJournal = JSON.stringify({
      kind: STORAGE_TRANSACTION_JOURNAL_KIND,
      version: STORAGE_TRANSACTION_JOURNAL_VERSION,
      transactionId: 'historical-import-forgery',
      operations: [{
        key: STORAGE_RECOVERY_RESET_WITNESS_KEY,
        before: null,
        after: STORAGE_RECOVERY_RESET_WITNESS_RAW,
      }],
    });
    const store = new Map<string, string>([
      ['gc.keep', '1'],
      [STORAGE_TRANSACTION_JOURNAL_KEY, forgedJournal],
    ]);
    const backend = backendFor(store);
    const coordinator = createStorageCoordinator(rawStore(backend));

    await expect(initializeWebStorage({
      backend,
      coordinator,
      withExclusiveLock: unlocked,
      migrate: async () => ({ ok: true, outcome: 'current', fromVersion: 1, toVersion: 1 }),
      sync: { resync: async () => ({ ok: true, entries: 0 }) },
    })).resolves.toMatchObject({
      ok: false,
      stage: 'recovery',
      recovery: { error: { code: 'journal_corrupt' } },
    });
    expect(store.get('gc.keep')).toBe('1');
    expect(store.get(STORAGE_TRANSACTION_JOURNAL_KEY)).toBe(forgedJournal);
    expect(store.has(STORAGE_RECOVERY_RESET_WITNESS_KEY)).toBe(false);
  });

  it('force-resets an unrecoverable journal only after installing verified intent markers', async () => {
    const store = new Map<string, string>([
      ['gc.keep', '1'],
      [STORAGE_TRANSACTION_JOURNAL_KEY, '{corrupt'],
      [STORAGE_VERSION_KEY, '999'],
    ]);

    await expect(forceResetWebStorageForRecovery({
      backend: backendFor(store),
      withExclusiveLock: unlocked,
    })).resolves.toMatchObject({ ok: true, removed: 1 });
    expect(store).toEqual(new Map([[STORAGE_VERSION_KEY, '1']]));
  });

  it('completes a confirmed pending reset before ordinary corrupt-journal recovery', async () => {
    const store = new Map<string, string>([
      ['gc.keep', '1'],
      [STORAGE_TRANSACTION_JOURNAL_KEY, '{corrupt'],
      [STORAGE_RECOVERY_RESET_INTENT_KEY, STORAGE_RECOVERY_RESET_INTENT_RAW],
      [STORAGE_RECOVERY_RESET_WITNESS_KEY, STORAGE_RECOVERY_RESET_WITNESS_RAW],
    ]);
    const backend = backendFor(store);
    const coordinator = createStorageCoordinator(rawStore(backend));

    await expect(initializeWebStorage({
      backend,
      coordinator,
      withExclusiveLock: unlocked,
      migrate: async () => ({ ok: true, outcome: 'current', fromVersion: 1, toVersion: 1 }),
      sync: { resync: async () => ({ ok: true, entries: 1 }) },
    })).resolves.toMatchObject({ ok: true, recovery: { outcome: 'clean' } });
    expect(store).toEqual(new Map([[STORAGE_VERSION_KEY, '1']]));
  });

  it.each([
    ['journal removal', (operation: FaultOperation, key: string) => operation === 'remove' && key === STORAGE_TRANSACTION_JOURNAL_KEY],
    ['app-data removal', (operation: FaultOperation, key: string) => operation === 'remove' && key === 'gc.keep'],
    ['version stamp', (operation: FaultOperation, key: string) => operation === 'set' && key === STORAGE_VERSION_KEY],
    ['intent removal', (operation: FaultOperation, key: string) => operation === 'remove' && key === STORAGE_RECOVERY_RESET_INTENT_KEY],
    ['witness removal', (operation: FaultOperation, key: string) => operation === 'remove' && key === STORAGE_RECOVERY_RESET_WITNESS_KEY],
  ] as const)('resumes a confirmed reset after a simulated crash at %s', async (_label, failAt) => {
    const store = new Map<string, string>([
      ['gc.keep', '1'],
      [STORAGE_TRANSACTION_JOURNAL_KEY, '{corrupt'],
      [STORAGE_VERSION_KEY, '999'],
    ]);
    const faulting = faultBackendFor(store, (operation, key) => failAt(operation, key));

    await expect(forceResetWebStorageForRecovery({
      backend: faulting,
      withExclusiveLock: unlocked,
    })).resolves.toMatchObject({ ok: false });
    expect(store.get(STORAGE_RECOVERY_RESET_WITNESS_KEY)).toBe(STORAGE_RECOVERY_RESET_WITNESS_RAW);

    await expect(completePendingWebRecoveryReset({
      backend: backendFor(store),
      withExclusiveLock: unlocked,
    })).resolves.toMatchObject({ ok: true });
    expect(store).toEqual(new Map([[STORAGE_VERSION_KEY, '1']]));
  });

  it('finishes reset checking, recovery, migration, and durable resync before reporting boot success', async () => {
    const order: string[] = [];
    const store = new Map<string, string>([[STORAGE_VERSION_KEY, '1']]);
    const backend = backendFor(store);
    const coordinator = createStorageCoordinator(rawStore(backend));
    const trackedCoordinator: StorageTransactionCoordinator = {
      transact: mutations => coordinator.transact(mutations),
      transactComputed: provider => coordinator.transactComputed!(provider),
      recover: () => {
        order.push('recovery');
        return coordinator.recover();
      },
      getStatus: () => coordinator.getStatus(),
      subscribe: listener => coordinator.subscribe(listener),
    };

    const result = await initializeWebStorage({
      backend,
      coordinator: trackedCoordinator,
      withExclusiveLock: async (work) => {
        order.push('reset-check');
        return work();
      },
      migrate: async () => {
        order.push('migration');
        return { ok: true, outcome: 'current', fromVersion: 1, toVersion: 1 };
      },
      sync: {
        resync: async () => {
          order.push('resync');
          return { ok: true, entries: 1 };
        },
      },
    });

    expect(result).toMatchObject({ ok: true });
    expect(order).toEqual(['reset-check', 'recovery', 'migration', 'resync']);
  });

  it('blocks startup with an explicit capability error when Web Locks are unavailable', async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    try {
      await expect(initializeWebStorage()).resolves.toMatchObject({
        ok: false,
        stage: 'capability',
        title: 'Safe local storage is unavailable',
        message: expect.stringContaining('Web Locks API is unavailable'),
      });
    } finally {
      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  it('does not offer a destructive reset for a missing browser capability', () => {
    const root = document.createElement('div');
    renderStorageBootFailure(root, {
      stage: 'capability',
      title: 'Safe local storage is unavailable',
      message: 'Web Locks are required.',
    });

    expect([...root.querySelectorAll('button')].map(button => button.textContent)).toEqual([
      'Retry recovery',
      'Export raw diagnostic',
    ]);
  });

  it('offers an explicitly confirmed reset for recovery-stage boot failures', () => {
    localStorage.clear();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const root = document.createElement('div');
    renderStorageBootFailure(root, {
      stage: 'recovery',
      title: 'Recovery blocked',
      message: 'The journal is corrupt.',
    });

    const buttons = [...root.querySelectorAll('button')];
    expect(buttons.map(button => button.textContent)).toEqual([
      'Retry recovery',
      'Export raw diagnostic',
      'Reset local data',
    ]);
    buttons[2]?.click();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(STORAGE_RECOVERY_RESET_INTENT_KEY)).toBeNull();
    expect(localStorage.getItem(STORAGE_RECOVERY_RESET_WITNESS_KEY)).toBeNull();
    confirm.mockRestore();
  });
});
