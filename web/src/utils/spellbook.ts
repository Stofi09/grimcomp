/**
 * Character spellbooks are stored as a delta over the immutable character
 * template. Keeping additions and removals separately means a later content
 * update can add another template spell without replacing the player's edits.
 */
export interface SpellbookOverlay {
  added: string[];
  removed: string[];
}

export const EMPTY_SPELLBOOK_OVERLAY: SpellbookOverlay = {
  added: [],
  removed: [],
};

const uniqueIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id): id is string => typeof id === 'string')
    .map(id => id.trim())
    .filter(Boolean))];
};

/**
 * Treat local/imported storage as untrusted. Legacy arrays, nulls, partial
 * objects, and arrays with non-string members all safely collapse to a clean
 * delta without discarding valid (possibly temporarily unavailable) spell ids.
 */
export function normalizeSpellbookOverlay(value: unknown): SpellbookOverlay {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { added: [], removed: [] };
  }
  const candidate = value as Record<string, unknown>;
  return {
    added: uniqueIds(candidate.added),
    removed: uniqueIds(candidate.removed),
  };
}

/** Resolve template defaults plus a persisted overlay into ordered spell ids. */
export function resolveSpellbookIds(
  templateIds: readonly string[],
  overlay: unknown,
): string[] {
  const normalized = normalizeSpellbookOverlay(overlay);
  const removed = new Set(normalized.removed);
  return uniqueIds([...templateIds, ...normalized.added]).filter(id => !removed.has(id));
}

/** Return the smallest overlay that marks one registry spell selected/unselected. */
export function setSpellbookSelection(
  templateIds: readonly string[],
  overlay: unknown,
  spellId: string,
  selected: boolean,
): SpellbookOverlay {
  const normalized = normalizeSpellbookOverlay(overlay);
  const defaults = new Set(templateIds);
  const added = new Set(normalized.added);
  const removed = new Set(normalized.removed);

  if (selected) {
    removed.delete(spellId);
    if (defaults.has(spellId)) added.delete(spellId);
    else added.add(spellId);
  } else {
    added.delete(spellId);
    if (defaults.has(spellId)) removed.add(spellId);
    else removed.delete(spellId);
  }

  return { added: [...added], removed: [...removed] };
}
