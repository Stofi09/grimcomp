import type { ContentPack } from './types';
import { validatePack } from './validate';
import { FALLBACK_CHARACTER_ID } from '@/data/character';

export const MAX_STORED_CONTENT_PACKS = 10_000;

/** Ignore legacy/tampered user tombstones for the app's required fallback. */
export function preserveRequiredFallbackCharacter(pack: ContentPack): ContentPack {
  const characterTombstones = pack.deletions?.characters;
  if (!characterTombstones?.includes(FALLBACK_CHARACTER_ID)) return pack;
  const deletions = { ...pack.deletions };
  const filtered = characterTombstones.filter(id => id !== FALLBACK_CHARACTER_ID);
  if (filtered.length > 0) deletions.characters = filtered;
  else delete deletions.characters;
  return {
    ...pack,
    ...(Object.keys(deletions).length > 0 ? { deletions } : { deletions: undefined }),
  };
}

/** Convert untrusted persisted JSON into registry-safe enabled pack layers. */
export function collectEnabledStoredPacks(
  value: unknown,
  report: (message: string) => void = (message) => { console.warn(message); },
): ContentPack[] {
  if (!Array.isArray(value)) {
    report('[content] stored pack list rejected: expected an array.');
    return [];
  }
  if (value.length > MAX_STORED_CONTENT_PACKS) {
    report(`[content] stored pack list exceeds the ${MAX_STORED_CONTENT_PACKS}-entry safety limit.`);
    return [];
  }
  const enabled: ContentPack[] = [];
  for (const candidate of value) {
    try {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        report('[content] malformed stored pack entry skipped.');
        continue;
      }
      const stored = candidate as { readonly enabled?: unknown; readonly pack?: unknown };
      if (typeof stored.enabled !== 'boolean') {
        report('[content] stored pack entry skipped: enabled must be boolean.');
        continue;
      }
      if (!stored.enabled) continue;
      const { pack, errors } = validatePack(stored.pack);
      if (pack) enabled.push(pack);
      else report(`[content] stored pack rejected: ${errors.slice(0, 20).join('; ').slice(0, 2_000)}`);
    } catch {
      report('[content] malformed stored pack entry skipped safely.');
    }
  }
  return enabled;
}
