import type { TalentDef } from '@/content/types';

export interface StoredTalentRef {
  /** Canonical display-name snapshot, retained if its source pack is disabled. */
  name: string;
  /** Stable catalog identity for new-format purchases. */
  definitionId?: string;
  /** Concrete choice for a parameterised definition. */
  specialization?: string;
}

export type TalentRefLike = Pick<
  StoredTalentRef,
  'name' | 'definitionId' | 'specialization'
>;

export interface ResolvedTalentRef {
  stored: StoredTalentRef;
  definition?: TalentDef;
  name: string;
  specialization?: string;
}

export interface TalentRankOwner {
  ref: StoredTalentRef;
  /** Current and historical display labels that may exist as legacy map keys. */
  aliases?: readonly string[];
  /** Runtime content is untrusted even though authored Character data is typed. */
  initial: unknown;
}

export interface MigratedTalentRanks {
  times: Record<string, number>;
  migrated: boolean;
}

export const TALENT_TRACKING_NOTICE =
  'Ranks, XP, and listed Max are tracked; Talent effects are resolved manually.';

const nonBlank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const normalized = (value: string): string => value.trim().toLowerCase();

/** Stable ownership/rank identity. Definition IDs are authoritative when present. */
export function talentIdentityKey(
  ref: TalentRefLike,
): string {
  const definitionId = ref.definitionId?.trim();
  if (definitionId) {
    return `definition:${encodeURIComponent(definitionId)}`
      + `|specialization:${encodeURIComponent(normalized(ref.specialization ?? ''))}`;
  }
  return `name:${encodeURIComponent(normalized(ref.name))}`;
}

/**
 * Accept both the legacy string[] overlay and the stable object form. Invalid
 * imported values are ignored rather than being allowed to crash a screen.
 */
export function normalizeAddedTalentRefs(value: unknown): StoredTalentRef[] {
  if (!Array.isArray(value)) return [];

  const refs: StoredTalentRef[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    let ref: StoredTalentRef | undefined;
    if (nonBlank(candidate)) {
      ref = { name: candidate.trim() };
    } else if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const record = candidate as Record<string, unknown>;
      if (!nonBlank(record.name)) continue;
      if (record.definitionId !== undefined && !nonBlank(record.definitionId)) continue;
      if (record.specialization !== undefined && !nonBlank(record.specialization)) continue;
      ref = {
        name: record.name.trim(),
        ...(nonBlank(record.definitionId) ? { definitionId: record.definitionId.trim() } : {}),
        ...(nonBlank(record.specialization) ? { specialization: record.specialization.trim() } : {}),
      };
    }
    if (!ref) continue;

    const key = talentIdentityKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

/** Defensive reader for legacy-name and canonical-key rank maps. */
export function normalizeTalentTimes(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([name, times]) => {
    if (!name.trim()
      || typeof times !== 'number'
      || !Number.isFinite(times)
      || !Number.isInteger(times)
      || times < 1) {
      return [];
    }
    return [[name, times] as const];
  });
  return Object.fromEntries(entries);
}

/** Exact JSON-shape comparison used to make cleanup migrations converge. */
export function talentTimesEqual(
  value: unknown,
  expected: Readonly<Record<string, number>>,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  const expectedKeys = Object.keys(expected);
  return entries.length === expectedKeys.length
    && entries.every(([key, rank]) => rank === expected[key]);
}

/** A malformed template rank must never escape into the persisted rank map. */
function normalizedInitialRank(value: unknown): number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 1
    ? value
    : 1;
}

/**
 * Convert old name-keyed ranks to canonical identity keys. A legacy name is
 * consumed by at most one owner, so two definitions sharing a label cannot
 * both inherit the same historical rank.
 */
