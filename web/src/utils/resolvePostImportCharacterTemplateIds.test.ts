import { describe, expect, it } from 'vitest';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import {
  resolvePostImportCharacterTemplateIds,
  type PostImportStoredPack,
} from './resolvePostImportCharacterTemplateIds';

function pack(
  id: string,
  characterIds: readonly string[] = [],
  deletedCharacterIds: readonly string[] = [],
): ContentPack {
  return {
    $schema: 'grimcomp.content.v2',
    id,
    name: id,
    version: '1',
    characters: characterIds.map((characterId) => ({ id: characterId })),
    deletions: deletedCharacterIds.length > 0
      ? { characters: [...deletedCharacterIds] }
      : undefined,
  } as unknown as ContentPack;
}

function resolvedIds(
  bundledPacks: readonly ContentPack[],
  storedPacks: readonly PostImportStoredPack[],
  userEditsPack?: ContentPack,
): string[] {
  return [...resolvePostImportCharacterTemplateIds(
    bundledPacks,
    storedPacks,
    userEditsPack,
  )].sort();
}

function registryIds(
  bundledPacks: readonly ContentPack[],
  storedPacks: readonly PostImportStoredPack[],
  userEditsPack?: ContentPack,
): string[] {
  const layers = [
    ...bundledPacks,
    ...storedPacks.filter(({ enabled }) => enabled).map(({ pack: layer }) => layer),
    ...(userEditsPack ? [userEditsPack] : []),
  ];
  return new ContentRegistry(layers).allCharacterTemplates.map(({ id }) => id).sort();
}

describe('resolvePostImportCharacterTemplateIds', () => {
  it('includes bundled and enabled imported IDs but ignores every disabled-pack effect', () => {
    const bundled = [pack('bundled', ['bundled-a', 'shared'])];
    const stored = [
      { pack: pack('enabled', ['enabled-a', 'shared']), enabled: true },
      {
        pack: pack('disabled', ['disabled-a'], ['bundled-a', 'enabled-a']),
        enabled: false,
      },
    ] satisfies PostImportStoredPack[];

    expect(resolvedIds(bundled, stored)).toEqual(['bundled-a', 'enabled-a', 'shared']);
    expect(resolvedIds(bundled, stored)).toEqual(registryIds(bundled, stored));
  });

  it('uses the exact post-import records after pack replacement and removal', () => {
    const bundled = [pack('bundled', ['bundled-a'])];
    const before = [
      { pack: pack('replace-me', ['old-from-replaced-pack']), enabled: true },
      { pack: pack('remove-me', ['from-removed-pack']), enabled: true },
    ] satisfies PostImportStoredPack[];
    const after = [
      { pack: pack('replace-me', ['new-from-replacement']), enabled: true },
    ] satisfies PostImportStoredPack[];

    expect(resolvedIds(bundled, before)).toEqual([
      'bundled-a',
      'from-removed-pack',
      'old-from-replaced-pack',
    ]);
    expect(resolvedIds(bundled, after)).toEqual(['bundled-a', 'new-from-replacement']);
    expect(resolvedIds(bundled, after)).toEqual(registryIds(bundled, after));
  });

  it('collapses bundled and imported overrides of the same character ID', () => {
    const bundled = [pack('bundled', ['shared', 'bundled-only'])];
    const stored = [
      { pack: pack('override', ['shared', 'imported-only']), enabled: true },
    ] satisfies PostImportStoredPack[];

    expect(resolvedIds(bundled, stored)).toEqual([
      'bundled-only',
      'imported-only',
      'shared',
    ]);
    expect(resolvedIds(bundled, stored)).toEqual(registryIds(bundled, stored));
  });

  it('applies tombstones after every layer, including later user-edit entries', () => {
    const bundled = [pack('bundled', ['bundled-a', 'shared'])];
    const stored = [
      { pack: pack('tombstones', [], ['shared']), enabled: true },
    ] satisfies PostImportStoredPack[];
    const edits = pack('user-edits', ['shared', 'user-only'], ['bundled-a']);

    expect(resolvedIds(bundled, stored, edits)).toEqual(['user-only']);
    expect(resolvedIds(bundled, stored, edits)).toEqual(registryIds(bundled, stored, edits));
  });

  it('restores an ID only after the user-edits re-add state clears its tombstone', () => {
    const bundled = [pack('bundled', ['bundled-a'])];
    const deletedEdits = pack('user-edits', [], ['bundled-a']);
    const reAddedEdits = pack('user-edits', ['bundled-a']);
    const contradictoryEdits = pack('user-edits', ['bundled-a'], ['bundled-a']);

    expect(resolvedIds(bundled, [], deletedEdits)).toEqual([]);
    expect(resolvedIds(bundled, [], reAddedEdits)).toEqual(['bundled-a']);
    expect(resolvedIds(bundled, [], contradictoryEdits)).toEqual([]);
    expect(resolvedIds(bundled, [], reAddedEdits)).toEqual(
      registryIds(bundled, [], reAddedEdits),
    );
  });
});
