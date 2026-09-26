// User content packs persisted under `gc.content.packs`.
//
// Storage validates only the list envelope it manages directly (see
// validateNativeStoredValue): `{ enabled: boolean, pack: { id: string } }`
// entries with unique ids. Pack contents are untrusted and may have been
// accepted by an older build whose validator was looser. Every stored pack is
// therefore re-checked with the current strict validator here, at the single
// point where user packs reach the registry. A pack that fails is quarantined:
// it stays stored byte-for-byte (a corrected re-import with the same id
// replaces it), it is never loaded, and Settings lists it with the reason.
// New imports are still validated strictly before they are written.

import type { ContentPack } from './types';
import { validatePack } from './validate';

export const CONTENT_PACKS_KEY = 'gc.content.packs';

/** The only pack field the storage envelope guarantees. */
export interface StoredPackBody {
  readonly id: string;
}

/** One persisted list entry. `pack` is a ContentPack only after validation. */
export interface StoredPackEntry {
  readonly pack: StoredPackBody;
  readonly enabled: boolean;
}

export interface StoredPackStatus {
  readonly id: string;
  /** Display-safe labels: a quarantined pack's stored fields may not be text. */
  readonly name: string;
  readonly version: string;
  readonly enabled: boolean;
  /** Rejected by the current validator, so it is never loaded. */
  readonly quarantined: boolean;
  /** Bounded current-validator diagnostics; empty for a loadable pack. */
  readonly errors: readonly string[];
}

export interface StoredPackPartition {
  /** Enabled packs that pass current validation, in stored (override) order. */
  readonly active: readonly ContentPack[];
  /** Every stored pack in stored order, for Settings. */
  readonly statuses: readonly StoredPackStatus[];
  readonly quarantined: readonly StoredPackStatus[];
}

const MAX_REPORTED_ERRORS = 5;
const MAX_LABEL_LENGTH = 120;
const EMPTY_PARTITION: StoredPackPartition = { active: [], statuses: [], quarantined: [] };
// Keyed by the parsed stored array, whose identity only changes when the list
// is written, so the provider and Settings share one validation pass.
const partitions = new WeakMap<object, StoredPackPartition>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function label(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_LABEL_LENGTH) : fallback;
}

/**
 * Split the stored list into loadable packs and quarantined ones. Never throws:
 * anything that is not a well-formed, currently valid pack is simply not loaded.
 */
export function partitionStoredPacks(entries: unknown): StoredPackPartition {
  if (!Array.isArray(entries)) return EMPTY_PARTITION;
  const cached = partitions.get(entries);
  if (cached) return cached;

  const active: ContentPack[] = [];
  const statuses: StoredPackStatus[] = [];
  for (const entry of entries as readonly unknown[]) {
    const record = isRecord(entry) ? entry : {};
    const body = isRecord(record.pack) ? record.pack : {};
    const id = typeof body.id === 'string' ? body.id : '';
    const enabled = record.enabled === true;
    let validated: ContentPack | undefined;
    let errors: readonly string[];
    try {
      const validation = validatePack(record.pack);
      validated = validation.pack;
      errors = validation.pack ? [] : validation.errors.slice(0, MAX_REPORTED_ERRORS);
    } catch {
      errors = ['The stored pack could not be inspected safely.'];
    }
    if (!validated && errors.length === 0) errors = ['Unknown validation error.'];
    statuses.push({
      id,
      name: label(body.name, id.trim() ? id.trim().slice(0, MAX_LABEL_LENGTH) : 'Unnamed pack'),
      version: label(body.version, ''),
      enabled,
      quarantined: !validated,
      errors,
    });
    if (validated && enabled) active.push(validated);
  }

  const partition: StoredPackPartition = {
    active,
    statuses,
    quarantined: statuses.filter(status => status.quarantined),
  };
  partitions.set(entries, partition);
  return partition;
}

/** Number of packs in a stored or imported list that would be quarantined. */
export function countQuarantinedPacks(entries: unknown): number {
  return partitionStoredPacks(entries).quarantined.length;
}

/** Add or replace (by id) a pack that already passed strict validation. */
export function upsertStoredPack(
  previous: readonly StoredPackEntry[],
  pack: ContentPack,
): StoredPackEntry[] {
  const next: StoredPackEntry = { pack, enabled: true };
  const index = previous.findIndex(entry => entry.pack.id === pack.id);
  if (index < 0) return [...previous, next];
  const copy = [...previous];
  copy[index] = next;
  return copy;
}

/** Other entries, including quarantined ones, are carried over verbatim. */
export function removeStoredPack(
  previous: readonly StoredPackEntry[],
  id: string,
): StoredPackEntry[] {
  return previous.filter(entry => entry.pack.id !== id);
}

export function setStoredPackEnabled(
  previous: readonly StoredPackEntry[],
  id: string,
  enabled: boolean,
): StoredPackEntry[] {
  return previous.map(entry => (entry.pack.id === id ? { ...entry, enabled } : entry));
}
