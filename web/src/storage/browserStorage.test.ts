import {
  STORAGE_TRANSACTION_JOURNAL_KEY,
  STORAGE_TRANSACTION_JOURNAL_KIND,
  STORAGE_TRANSACTION_JOURNAL_VERSION,
  createStorageCoordinator,
  serializeStorageJournal,
} from '@grimcomp/core';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageCore, type StorageBackend } from '@/hooks/storageCore';
import {
  BROWSER_STORAGE_SCHEMA_FENCE,
  WEB_STORAGE_LOCK_NAME,
  createBrowserStorageSyncController,
  createBrowserExclusiveLock,
  createBrowserRawStore,
  createBrowserStorageBackend,
} from './browserStorage';
import { STORAGE_VERSION, STORAGE_VERSION_KEY } from './storageSchema';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function mapStorage(initial: readonly (readonly [string, string])[] = []): Storage {
  const values = new Map(initial);
  return {
    get length() { return values.size; },
    clear: () => { values.clear(); },
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

describe('browser storage adapters', () => {
  it('configures the app write fence from the shared schema constants', () => {
    expect(BROWSER_STORAGE_SCHEMA_FENCE).toEqual({
      key: STORAGE_VERSION_KEY,
      expectedRaw: JSON.stringify(STORAGE_VERSION),
    });
  });

  it('does not swallow localStorage access failures', async () => {
    const unavailable = () => { throw new Error('privacy restriction'); };
    const sync = createBrowserStorageBackend(unavailable);
    const raw = createBrowserRawStore(unavailable);

    expect(() => sync.getItem('gc.x')).toThrow(/privacy restriction/);
    await expect(raw.setItem('gc.x', '1')).rejects.toThrow(/privacy restriction/);
  });

  it('runs under a named exclusive Web Lock when available', async () => {
    const calls: Array<{ name: string; mode?: string }> = [];
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        locks: {
          request: async (
            name: string,
            options: { mode?: string },
            callback: () => Promise<string>,
          ) => {
            calls.push({ name, mode: options.mode });
            return callback();
          },
        },
      },
    });

    await expect(createBrowserExclusiveLock()(() => Promise.resolve('committed')))
      .resolves.toBe('committed');
    expect(calls).toEqual([{ name: WEB_STORAGE_LOCK_NAME, mode: 'exclusive' }]);
  });

  it('fails closed in a browser when Web Locks are unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    let ran = false;
    await expect(createBrowserExclusiveLock()(async () => {
      ran = true;
      return 42;
    })).rejects.toThrow(/cannot safely coordinate local data across tabs/);
    expect(ran).toBe(false);
  });

  it('surfaces a Web Locks request failure instead of silently running unlocked', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        locks: {
          request: async () => { throw new Error('lock service failed'); },
        },
      },
    });
    let ran = false;
    await expect(createBrowserExclusiveLock()(async () => {
      ran = true;
    })).rejects.toThrow(/lock service failed/);
    expect(ran).toBe(false);
  });

  it('ignores other storage areas and recovers when a journal-open event is the writer\'s last event', async () => {
    const expected = JSON.stringify(STORAGE_VERSION);
    const storage = mapStorage([
      [STORAGE_VERSION_KEY, expected],
      ['gc.value', '1'],
    ]);
    const otherStorage = mapStorage();
    const backend = createBrowserStorageBackend(() => storage);
    const coordinator = createStorageCoordinator(createBrowserRawStore(() => storage));
    await expect(coordinator.recover()).resolves.toMatchObject({ ok: true });
    const core = new StorageCore(backend, coordinator, {
      reservedFence: BROWSER_STORAGE_SCHEMA_FENCE,
    });
    const sync = createBrowserStorageSyncController({ storageArea: storage, backend, coordinator, core });
    expect(core.read('gc.value', 0)).toBe(1);
    let hits = 0;
    core.subscribe('gc.value', () => { hits += 1; });

    sync.handleStorageEvent({ storageArea: otherStorage, key: 'gc.value', newValue: '2' });
    await sync.flush();
    expect(hits).toBe(0);

    const journal = serializeStorageJournal({
      kind: STORAGE_TRANSACTION_JOURNAL_KIND,
      version: STORAGE_TRANSACTION_JOURNAL_VERSION,
      transactionId: 'crashed-browser-writer',
      operations: [{ key: 'gc.value', before: '1', after: '2' }],
    });
    storage.setItem(STORAGE_TRANSACTION_JOURNAL_KEY, journal);
    sync.handleStorageEvent({
      storageArea: storage,
      key: STORAGE_TRANSACTION_JOURNAL_KEY,
      newValue: journal,
    });
    await sync.flush();
    expect(hits).toBe(1);
    expect(core.read('gc.value', 0)).toBe(2);
    expect(storage.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
  });

  it('retries after a failed journal wakeup when the next application-key event arrives', async () => {
    const expected = JSON.stringify(STORAGE_VERSION);
    const storage = mapStorage([
      [STORAGE_VERSION_KEY, expected],
      ['gc.value', '1'],
    ]);
    const backend = createBrowserStorageBackend(() => storage);
    const coordinator = createStorageCoordinator(createBrowserRawStore(() => storage));
    await expect(coordinator.recover()).resolves.toMatchObject({ ok: true });
    const core = new StorageCore(backend, coordinator, {
      reservedFence: BROWSER_STORAGE_SCHEMA_FENCE,
    });
    expect(core.read('gc.value', 0)).toBe(1);

    let failSnapshot = true;
    const flakyBackend: StorageBackend = {
      ...backend,
      keys: () => {
        if (failSnapshot) {
          failSnapshot = false;
          throw new Error('injected snapshot failure');
        }
        return backend.keys();
      },
    };
    const sync = createBrowserStorageSyncController({
      storageArea: storage,
      backend: flakyBackend,
      coordinator,
      core,
    });
    const journal = serializeStorageJournal({
      kind: STORAGE_TRANSACTION_JOURNAL_KIND,
      version: STORAGE_TRANSACTION_JOURNAL_VERSION,
      transactionId: 'retry-after-snapshot-failure',
      operations: [{ key: 'gc.value', before: '1', after: '2' }],
    });
    storage.setItem(STORAGE_TRANSACTION_JOURNAL_KEY, journal);
    sync.handleStorageEvent({
      storageArea: storage,
      key: STORAGE_TRANSACTION_JOURNAL_KEY,
      newValue: journal,
    });
    await expect(sync.flush()).resolves.toMatchObject({ ok: false });
    expect(storage.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
    expect(core.read('gc.value', 0)).toBe(1);

    sync.handleStorageEvent({ storageArea: storage, key: 'gc.value', newValue: '2' });
    await expect(sync.flush()).resolves.toMatchObject({ ok: true });
    expect(core.read('gc.value', 0)).toBe(2);
  });

  it('handles clear and BFCache wakeups through a locked authoritative resync', async () => {
    const expected = JSON.stringify(STORAGE_VERSION);
    const storage = mapStorage([
      [STORAGE_VERSION_KEY, expected],
      ['gc.value', '1'],
    ]);
    const backend = createBrowserStorageBackend(() => storage);
    const coordinator = createStorageCoordinator(createBrowserRawStore(() => storage));
    await expect(coordinator.recover()).resolves.toMatchObject({ ok: true });
    const core = new StorageCore(backend, coordinator, {
      reservedFence: BROWSER_STORAGE_SCHEMA_FENCE,
    });
    const sync = createBrowserStorageSyncController({ storageArea: storage, backend, coordinator, core });
    expect(core.read('gc.value', 0)).toBe(1);

    storage.setItem('gc.value', '2');
    sync.handlePageShow({ persisted: true });
    await sync.flush();
    expect(core.read('gc.value', 0)).toBe(2);

    storage.clear();
    sync.handleStorageEvent({ storageArea: storage, key: null, newValue: null });
    await sync.flush();
    expect(core.getStatus()).toMatchObject({ blocked: true, lastError: { code: 'schema_mismatch' } });
    expect(core.read('gc.value', 0)).toBe(2);
  });
});
