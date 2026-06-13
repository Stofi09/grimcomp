// Versioned localStorage migrations.
//
// All player data — characters, per-character overlays, imported packs,
// settings — lives in `gc.*` keys written by useStoredState as JSON. As the
// data shapes evolve (e.g. a later PR moving the WFRP hero resources into a
// generic resource-pool object), a breaking change must REWRITE existing saves
// rather than silently hydrating them as the wrong shape and corrupting them.
// This is the framework that makes that safe.
//
// runStorageMigrations() MUST run once, before React renders (see main.tsx), so
// the fresh-vs-legacy install is decided before any hook writes a gc.* key.

const VERSION_KEY = 'gc.storageVersion';

// Bump this whenever a STORAGE_MIGRATIONS entry is added. v1 is the
// pre-versioning baseline — every shape shipped to date.
export const STORAGE_VERSION = 1;

// Keyed by the version being migrated FROM. Each transform reads and rewrites
// the relevant gc.* keys in place; the runner then stamps the new version.
// Empty today on purpose: the harness ships one release ahead of the first
// breaking change, so the machinery is proven before anything depends on it.
type Migration = () => void;
const STORAGE_MIGRATIONS: Record<number, Migration> = {
  // 1: () => { /* rewrite gc.<id>.vitals → gc.<id>.resources */ },
};

function lsGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* privacy / quota — skip */ }
}

/** True if any gc.* key other than the version stamp exists (i.e. real data). */
function hasExistingData(): boolean {
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('gc.') && k !== VERSION_KEY) return true;
    }
  } catch { /* privacy mode — treat as fresh */ }
  return false;
}

/**
 * The stored data version. An absent stamp means either a fresh install (no
 * data → already current) or a legacy pre-versioning install (has data →
 * implicitly v1). Distinguishing the two is why this must run before any hook
 * writes its first key.
 */
export function readStorageVersion(): number {
  const raw = lsGet(VERSION_KEY);
  if (raw == null) return hasExistingData() ? 1 : STORAGE_VERSION;
  try {
    const n = Number(JSON.parse(raw));
    return Number.isFinite(n) ? n : 1;
  } catch {
    return 1;
  }
}

/** Apply any pending migrations in order, then stamp the current version.
    Idempotent — safe to call on every boot. */
export function runStorageMigrations(): void {
  let from = readStorageVersion();
  while (from < STORAGE_VERSION) {
    const migrate = STORAGE_MIGRATIONS[from];
    if (migrate) {
      try {
        migrate();
      } catch (e) {
        console.error(`[storage] migration ${from}→${from + 1} failed`, e);
      }
    }
    from += 1;
  }
  // Stamp even on a fresh install so the next breaking change has a baseline.
  lsSet(VERSION_KEY, JSON.stringify(STORAGE_VERSION));
}
