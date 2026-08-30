import {
  STORAGE_TRANSACTION_JOURNAL_KEY,
  createStorageCoordinator,
  type RawAsyncKeyValue,
  type StorageExclusiveLock,
  type StorageTransactionCoordinator,
} from '@grimcomp/core';
import {
  StorageCore,
  type StorageBackend,
  type StorageCoreStatus,
} from '@/hooks/storageCore';
import {
  STORAGE_RECOVERY_RESET_INTENT_KEY,
  STORAGE_RECOVERY_RESET_WITNESS_KEY,
  STORAGE_VERSION,
  STORAGE_VERSION_KEY,
} from './storageSchema';

export const WEB_STORAGE_LOCK_NAME = 'grimcomp.storage.v1';
export const WEB_STORAGE_LOCK_UNAVAILABLE_MESSAGE =
  'This browser cannot safely coordinate local data across tabs because the Web Locks API is unavailable. Use a current browser in a secure (HTTPS) context, then reload.';
export const BROWSER_STORAGE_SCHEMA_FENCE = Object.freeze({
  key: STORAGE_VERSION_KEY,
  expectedRaw: JSON.stringify(STORAGE_VERSION),
});

type StorageProvider = () => Storage;

export type BrowserStorageResyncResult =
  | { readonly ok: true; readonly entries: number }
  | { readonly ok: false; readonly message: string };

interface BrowserStorageSyncCore {
  applyExternalSnapshot(snapshot: ReadonlyMap<string, string>): boolean;
  getStatus(): StorageCoreStatus;
}

export interface BrowserStorageSyncController {
  handleStorageEvent(event: Pick<StorageEvent, 'key' | 'newValue' | 'storageArea'>): void;
  handlePageShow(event: Pick<PageTransitionEvent, 'persisted'>): void;
  resync(): Promise<BrowserStorageResyncResult>;
  flush(): Promise<BrowserStorageResyncResult>;
}

function defaultStorageProvider(): Storage {
  if (typeof window === 'undefined') {
    throw new Error('Browser storage is unavailable outside a window context.');
  }
  // Accessing this property can itself throw in privacy-restricted webviews.
  const storage = window.localStorage;
  if (!storage) throw new Error('Browser localStorage is unavailable.');
  return storage;
}

/** Throwing synchronous adapter used for pre-render hydration and key scans. */
export function createBrowserStorageBackend(
  provideStorage: StorageProvider = defaultStorageProvider,
): StorageBackend {
  return {
    getItem: (key) => provideStorage().getItem(key),
    setItem: (key, value) => provideStorage().setItem(key, value),
    removeItem: (key) => provideStorage().removeItem(key),
    keys: () => {
      const storage = provideStorage();
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null) keys.push(key);
      }
      return keys;
    },
  };
}

/** Async raw adapter for the platform-neutral journal coordinator. */
export function createBrowserRawStore(
  provideStorage: StorageProvider = defaultStorageProvider,
): RawAsyncKeyValue {
  return {
    getItem: async (key) => provideStorage().getItem(key),
    setItem: async (key, value) => { provideStorage().setItem(key, value); },
    removeItem: async (key) => { provideStorage().removeItem(key); },
  };
}

/** Serialize journal inspection and commits across same-origin tabs. */
export function createBrowserExclusiveLock(lockName = WEB_STORAGE_LOCK_NAME): StorageExclusiveLock {
  return async <T>(work: () => Promise<T>): Promise<T> => {
    // Unit/SSR callers have no peer browsing contexts. A real browser must not
    // silently degrade to a per-tab queue: that would allow two coordinators to
    // overwrite or clear each other's recovery journal.
    if (typeof navigator === 'undefined') return work();
    const locks = navigator.locks;
    if (!locks || typeof locks.request !== 'function') {
      throw new Error(WEB_STORAGE_LOCK_UNAVAILABLE_MESSAGE);
    }
    return locks.request(lockName, { mode: 'exclusive' }, work);
  };
}

export const browserStorageBackend = createBrowserStorageBackend();
export const browserRawStore = createBrowserRawStore();
export const browserStorageCoordinator = createStorageCoordinator(browserRawStore, {
  withExclusiveLock: createBrowserExclusiveLock(),
});
let installedBrowserStorageSync: BrowserStorageSyncController | null = null;
export const browserStorageCore = new StorageCore(browserStorageBackend, browserStorageCoordinator, {
  reservedFence: BROWSER_STORAGE_SCHEMA_FENCE,
  reservedKeys: [
    STORAGE_RECOVERY_RESET_INTENT_KEY,
    STORAGE_RECOVERY_RESET_WITNESS_KEY,
  ],
  requestAuthoritativeResync: () => {
    if (installedBrowserStorageSync) void installedBrowserStorageSync.resync();
  },
});

