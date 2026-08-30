import { createStorageCoordinator, type RawAsyncKeyValue } from '@grimcomp/core';
import { describe, expect, it } from 'vitest';
import { StorageCore, type StorageBackend } from '@/hooks/storageCore';
import charactersPack from '../../public/content/core-characters.json';
import type { ContentPack } from './types';
import { changeStoredContentPacks, type StoredPack } from './useContentPacks';

function character(id: string) {
  return {
    ...(charactersPack.characters[0] as unknown as Record<string, unknown>),
    id,
    name: `Character ${id}`,
  };
}

function pack(id: string, characterIds: readonly string[]): ContentPack {
  return {
    $schema: 'grimcomp.content.v2',
    id,
    name: `Pack ${id}`,
    version: '1.0.0',
    characters: characterIds.map(character),
  } as unknown as ContentPack;
}

async function harness(initial: Readonly<Record<string, unknown>> = {}) {
  const store = new Map<string, string>(
    Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  const backend: StorageBackend = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: key => { store.delete(key); },
    keys: () => [...store.keys()],
  };
  const raw: RawAsyncKeyValue = {
    getItem: async key => backend.getItem(key),
    setItem: async (key, value) => { backend.setItem(key, value); },
    removeItem: async key => { backend.removeItem(key); },
  };
  const coordinator = createStorageCoordinator(raw);
  expect((await coordinator.recover()).ok).toBe(true);
  const core = new StorageCore(backend, coordinator);
  return {
    core,
    store,
  };
}

describe('changeStoredContentPacks roster invariants', () => {
  it('rejects enabling a template that collides with a custom character', async () => {
    const id = 'custom-collision';
    const { core, store } = await harness({
      'gc.customChars': { [id]: character(id) },
      'gc.activeCharId': id,
    });
    const result = await changeStoredContentPacks(
      [pack('bundled', ['c1'])],
      previous => [...previous, { enabled: true, pack: pack('collision-pack', [id]) }],
      work => core.transaction(work),
    ).completion;

    expect(result).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('collides with a built-in character') },
    });
    expect(store.get('gc.content.packs')).toBeUndefined();
  });

  it.each([
    ['disable', (current: readonly StoredPack[]) => current.map(stored => ({ ...stored, enabled: false }))],
    ['remove', (_current: readonly StoredPack[]) => []],
    ['replace', (current: readonly StoredPack[]) => current.map(stored => ({
      ...stored,
      pack: pack(stored.pack.id, ['replacement']),
    }))],
  ] as const)('rejects %s when it would orphan the active template', async (_label, update) => {
    const activeId = 'active-template';
    const current = [{ enabled: true, pack: pack('active-pack', [activeId]) }];
    const { core, store } = await harness({
      'gc.content.packs': current,
      'gc.activeCharId': activeId,
    });
    const result = await changeStoredContentPacks(
      [pack('bundled', ['c1'])],
      update,
      work => core.transaction(work),
    ).completion;

    expect(result).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('would remove active character') },
    });
    expect(JSON.parse(store.get('gc.content.packs') ?? 'null')).toEqual(current);
  });

  it('commits a safe content-pack mutation', async () => {
    const { core, store } = await harness();
    const safePack = pack('safe-pack', ['safe-template']);
    const bundled = pack('bundled', ['c1']);
    const result = await changeStoredContentPacks(
      [bundled],
      previous => [...previous, { enabled: true, pack: safePack }],
      work => core.transaction(work),
    ).completion;

    expect(result).toMatchObject({ ok: true, outcome: 'committed' });
    expect(JSON.parse(store.get('gc.content.packs') ?? 'null')).toEqual([
      { enabled: true, pack: safePack },
    ]);
  });

  it('rejects deleting the implicit fallback character on a fresh store', async () => {
    const { core, store } = await harness();
    const bundled = pack('bundled', ['c1', 'c2']);
    const tombstone: ContentPack = {
      $schema: 'grimcomp.content.v2',
      id: 'delete-fallback',
      name: 'Delete fallback',
      version: '1.0.0',
      deletions: { characters: ['c1'] },
    };
    const result = await changeStoredContentPacks(
      [bundled],
      previous => [...previous, { enabled: true, pack: tombstone }],
      work => core.transaction(work),
    ).completion;

    expect(result).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('must preserve fallback character "c1"') },
    });
    expect(store.get('gc.content.packs')).toBeUndefined();
  });

  it('rejects a fallback tombstone even while a custom character is active', async () => {
    const activeId = 'active-custom';
    const { core, store } = await harness({
      'gc.customChars': { [activeId]: character(activeId) },
      'gc.activeCharId': activeId,
    });
    const bundled = pack('bundled', ['c1']);
    const tombstone: ContentPack = {
      $schema: 'grimcomp.content.v2',
      id: 'delete-fallback',
      name: 'Delete fallback',
      version: '1.0.0',
      deletions: { characters: ['c1'] },
    };

    const result = await changeStoredContentPacks(
      [bundled],
      previous => [...previous, { enabled: true, pack: tombstone }],
      work => core.transaction(work),
    ).completion;

    expect(result).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('must preserve fallback character "c1"') },
    });
    expect(store.get('gc.content.packs')).toBeUndefined();
  });
});
