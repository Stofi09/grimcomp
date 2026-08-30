import {
  STORAGE_TRANSACTION_JOURNAL_KEY,
  type StorageRecoveryResult,
  type StorageExclusiveLock,
  type StorageTransactionCoordinator,
} from '@grimcomp/core';
import type { StorageBackend } from '@/hooks/storageCore';
import {
  browserStorageBackend,
  browserStorageCoordinator,
  createBrowserExclusiveLock,
  initializeBrowserStorageSync,
  WEB_STORAGE_LOCK_UNAVAILABLE_MESSAGE,
  type BrowserStorageResyncResult,
  type BrowserStorageSyncController,
} from './browserStorage';
import {
  STORAGE_VERSION,
  STORAGE_VERSION_KEY,
  runStorageMigrations,
  type StorageMigrationResult,
} from './migrations';
import {
  STORAGE_RECOVERY_RESET_INTENT_KEY,
  STORAGE_RECOVERY_RESET_INTENT_RAW,
  STORAGE_RECOVERY_RESET_WITNESS_KEY,
  STORAGE_RECOVERY_RESET_WITNESS_RAW,
} from './storageSchema';

export type StorageBootResult =
  | {
      readonly ok: true;
      readonly recovery: StorageRecoveryResult & { readonly ok: true };
      readonly migration: StorageMigrationResult & { readonly ok: true };
      readonly resync: BrowserStorageResyncResult & { readonly ok: true };
    }
  | {
      readonly ok: false;
      readonly stage: 'capability';
      readonly title: string;
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly stage: 'recovery';
      readonly title: string;
      readonly message: string;
      readonly recovery: StorageRecoveryResult & { readonly ok: false };
    }
  | {
      readonly ok: false;
      readonly stage: 'migration';
      readonly title: string;
      readonly message: string;
      readonly migration: StorageMigrationResult & { readonly ok: false };
    }
  | {
      readonly ok: false;
      readonly stage: 'reset';
      readonly title: string;
      readonly message: string;
      readonly reset: WebRecoveryResetResult & { readonly ok: false };
    }
  | {
      readonly ok: false;
      readonly stage: 'resync';
      readonly title: string;
      readonly message: string;
      readonly resync: BrowserStorageResyncResult & { readonly ok: false };
    };

export type StorageBootFailure = Extract<StorageBootResult, { readonly ok: false }>;

export type WebRecoveryResetResult =
  | { readonly ok: true; readonly removed: number; readonly message: string }
  | { readonly ok: false; readonly removed: number; readonly message: string };

interface WebRecoveryOptions {
  readonly backend?: StorageBackend;
  readonly coordinator?: StorageTransactionCoordinator;
  readonly targetVersion?: number;
}

interface WebRecoveryResetProtocolOptions {
  readonly backend?: StorageBackend;
  readonly targetVersion?: number;
  readonly withExclusiveLock?: StorageExclusiveLock;
}

interface WebStorageInitializationOptions extends WebRecoveryResetProtocolOptions {
  readonly coordinator?: StorageTransactionCoordinator;
  readonly migrate?: () => Promise<StorageMigrationResult>;
  readonly sync?: Pick<BrowserStorageSyncController, 'resync'>;
}

function boundedCause(error: unknown): string {
  try {
    return (error instanceof Error ? error.message : String(error)).slice(0, 500);
  } catch {
    return 'Unprintable storage failure';
  }
}

/** Complete a confirmed reset, then recover/migrate/resync before React can read. */
export async function initializeWebStorage(
  options: WebStorageInitializationOptions = {},
): Promise<StorageBootResult> {
  if (
    options.withExclusiveLock === undefined
    && typeof navigator !== 'undefined'
    && (!navigator.locks || typeof navigator.locks.request !== 'function')
  ) {
    return {
      ok: false,
      stage: 'capability',
      title: 'Safe local storage is unavailable',
      message: WEB_STORAGE_LOCK_UNAVAILABLE_MESSAGE,
    };
  }
  const {
    backend = browserStorageBackend,
    coordinator = browserStorageCoordinator,
    targetVersion = STORAGE_VERSION,
    withExclusiveLock = createBrowserExclusiveLock(),
    migrate = runStorageMigrations,
  } = options;
  const pendingReset = await completePendingWebRecoveryReset({
    backend,
    targetVersion,
    withExclusiveLock,
  });
  if (!pendingReset.ok) {
    return {
      ok: false,
      stage: 'reset',
      title: 'Local data reset needs attention',
      message: `${pendingReset.message} Normal recovery was not started.`,
      reset: pendingReset,
    };
  }

  // The listener must exist before the first journal inspection so no event is
  // lost while App's dependency graph is being loaded later.
  const sync = options.sync ?? initializeBrowserStorageSync();
  const recovery = await coordinator.recover();
  if (!recovery.ok) {
    return {
      ok: false,
      stage: 'recovery',
      title: 'Local data needs attention',
      message: `${recovery.error.message} Gameplay state was not opened, and the recovery journal was preserved. Reload to retry recovery.`,
      recovery,
    };
  }

  const migration = await migrate();
  if (!migration.ok) {
    return {
      ok: false,
      stage: 'migration',
      title: 'Local data cannot be upgraded safely',
      message: `${migration.error.message} Your saved data was not opened with an incompatible schema.`,
      migration,
    };
  }

  // A second recovery plus locked snapshot closes the recovery→migration→App
  // import gap and pre-populates the cache from one durable state.
  const resync = await sync.resync();
  if (!resync.ok) {
    return {
      ok: false,
      stage: 'resync',
      title: 'Local data changed during startup',
      message: `${resync.message} Gameplay state was not rendered. Reload to retry synchronization.`,
      resync,
    };
  }

  return { ok: true, recovery, migration, resync };
}

