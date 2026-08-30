import type { ContentPack } from '@/content/types';

/** Persisted imported-pack state after an import has replaced or removed entries. */
export interface PostImportStoredPack {
  readonly pack: ContentPack;
  readonly enabled: boolean;
}

/**
 * Resolve the character-template IDs exposed by the post-import content layers.
 *
 * This intentionally mirrors ContentRegistry's character-specific behavior:
 * enabled imported packs follow bundled packs, user edits merge last, and every
 * `deletions.characters` tombstone is applied only after all layers have merged.
 */
export function resolvePostImportCharacterTemplateIds(
  bundledPacks: readonly ContentPack[],
  storedPacks: readonly PostImportStoredPack[],
  userEditsPack?: ContentPack,
): ReadonlySet<string> {
  const resolvedIds = new Set<string>();
  const tombstones = new Set<string>();

  const mergeLayer = (pack: ContentPack): void => {
    for (const character of pack.characters ?? []) resolvedIds.add(character.id);
    for (const id of pack.deletions?.characters ?? []) tombstones.add(id);
  };

  for (const pack of bundledPacks) mergeLayer(pack);
  for (const stored of storedPacks) {
    if (stored.enabled) mergeLayer(stored.pack);
  }
  if (userEditsPack) mergeLayer(userEditsPack);

  for (const id of tombstones) resolvedIds.delete(id);
  return resolvedIds;
}