export function migrateTalentTimes(
  value: unknown,
  owners: readonly TalentRankOwner[],
): MigratedTalentRanks {
  const current = normalizeTalentTimes(value);
  // Preserve unmatched entries. They may belong to a temporarily unavailable
  // template/pack; explicit forget/remove operations delete their exact key.
  const next: Record<string, number> = { ...current };
  const consumedLegacyKeys = new Set<string>();
  const seenOwners = new Set<string>();
  const currentKeys = Object.keys(current);

  for (const owner of owners) {
    const identity = talentIdentityKey(owner.ref);
    if (seenOwners.has(identity)) continue;
    seenOwners.add(identity);

    const aliases = [owner.ref.name, ...(owner.aliases ?? [])]
      .map(alias => alias.trim())
      .filter(Boolean);
    const matchingLegacyKeys = currentKeys.filter(key => (
      key !== identity
      && aliases.some(alias => normalized(alias) === normalized(key))
    ));

    let rank = current[identity];
    let consumedLegacyKey: string | undefined;
    if (rank === undefined) {
      consumedLegacyKey = matchingLegacyKeys.find(key => !consumedLegacyKeys.has(key));
      if (consumedLegacyKey !== undefined) rank = current[consumedLegacyKey];
    }
    // Only retire the alias that actually supplied this owner's rank. If this
    // owner already had a canonical value, a same-name alias may belong to a
    // later owner (or temporarily unavailable content) and must survive.
    if (consumedLegacyKey !== undefined) {
      consumedLegacyKeys.add(consumedLegacyKey);
      delete next[consumedLegacyKey];
    }

    next[identity] = rank ?? normalizedInitialRank(owner.initial);
  }

  return { times: next, migrated: !talentTimesEqual(value, next) };
}

/** Concrete character-sheet label for a parameterised definition. */
export function talentDisplayName(definition: TalentDef, specialization: string): string {
  const marker = definition.name.match(/\s*\([^()]+\)\s*$/);
  if (marker?.index !== undefined) {
    return `${definition.name.slice(0, marker.index).trimEnd()} ${specialization}`;
  }
  return `${definition.name} (${specialization})`;
}

function canonicalSpecialization(
  definition: TalentDef,
  specialization: string | undefined,
): string | undefined {
  if (!specialization || !definition.specializations?.length) return undefined;
  return definition.specializations.find(value => normalized(value) === normalized(specialization));
}

