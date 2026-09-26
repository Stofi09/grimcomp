import {
  _recoverStoredStateForTests,
  _resetStoredCache,
  waitForStorageIdle,
} from '@/hooks/useStoredState';
import { runStorageMigrations } from '@/storage/migrations';
import { installTestWebLocks } from './webLocks';

/** Initialize the storage singleton for component/hook tests that bypass main. */
export async function prepareStorageTest(): Promise<void> {
  // Production intentionally fails closed without a cross-tab lock. Tests that
  // bypass main.tsx inject an explicit single-process lock implementation.
  installTestWebLocks();
  await waitForStorageIdle();
  localStorage.clear();
  _resetStoredCache();
  await _recoverStoredStateForTests();
  // Component tests bypass main.tsx, so mirror the production boot gate: a
  // successful migration/stamp must precede any fenced app write.
  const migration = await runStorageMigrations();
  if (!migration.ok) throw new Error(migration.error.message);
}

/** Settle writes before clearing shared storage so tests cannot leak commits. */
export async function cleanupStorageTest(): Promise<void> {
  await waitForStorageIdle();
  localStorage.clear();
  _resetStoredCache();
}

export { waitForStorageIdle };
