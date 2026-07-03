import { describe, it, expect, beforeEach } from 'vitest';
import { StorageCore, type StorageBackend } from './storageCore';

// A Map-backed StorageBackend so the core is testable without a DOM.
function fakeBackend(): StorageBackend & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
    keys: () => [...store.keys()],
  };
}

describe('StorageCore', () => {
  let backend: ReturnType<typeof fakeBackend>;
  let core: StorageCore;
  beforeEach(() => {
    backend = fakeBackend();
    core = new StorageCore(backend);
  });

  it('falls back to the seed when nothing is stored (seed is never cached)', () => {
    expect(core.read('gc.x', 42)).toBe(42);
    // Reading a seed must not persist it, or a later real write is masked.
    expect(backend.getItem('gc.x')).toBeNull();
    expect(core.read('gc.x', 99)).toBe(99);
  });

  it('persists a write to the backend and reads it back', () => {
    core.update('gc.x', 0, 7);
    expect(backend.getItem('gc.x')).toBe('7');
    expect(core.read('gc.x', 0)).toBe(7);
  });

  it('resolves a functional update synchronously against the current value', () => {
    core.update('gc.n', 0, 10);
    const resolved = core.update<number>('gc.n', 0, (prev) => prev + 5);
    expect(resolved).toBe(15);
    expect(core.read('gc.n', 0)).toBe(15);
  });

  it('a no-op update neither persists nor notifies', () => {
    let hits = 0;
    core.subscribe('gc.x', () => { hits += 1; });
    core.update('gc.x', 0, 3);   // real change → 1 notify
    core.update('gc.x', 0, 3);   // same value → no notify, no re-persist
    expect(hits).toBe(1);
  });

  it('notifies every subscriber of a key when it changes (cross-instance sync)', () => {
    let a = 0; let b = 0;
    core.subscribe('gc.shared', () => { a += 1; });
    core.subscribe('gc.shared', () => { b += 1; });
    core.subscribe('gc.other', () => { throw new Error('unrelated key must not fire'); });
    core.update('gc.shared', 0, 1);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('unsubscribe stops further notifications', () => {
    let hits = 0;
    const off = core.subscribe('gc.x', () => { hits += 1; });
    core.update('gc.x', 0, 1);
    off();
    core.update('gc.x', 0, 2);
    expect(hits).toBe(1);
  });

  it('applyExternal(null) drops a key so the next read returns the seed', () => {
    core.update('gc.x', 0, 5);
    let notified = 0;
    core.subscribe('gc.x', () => { notified += 1; });
    // Another tab removed it: the shared backend no longer has it, and the
    // storage event delivers a null newValue.
    backend.removeItem('gc.x');
    core.applyExternal('gc.x', null);
    expect(notified).toBe(1);
    expect(core.read('gc.x', 123)).toBe(123);
  });

  it('applyExternal parses a value from another tab into the cache', () => {
    core.applyExternal('gc.x', JSON.stringify({ v: 1 }));
    expect(core.read('gc.x', null)).toEqual({ v: 1 });
  });

  it('clearMatching drops matching keys from backend and cache and notifies', () => {
    core.update('gc.c1.wounds', 0, 8);
    core.update('gc.c1.xp', 0, 100);
    core.update('gc.c2.wounds', 0, 5);
    let cleared = 0;
    core.subscribe('gc.c1.wounds', () => { cleared += 1; });
    core.clearMatching((k) => k.startsWith('gc.c1.'));
    expect(cleared).toBe(1);
    expect(backend.getItem('gc.c1.wounds')).toBeNull();
    expect(backend.getItem('gc.c1.xp')).toBeNull();
    expect(backend.getItem('gc.c2.wounds')).toBe('5'); // untouched
    expect(core.read('gc.c1.wounds', -1)).toBe(-1);     // falls back to seed
  });

  it('survives a corrupt stored value by falling back to the seed', () => {
    backend.setItem('gc.bad', '{not json');
    expect(core.read('gc.bad', 'seed')).toBe('seed');
  });

  it('tolerates a null backend (privacy mode / SSR) without throwing', () => {
    const headless = new StorageCore(null);
    expect(headless.read('gc.x', 1)).toBe(1);
    expect(headless.update('gc.x', 1, 2)).toBe(2); // cache-only
    expect(headless.read('gc.x', 1)).toBe(2);
    headless.clearMatching(() => true);
    expect(headless.read('gc.x', 9)).toBe(9);
  });
});