function inferSpecialization(definition: TalentDef, name: string): string | undefined {
  for (const specialization of definition.specializations ?? []) {
    if (normalized(talentDisplayName(definition, specialization)) === normalized(name)) {
      return specialization;
    }

    // Legacy sheets sometimes parenthesized a concrete option even when the
    // printed generalized heading used a parenthesized placeholder.
    const marker = definition.name.match(/\s*\([^()]+\)\s*$/);
    const base = marker?.index === undefined
      ? definition.name
      : definition.name.slice(0, marker.index).trimEnd();
    if (normalized(`${base} (${specialization})`) === normalized(name)) return specialization;
  }
  if (!definition.specializations?.length) {
    const escapedName = definition.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = name.match(new RegExp(`^${escapedName} \\(([^()]+)\\)$`, 'i'));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return undefined;
}

/** Exact definition lookup followed by a deliberately bounded grouped fallback. */
export function talentDefForName(
  definitions: TalentDef[],
  name: string,
): TalentDef | undefined {
  return definitions.find(definition => definition.name === name)
    ?? definitions.find(definition => inferSpecialization(definition, name) !== undefined)
    ?? definitions.find(definition => (
      !definition.specializations?.length
      && new RegExp(`^${definition.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\([^()]+\\)$`).test(name)
    ));
}

export function talentDefForTalent(
  definitions: TalentDef[],
  talent: Pick<StoredTalentRef, 'definitionId' | 'name'>,
): TalentDef | undefined {
  if (talent.definitionId) {
    return definitions.find(definition => definition.id === talent.definitionId);
  }
  return talentDefForName(definitions, talent.name);
}

/** Build the stable new-format overlay record used by the acquisition picker. */
export function canonicalTalentRef(
  definition: TalentDef,
  specialization?: string,
): StoredTalentRef | undefined {
  if (definition.specializations?.length) {
    const choice = canonicalSpecialization(definition, specialization);
    if (!choice) return undefined;
    return {
      definitionId: definition.id,
      specialization: choice,
      name: talentDisplayName(definition, choice),
    };
  }
  if (specialization?.trim()) {
    const choice = specialization.trim();
    return {
      definitionId: definition.id,
      specialization: choice,
      name: talentDisplayName(definition, choice),
    };
  }
  return { definitionId: definition.id, name: definition.name };
}

/** Resolve an overlay ID first while retaining a usable legacy-name fallback. */
export function resolveStoredTalentRef(
  definitions: TalentDef[],
  stored: StoredTalentRef,
): ResolvedTalentRef {
  const definition = talentDefForTalent(definitions, stored);
  if (!definition) return { stored, name: stored.name, specialization: stored.specialization };

  const specialization = canonicalSpecialization(definition, stored.specialization)
    ?? stored.specialization?.trim()
    ?? inferSpecialization(definition, stored.name);
  const name = specialization
    ? talentDisplayName(definition, specialization)
    : stored.definitionId
      ? definition.name
      : stored.name;
  return { stored, definition, name, specialization };
}

/** Resolve a sheet entry to a stable ref while retaining its stored-name snapshot. */
export function storedTalentRefFor(
  definitions: TalentDef[],
  talent: TalentRefLike,
): StoredTalentRef {
  const definition = talentDefForTalent(definitions, talent);
  if (!definition) {
    return {
      name: talent.name.trim(),
      ...(talent.definitionId?.trim() ? { definitionId: talent.definitionId.trim() } : {}),
      ...(talent.specialization?.trim() ? { specialization: talent.specialization.trim() } : {}),
    };
  }
  const resolved = resolveStoredTalentRef(definitions, {
    name: talent.name,
    definitionId: definition.id,
    specialization: talent.specialization,
  });
  return {
    name: talent.name.trim(),
    definitionId: definition.id,
    ...(resolved.specialization ? { specialization: resolved.specialization } : {}),
  };
}

/**
 * Normalize mixed legacy/stable ownership, migrate resolvable legacy names to
 * IDs, and de-duplicate by resolved identity. Existing stable snapshots win so
 * old XP labels remain available for refund aliases after a definition rename.
 */
export function canonicalizeAddedTalentRefs(
  definitions: TalentDef[],
  value: unknown,
  templateRefs: readonly StoredTalentRef[] = [],
): StoredTalentRef[] {
  const templateKeys = new Set(templateRefs.map(talentIdentityKey));
  const selected = new Map<string, { ref: StoredTalentRef; wasStable: boolean }>();

  for (const stored of normalizeAddedTalentRefs(value)) {
    const resolved = resolveStoredTalentRef(definitions, stored);
    let ref = stored;
    if (resolved.definition) {
      const canonical = canonicalTalentRef(resolved.definition, resolved.specialization);
      ref = canonical
        ? { ...canonical, name: stored.definitionId ? stored.name : canonical.name }
        : storedTalentRefFor(definitions, stored);
    }

    const key = talentIdentityKey(ref);
    if (templateKeys.has(key)) continue;
    const existing = selected.get(key);
    const wasStable = !!stored.definitionId;
    if (!existing || (!existing.wasStable && wasStable)) selected.set(key, { ref, wasStable });
  }

  return [...selected.values()].map(entry => entry.ref);
}

/** Career lists may carry either the generalized heading or a concrete form. */
export function isTalentCareerOption(
  careerTalentNames: ReadonlySet<string>,
  definitions: TalentDef[],
  definition: TalentDef | undefined,
  displayName: string,
): boolean {
  if (careerTalentNames.has(displayName)) return true;
  if (definition && careerTalentNames.has(definition.name)) return true;
  if (!definition) return false;
  const currentSpecialization = inferSpecialization(definition, displayName);
  if (!currentSpecialization) return false;
  return [...careerTalentNames].some(name => (
    talentDefForName(definitions, name)?.id === definition.id
    && inferSpecialization(definition, name) === currentSpecialization
  ));
}

export function talentSourceLabel(
  talent: Pick<TalentDef, 'sourceBook' | 'sourcePage'>,
): string {
  const book = talent.sourceBook?.trim();
  const page = talent.sourcePage !== undefined ? `p. ${talent.sourcePage}` : '';
  return [book, page].filter(Boolean).join(' · ');
}

export function talentRulesStatusLabel(
  talent: Pick<TalentDef, 'rulesStatus'>,
): string {
  if (talent.rulesStatus === 'bibliographic') return 'Index only — resolve this Talent\'s effect from the source';
  if (talent.rulesStatus === 'approximate') return 'Approximate companion summary — verify in source';
  return '';
}

export function talentRulesStatusMeta(
  talent: Pick<TalentDef, 'rulesStatus'>,
): string {
  if (talent.rulesStatus === 'bibliographic') return 'Index only';
  if (talent.rulesStatus === 'approximate') return 'Approximate summary';
  return '';
}