/** Repeat the locked snapshot after App's dynamic module graph has loaded. */
export function resyncWebStorageBeforeRender(): Promise<BrowserStorageResyncResult> {
  return initializeBrowserStorageSync().resync();
}

/**
 * Lossless diagnostic payload for the pre-React recovery shell. Unlike a
 * portable roster export, raw values and the journal are intentionally kept so
 * support can inspect malformed or partially recovered storage.
 */
export function buildWebRecoveryDiagnosticExport(
  failure?: Pick<StorageBootFailure, 'stage' | 'title' | 'message'>,
  backend: StorageBackend = browserStorageBackend,
): string {
  const raw = Object.create(null) as Record<string, string>;
  for (const key of backend.keys().filter(key => key.startsWith('gc.')).sort()) {
    const value = backend.getItem(key);
    if (value !== null) raw[key] = value;
  }
  const resetWitness = backend.getItem(STORAGE_RECOVERY_RESET_WITNESS_KEY);
  if (resetWitness !== null) raw[STORAGE_RECOVERY_RESET_WITNESS_KEY] = resetWitness;
  return JSON.stringify({
    $schema: 'grimcomp.storage-diagnostic.v1',
    exportedAt: new Date().toISOString(),
    platform: 'web',
    failure: failure ?? null,
    raw,
  }, null, 2);
}

async function completePendingWebRecoveryResetLocked(
  backend: StorageBackend,
  targetVersion: number,
): Promise<WebRecoveryResetResult> {
  let intentRaw: string | null;
  let witnessRaw: string | null;
  try {
    intentRaw = backend.getItem(STORAGE_RECOVERY_RESET_INTENT_KEY);
    witnessRaw = backend.getItem(STORAGE_RECOVERY_RESET_WITNESS_KEY);
  } catch (error) {
    return { ok: false, removed: 0, message: `Could not inspect the durable reset intent: ${boundedCause(error)}` };
  }
  if (intentRaw === null && witnessRaw === null) {
    return { ok: true, removed: 0, message: 'No recovery reset was pending.' };
  }
  if (witnessRaw !== STORAGE_RECOVERY_RESET_WITNESS_RAW) {
    return {
      ok: false,
      removed: 0,
      message: 'The recovery-reset intent has no valid confirmation witness. Confirm Reset local data again to replace it safely.',
    };
  }
  if (intentRaw !== null && intentRaw !== STORAGE_RECOVERY_RESET_INTENT_RAW) {
    return {
      ok: false,
      removed: 0,
      message: 'The durable recovery-reset intent is malformed. Confirm Reset local data again to replace it safely.',
    };
  }
  if (!Number.isSafeInteger(targetVersion) || targetVersion < 1) {
    return { ok: false, removed: 0, message: 'This build has an invalid browser storage version.' };
  }

  let removed = 0;
  try {
    // A crash after the non-gc witness but before this gc.* marker is harmless:
    // reinstalling it makes the remaining restartable stages explicit.
    if (intentRaw === null) {
      backend.setItem(STORAGE_RECOVERY_RESET_INTENT_KEY, STORAGE_RECOVERY_RESET_INTENT_RAW);
      if (backend.getItem(STORAGE_RECOVERY_RESET_INTENT_KEY) !== STORAGE_RECOVERY_RESET_INTENT_RAW) {
        throw new Error('The durable recovery-reset intent could not be verified.');
      }
    }

    const keys = backend.keys();
    if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) {
      throw new Error('The browser returned an invalid storage key list during reset.');
    }
    for (const key of new Set(keys)) {
      if (!key.startsWith('gc.') || key === STORAGE_RECOVERY_RESET_INTENT_KEY) continue;
      backend.removeItem(key);
      if (backend.getItem(key) !== null) {
        throw new Error(`Removal of ${JSON.stringify(key)} could not be verified.`);
      }
      if (key !== STORAGE_TRANSACTION_JOURNAL_KEY && key !== STORAGE_VERSION_KEY) removed += 1;
    }

    const remaining = backend.keys().filter(key => (
      key.startsWith('gc.') && key !== STORAGE_RECOVERY_RESET_INTENT_KEY
    ));
    if (remaining.length > 0) {
      throw new Error(`New or unremoved application key ${JSON.stringify(remaining[0])} prevented a verified reset.`);
    }

    const versionRaw = JSON.stringify(targetVersion);
    backend.setItem(STORAGE_VERSION_KEY, versionRaw);
    if (backend.getItem(STORAGE_VERSION_KEY) !== versionRaw) {
      throw new Error('The current browser storage version could not be verified.');
    }

    backend.removeItem(STORAGE_RECOVERY_RESET_INTENT_KEY);
    if (backend.getItem(STORAGE_RECOVERY_RESET_INTENT_KEY) !== null) {
      throw new Error('The completed recovery-reset intent could not be cleared.');
    }
    // The witness is the durable authorization root and is deliberately last.
    // If termination happens before this removal, startup repeats the reset.
    backend.removeItem(STORAGE_RECOVERY_RESET_WITNESS_KEY);
    if (backend.getItem(STORAGE_RECOVERY_RESET_WITNESS_KEY) !== null) {
      throw new Error('The completed recovery-reset witness could not be cleared.');
    }
    return {
      ok: true,
      removed,
      message: removed === 0
        ? 'Local data was reset and the current storage format was initialized.'
        : `Removed ${removed} local data ${removed === 1 ? 'entry' : 'entries'} and reinitialized storage.`,
    };
  } catch (error) {
    return {
      ok: false,
      removed,
      message: `${boundedCause(error)} Any surviving confirmation witness will resume the reset on reload.`,
    };
  }
}

