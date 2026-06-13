import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runStorageMigrations, readStorageVersion, STORAGE_VERSION } from './migrations';

// The module reads window.localStorage lazily (per call), so a Map-backed stub
// installed on globalThis.window is enough to exercise it in a node env.
function makeLocalStorage() {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

let ls: ReturnType<typeof makeLocalStorage>;

beforeEach(() => {
  ls = makeLocalStorage();
  (globalThis as { window?: unknown }).window = { localStorage: ls };
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('storage migrations', () => {
  it('stamps the current version on a fresh install', () => {
    runStorageMigrations();
    expect(ls.getItem('gc.storageVersion')).toBe(JSON.stringify(STORAGE_VERSION));
  });

  it('treats an empty store as already current (not legacy)', () => {
    expect(readStorageVersion()).toBe(STORAGE_VERSION);
  });

  it('treats existing unstamped gc.* data as legacy v1', () => {
    ls.setItem('gc.activeCharId', JSON.stringify('c1'));
    expect(readStorageVersion()).toBe(1);
    runStorageMigrations();
    expect(ls.getItem('gc.storageVersion')).toBe(JSON.stringify(STORAGE_VERSION));
  });

  it('reads back a previously stamped version', () => {
    ls.setItem('gc.storageVersion', JSON.stringify(STORAGE_VERSION));
    expect(readStorageVersion()).toBe(STORAGE_VERSION);
  });

  it('is idempotent across repeated boots', () => {
    runStorageMigrations();
    const stamped = ls.getItem('gc.storageVersion');
    runStorageMigrations();
    expect(ls.getItem('gc.storageVersion')).toBe(stamped);
  });
});