/** Recover any durable journal, then snapshot all browser data under the same lock. */
export async function resyncBrowserStorage(
  backend: StorageBackend = browserStorageBackend,
  coordinator: StorageTransactionCoordinator = browserStorageCoordinator,
  core: BrowserStorageSyncCore = browserStorageCore,
): Promise<BrowserStorageResyncResult> {
  try {
    const recovery = await coordinator.recover();
    if (!recovery.ok) return { ok: false, message: recovery.error.message };
    if (typeof coordinator.transactComputed !== 'function') {
      return { ok: false, message: 'Locked browser-storage snapshots are unavailable.' };
    }
    const snapshot = await coordinator.transactComputed<readonly (readonly [string, string])[]>(() => {
      const keys = backend.keys();
      if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) {
        throw new Error('The browser returned an invalid storage key list.');
      }
      const entries: Array<readonly [string, string]> = [];
      for (const key of keys) {
        if (
          !key.startsWith('gc.')
          || key === STORAGE_TRANSACTION_JOURNAL_KEY
          || key === STORAGE_RECOVERY_RESET_INTENT_KEY
        ) continue;
        const raw = backend.getItem(key);
        if (raw !== null) entries.push([key, raw]);
      }
      return { mutations: [], metadata: entries };
    });
    if (!snapshot.ok) return { ok: false, message: snapshot.error.message };
    if (!core.applyExternalSnapshot(new Map(snapshot.metadata))) {
      return {
        ok: false,
        message: core.getStatus().lastError?.message ?? 'The browser-storage snapshot was quarantined.',
      };
    }
    return { ok: true, entries: snapshot.metadata.length };
  } catch (error) {
    let message = 'Browser storage could not be resynchronized.';
    try { message = error instanceof Error ? error.message : String(error); }
    catch { /* hostile failures stay generic */ }
    return { ok: false, message: message.slice(0, 500) };
  }
}

/**
 * Coalesce cross-document notifications into locked durable snapshots. Event
 * payloads are only wakeups: neither their ordering nor their values are
 * trusted as the authoritative state.
 */
export function createBrowserStorageSyncController(options: {
  readonly storageArea: Storage;
  readonly backend?: StorageBackend;
  readonly coordinator?: StorageTransactionCoordinator;
  readonly core?: BrowserStorageSyncCore;
}): BrowserStorageSyncController {
  const {
    storageArea,
    backend = browserStorageBackend,
    coordinator = browserStorageCoordinator,
    core = browserStorageCore,
  } = options;
  let requested = false;
  let running = false;
  let lastResult: BrowserStorageResyncResult = { ok: true, entries: 0 };
  let tail: Promise<BrowserStorageResyncResult> = Promise.resolve(lastResult);

  const schedule = (): Promise<BrowserStorageResyncResult> => {
    requested = true;
    if (running) return tail;
    running = true;
    tail = (async () => {
      do {
        requested = false;
        lastResult = await resyncBrowserStorage(backend, coordinator, core);
      } while (requested);
      running = false;
      return lastResult;
    })();
    return tail;
  };

  return {
    handleStorageEvent: (event) => {
      try {
        if (event.storageArea !== storageArea) return;
        const key = event.key;
        if (key === null) {
          void schedule();
          return;
        }
        if (key === STORAGE_TRANSACTION_JOURNAL_KEY) {
          // An open event may be the last notification from a writer that
          // crashes. Start locked recovery immediately: Web Locks make this
          // wait for a live writer, while a dead writer's journal is completed
          // without requiring a close event that will never arrive.
          void schedule();
          return;
        }
        if (!key.startsWith('gc.')) return;
        // Every application event is a wakeup. Suppressing key events after a
        // failed journal-triggered snapshot could otherwise strand this tab in
        // a stale "transaction open" state indefinitely. The coalescer bounds
        // duplicate work, and the Web Lock prevents observing a live partial
        // transaction.
        void schedule();
      } catch {
        // A malformed synthetic event is still grounds for a full durable scan.
        void schedule();
      }
    },
    handlePageShow: (event) => {
      if (event.persisted) void schedule();
    },
    resync: schedule,
    flush: async () => {
      while (running || requested) {
        const observed = tail;
        await observed;
        if (observed === tail && !running && !requested) break;
      }
      return lastResult;
    },
  };
}

/** Install the singleton listener before boot recovery/migration begins. */
export function initializeBrowserStorageSync(): BrowserStorageSyncController {
  if (installedBrowserStorageSync) return installedBrowserStorageSync;
  if (typeof window === 'undefined') {
    throw new Error('Browser storage synchronization requires a window.');
  }
  const controller = createBrowserStorageSyncController({
    storageArea: defaultStorageProvider(),
  });
  window.addEventListener('storage', controller.handleStorageEvent);
  window.addEventListener('pageshow', controller.handlePageShow);
  installedBrowserStorageSync = controller;
  return controller;
}