/** Finish an already confirmed destructive reset before ordinary recovery. */
export async function completePendingWebRecoveryReset(
  options: WebRecoveryResetProtocolOptions = {},
): Promise<WebRecoveryResetResult> {
  const {
    backend = browserStorageBackend,
    targetVersion = STORAGE_VERSION,
    withExclusiveLock = createBrowserExclusiveLock(),
  } = options;
  try {
    return await withExclusiveLock(() => completePendingWebRecoveryResetLocked(backend, targetVersion));
  } catch (error) {
    return {
      ok: false,
      removed: 0,
      message: `The recovery-reset lock failed: ${boundedCause(error)} Reload to retry any durable intent.`,
    };
  }
}

/** Install verified confirmation markers, then run the restartable reset. */
export async function forceResetWebStorageForRecovery(
  options: WebRecoveryResetProtocolOptions = {},
): Promise<WebRecoveryResetResult> {
  const {
    backend = browserStorageBackend,
    targetVersion = STORAGE_VERSION,
    withExclusiveLock = createBrowserExclusiveLock(),
  } = options;
  try {
    return await withExclusiveLock(async () => {
      try {
        backend.setItem(STORAGE_RECOVERY_RESET_WITNESS_KEY, STORAGE_RECOVERY_RESET_WITNESS_RAW);
      } catch {
        // A provider may throw after writing; the exact read-back decides.
      }
      if (backend.getItem(STORAGE_RECOVERY_RESET_WITNESS_KEY) !== STORAGE_RECOVERY_RESET_WITNESS_RAW) {
        return { ok: false, removed: 0, message: 'The reset confirmation witness could not be verified. No reset was started.' };
      }
      try {
        backend.setItem(STORAGE_RECOVERY_RESET_INTENT_KEY, STORAGE_RECOVERY_RESET_INTENT_RAW);
      } catch {
        // A verified witness makes this restartable even if the write threw.
      }
      const installed = backend.getItem(STORAGE_RECOVERY_RESET_INTENT_KEY);
      if (installed !== STORAGE_RECOVERY_RESET_INTENT_RAW && installed !== null) {
        return { ok: false, removed: 0, message: 'The reset intent could not be verified. Reload or confirm reset again.' };
      }
      return completePendingWebRecoveryResetLocked(backend, targetVersion);
    });
  } catch (error) {
    return {
      ok: false,
      removed: 0,
      message: `The confirmed recovery reset failed: ${boundedCause(error)} Reload to resume any durable intent.`,
    };
  }
}

/**
 * Reset data through the normal journal only after recovery is clean. A
 * corrupt or ambiguous journal is never discarded by this helper; the user
 * can export it verbatim and retry recovery without losing forensic state.
 */
