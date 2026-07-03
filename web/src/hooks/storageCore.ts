// The pure, framework-free core behind useStoredState: a cross-instance cache
// over a pluggable key/value backend. Extracted from the hook so the
// persistence semantics the app depends on — synchronous functional updates,
// seed fallback, cross-instance notification, prefix clearing — are unit-tested
// without React or a DOM.

/** The minimal storage surface the core needs (localStorage is one shape of it). */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

export class StorageCore {
  // Invariant: the cache only ever holds *real* values (parsed from the backend,
  // written via update, or received from another tab). Seeds are never cached,
  // so a hook keeps tracking its seed until something is actually persisted.
  private readonly cache = new Map<string, unknown>();
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(private readonly backend: StorageBackend | null) {}

  /** Synchronous read: cache hit wins; else read the backend once and cache the
      parsed value. A missing key or a parse failure falls back to `seed`. */
  read<T>(key: string, seed: T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const raw = this.backend?.getItem(key) ?? null;
    if (raw == null) return seed;
    try {
      const parsed = JSON.parse(raw) as T;
      this.cache.set(key, parsed);
      return parsed;
    } catch {
      return seed;
    }
  }

  /**
   * Resolve a value (or functional update) against the CURRENT cached value and
   * persist it. Runs synchronously and returns the resolved value, so callers
   * (e.g. useXp.spend) can read the result immediately. A no-op update (result
   * Object.is the current value) neither persists nor notifies.
   */
  update<T>(key: string, seed: T, next: T | ((prev: T) => T)): T {
    const cur = this.read(key, seed);
    const resolved = typeof next === 'function' ? (next as (p: T) => T)(cur) : next;
    if (Object.is(resolved, cur)) return cur;
    this.cache.set(key, resolved);
    this.emit(key);
    try {
      this.backend?.setItem(key, JSON.stringify(resolved));
    } catch {
      /* quota exceeded / privacy mode — keep the in-memory value */
    }
    return resolved;
  }

  /** Subscribe to writes for `key`; returns an unsubscribe function. */
  subscribe(key: string, listener: () => void): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(key);
    };
  }

  emit(key: string): void {
    const ls = this.listeners.get(key);
    if (ls) for (const l of [...ls]) l();
  }

  /** Apply an external change (another tab's `storage` event). `raw` null = the
      key was removed; drop it so the next read re-hydrates to the seed. */
  applyExternal(key: string, raw: string | null): void {
    if (raw == null) {
      this.cache.delete(key);
    } else {
      try {
        this.cache.set(key, JSON.parse(raw));
      } catch {
        this.cache.delete(key);
      }
    }
    this.emit(key);
  }

  /** Drop every key matching `predicate` from the backend and the cache,
      notifying subscribers so they fall back to their seed. */
  clearMatching(predicate: (key: string) => boolean): void {
    try {
      for (const k of this.backend?.keys() ?? []) {
        if (predicate(k)) {
          try { this.backend?.removeItem(k); } catch { /* privacy mode */ }
        }
      }
    } catch {
      /* privacy mode — nothing persisted to clear */
    }
    for (const k of [...this.cache.keys()]) {
      if (predicate(k)) {
        this.cache.delete(k);
        this.emit(k);
      }
    }
  }

  /** Test-only: drop everything from the in-memory cache and listeners. */
  reset(): void {
    this.cache.clear();
    this.listeners.clear();
  }
}

/** localStorage as a StorageBackend, null-safe against privacy mode / SSR. */
export function browserBackend(): StorageBackend | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const ls = window.localStorage;
  return {
    getItem: (k) => { try { return ls.getItem(k); } catch { return null; } },
    setItem: (k, v) => { try { ls.setItem(k, v); } catch { /* quota / privacy */ } },
    removeItem: (k) => { try { ls.removeItem(k); } catch { /* privacy */ } },
    keys: () => {
      try {
        const out: string[] = [];
        for (let i = 0; i < ls.length; i += 1) {
          const k = ls.key(i);
          if (k) out.push(k);
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}