export async function resetWebStorageForRecovery(
  options: WebRecoveryOptions = {},
): Promise<WebRecoveryResetResult> {
  const {
    backend = browserStorageBackend,
    coordinator = browserStorageCoordinator,
    targetVersion = STORAGE_VERSION,
  } = options;
  try {
    const recovery = await coordinator.recover();
    if (!recovery.ok) {
      return {
        ok: false,
        removed: 0,
        message: `Reset stopped because the recovery journal is not safe to discard: ${recovery.error.message}`,
      };
    }
    if (typeof coordinator.transactComputed !== 'function') {
      return {
        ok: false,
        removed: 0,
        message: 'Reset stopped because locked storage maintenance is unavailable.',
      };
    }
    const expectedVersion = JSON.stringify(targetVersion);
    const result = await coordinator.transactComputed<number>(() => {
      const keys = backend.keys();
      if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) {
        throw new Error('The browser returned an invalid storage key list.');
      }
      const mutations: Array<{ key: string; value: string | null; expected: string | null }> = [];
      let removed = 0;
      let currentVersion: string | null = null;
      for (const key of keys) {
        if (
          !key.startsWith('gc.')
          || key === STORAGE_TRANSACTION_JOURNAL_KEY
          || key === STORAGE_RECOVERY_RESET_INTENT_KEY
        ) continue;
        const current = backend.getItem(key);
        if (key === STORAGE_VERSION_KEY) {
          currentVersion = current;
          continue;
        }
        if (current !== null) {
          mutations.push({ key, value: null, expected: current });
          removed += 1;
        }
      }
      if (currentVersion !== expectedVersion) {
        mutations.push({
          key: STORAGE_VERSION_KEY,
          value: expectedVersion,
          expected: currentVersion,
        });
      }
      return { mutations, metadata: removed };
    });
    if (!result.ok) {
      return {
        ok: false,
        removed: 0,
        message: `Reset stopped safely: ${result.error.message}`,
      };
    }
    return {
      ok: true,
      removed: result.metadata,
      message: result.outcome === 'unchanged'
        ? 'Local data was already empty.'
        : `Removed ${result.metadata} local data ${result.metadata === 1 ? 'entry' : 'entries'}.`,
    };
  } catch (error) {
    return {
      ok: false,
      removed: 0,
      message: `Reset stopped safely: ${boundedCause(error)}`,
    };
  }
}

function downloadDiagnostic(contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `grimcomp-storage-diagnostic-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`;
  anchor.style.display = 'none';
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

/** Minimal no-App fallback used when persistence cannot be made safe at boot. */
export function renderStorageBootFailure(
  root: HTMLElement,
  result: {
    readonly title: string;
    readonly message: string;
    readonly stage?: 'capability' | 'recovery' | 'migration' | 'reset' | 'resync';
  },
): void {
  const panel = document.createElement('main');
  panel.setAttribute('role', 'alert');
  panel.style.maxWidth = '42rem';
  panel.style.margin = '4rem auto';
  panel.style.padding = '1.5rem';
  panel.style.fontFamily = 'Inter, system-ui, sans-serif';

  const heading = document.createElement('h1');
  heading.textContent = result.title;
  const body = document.createElement('p');
  body.textContent = result.message;
  const status = document.createElement('p');
  status.setAttribute('aria-live', 'polite');

  const buttons = document.createElement('div');
  buttons.style.display = 'flex';
  buttons.style.flexWrap = 'wrap';
  buttons.style.gap = '0.75rem';

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry recovery';
  retry.addEventListener('click', () => window.location.reload());
  buttons.append(retry);

  const diagnostic = document.createElement('button');
  diagnostic.type = 'button';
  diagnostic.textContent = 'Export raw diagnostic';
  diagnostic.addEventListener('click', () => {
    try {
      downloadDiagnostic(buildWebRecoveryDiagnosticExport(
        result.stage ? { ...result, stage: result.stage } : undefined,
      ));
      status.textContent = 'Raw local-storage diagnostic downloaded.';
    } catch (error) {
      status.textContent = `Diagnostic export failed: ${boundedCause(error)}`;
    }
  });
  buttons.append(diagnostic);

  if (result.stage !== undefined && result.stage !== 'capability') {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset local data';
    reset.addEventListener('click', () => {
      if (!window.confirm(
        'Permanently remove all Grim Companion gameplay data, bypass any unrecoverable journal, and initialize the current storage format? Export a diagnostic first if you may need the old values.',
      )) return;
      retry.disabled = true;
      diagnostic.disabled = true;
      reset.disabled = true;
      status.textContent = 'Resetting local data…';
      void forceResetWebStorageForRecovery().then((outcome) => {
        if (outcome.ok) {
          status.textContent = `${outcome.message} Reloading…`;
          window.location.reload();
          return;
        }
        retry.disabled = false;
        diagnostic.disabled = false;
        reset.disabled = false;
        status.textContent = outcome.message;
      });
    });
    buttons.append(reset);
  }

  panel.append(heading, body, buttons, status);
  root.replaceChildren(panel);
}
