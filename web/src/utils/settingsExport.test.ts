import {
  MAX_SETTINGS_BACKUP_FILE_BYTES,
  STORAGE_TRANSACTION_JOURNAL_KEY,
  createStorageCoordinator,
  type RawAsyncKeyValue,
  type StorageTransactionCoordinator,
} from '@grimcomp/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { StorageCore, type StorageBackend } from '@/hooks/storageCore';
import { STORAGE_VERSION, STORAGE_VERSION_KEY } from '@/storage/migrations';
import {
  STORAGE_RECOVERY_RESET_INTENT_KEY,
  STORAGE_RECOVERY_RESET_INTENT_RAW,
} from '@/storage/storageSchema';
import charactersPack from '../../public/content/core-characters.json';
import {
  applySettingsImport,
  buildSettingsExport,
  grimCompanionStorageKeys,
  wipeGrimCompanionStorage,
} from './settingsExport';
import { MAX_STORED_CONTENT_PACKS } from '@/content/storedContentPacks';
import { validateNativeSettingsImport } from '../../../src/storage/nativeDataValidation';

interface FaultBackend extends StorageBackend {
  readonly store: Map<string, string>;
  readonly journalWrites: string[];
  failNextSetFor: string | null;
  failNextRemoveFor: string | null;
}

function makeBackend(): FaultBackend {
  const store = new Map<string, string>();
  const backend: FaultBackend = {
    store,
    journalWrites: [],
    failNextSetFor: null,
    failNextRemoveFor: null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      if (backend.failNextSetFor === key) {
        backend.failNextSetFor = null;
        throw new Error(`injected set fault for ${key}`);
      }
      store.set(key, value);
      if (key === STORAGE_TRANSACTION_JOURNAL_KEY) backend.journalWrites.push(value);
    },
    removeItem: (key) => {
      if (backend.failNextRemoveFor === key) {
        backend.failNextRemoveFor = null;
        throw new Error(`injected remove fault for ${key}`);
      }
      store.delete(key);
    },
    keys: () => [...store.keys()],
  };
  return backend;
}

function rawStore(backend: StorageBackend): RawAsyncKeyValue {
  return {
    getItem: async (key) => backend.getItem(key),
    setItem: async (key, value) => { backend.setItem(key, value); },
    removeItem: async (key) => { backend.removeItem(key); },
  };
}

let transactionId = 0;

const validCustomCharacter = (
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...(charactersPack.characters[0] as unknown as Record<string, unknown>),
  id,
  name: `Custom ${id}`,
  ...overrides,
});

const packWithCharacter = (character: Record<string, unknown>) => ({
  $schema: 'grimcomp.content.v2',
  id: 'characters.from-import',
  name: 'Imported character templates',
  version: '1',
  characters: [character],
});

const tombstonePack = (characterId: string) => ({
  $schema: 'grimcomp.content.v2',
  id: 'user-edits',
  name: 'Your edits',
  version: '1',
  deletions: { characters: [characterId] },
});

async function makeCore(backend: StorageBackend): Promise<{
  core: StorageCore;
  coordinator: StorageTransactionCoordinator;
}> {
  const coordinator = createStorageCoordinator(rawStore(backend), {
    createTransactionId: () => `settings-test-${++transactionId}`,
  });
  const recovered = await coordinator.recover();
  expect(recovered.ok).toBe(true);
  return { core: new StorageCore(backend, coordinator), coordinator };
}

describe('settings export snapshot', () => {
  let backend: FaultBackend;
  let core: StorageCore;
  beforeEach(async () => {
    backend = makeBackend();
    backend.setItem(STORAGE_VERSION_KEY, JSON.stringify(STORAGE_VERSION));
    ({ core } = await makeCore(backend));
  });

  it('rejects an export whose locked storage schema marker is absent or incompatible', async () => {
    backend.removeItem(STORAGE_VERSION_KEY);
    await expect(buildSettingsExport('roster', 'c1', 'Test', { backend, core }))
      .rejects.toThrow(/storage schema.*does not match/i);

    backend.setItem(STORAGE_VERSION_KEY, JSON.stringify(STORAGE_VERSION + 1));
    await expect(buildSettingsExport('roster', 'c1', 'Test', { backend, core }))
      .rejects.toThrow(/storage schema.*does not match/i);
  });

  it('rejects a roster export when exact bundled content context is omitted', async () => {
    await expect(buildSettingsExport('roster', 'c1', 'Test', { backend, core }))
      .rejects.toThrow(/Exact bundled content context/);
  });

  it('excludes reserved internal keys and keeps character exports scoped', async () => {
    const c9 = validCustomCharacter('c9', { name: 'Marta Keller' });
    backend.setItem(STORAGE_TRANSACTION_JOURNAL_KEY, '{}');
    backend.setItem(STORAGE_VERSION_KEY, '1');
    backend.setItem(STORAGE_RECOVERY_RESET_INTENT_KEY, '{"internal":true}');
    backend.setItem('gc.activeCharId', JSON.stringify('c9'));
    backend.setItem('gc.c9.wounds', '7');
    backend.setItem('gc.c2.wounds', '3');
    backend.setItem('gc.notes', JSON.stringify([{ title: 'secret' }]));
    backend.setItem('gc.customChars', JSON.stringify({ c9 }));

    expect(grimCompanionStorageKeys(backend)).not.toContain(STORAGE_VERSION_KEY);
    expect(grimCompanionStorageKeys(backend)).not.toContain(STORAGE_TRANSACTION_JOURNAL_KEY);
    expect(grimCompanionStorageKeys(backend)).not.toContain(STORAGE_RECOVERY_RESET_INTENT_KEY);
    backend.removeItem(STORAGE_TRANSACTION_JOURNAL_KEY);
    let lockCalls = 0;
    const parsed = JSON.parse(await buildSettingsExport(
      'character',
      'c9',
      'Marta Keller',
      {
        backend,
        core,
        bundledContentPacks: [],
        withExclusiveLock: async (work) => {
          lockCalls += 1;
          return work();
        },
      },
    )) as Record<string, unknown>;

    expect(parsed['gc.c9.wounds']).toBe(7);
    expect(parsed['gc.c2.wounds']).toBeUndefined();
    expect(parsed['gc.notes']).toBeUndefined();
    expect(parsed[STORAGE_VERSION_KEY]).toBeUndefined();
    expect(parsed[STORAGE_TRANSACTION_JOURNAL_KEY]).toBeUndefined();
    expect(parsed[STORAGE_RECOVERY_RESET_INTENT_KEY]).toBeUndefined();
    expect(parsed['gc.customChars']).toEqual({ c9 });
    expect(lockCalls).toBe(1);
  });

  it('refuses to report a snapshot while a write is pending/dirty', async () => {
    const pending = core.update('gc.x', 0, 1);
    await expect(buildSettingsExport('roster', 'c1', 'Test', { backend, core }))
      .rejects.toThrow(/busy, dirty, or blocked/);
    await pending.completion;
    await expect(buildSettingsExport('roster', 'c1', 'Test', {
      backend,
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    }))
      .resolves.toContain('grimcomp.v1');
  });

  it('rejects corrupt raw JSON and identifies the offending export key', async () => {
    backend.setItem('gc.good', JSON.stringify({ still: 'valid' }));
    backend.setItem('gc.broken', '{ definitely not JSON');

    await expect(buildSettingsExport('roster', 'c1', 'Test', { backend, core }))
      .rejects.toThrow(/gc\.broken.*not valid JSON/);
  });

  it.each(['character', 'roster'] as const)(
    'validates full custom-character records for %s exports',
    async (scope) => {
      backend.setItem('gc.activeCharId', JSON.stringify('custom-1'));
      backend.setItem('gc.customChars', JSON.stringify({
        'custom-1': validCustomCharacter('custom-1', { weapons: {} }),
      }));

      await expect(buildSettingsExport(scope, 'custom-1', 'Custom', {
        backend,
        core,
        bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
      }))
        .rejects.toThrow(/weapons.*array/);
    },
  );

  it('rejects character-map id mismatches and built-in collisions on export', async () => {
    backend.setItem('gc.customChars', JSON.stringify({ custom: validCustomCharacter('other') }));
    await expect(buildSettingsExport('roster', 'custom', 'Custom', {
      backend,
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    }))
      .rejects.toThrow(/must declare id "custom"/);

    backend.setItem('gc.customChars', JSON.stringify({ c1: validCustomCharacter('c1') }));
    await expect(buildSettingsExport('roster', 'c1', 'Built in', {
      backend,
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    })).rejects.toThrow(/collides with a built-in character/);
    backend.setItem('gc.activeCharId', JSON.stringify('c1'));
    await expect(buildSettingsExport('character', 'c1', 'Built in', {
      backend,
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    })).rejects.toThrow(/collides with a built-in character/);
  });

  it('rejects a character export when the locked active id no longer matches', async () => {
    backend.setItem('gc.activeCharId', JSON.stringify('c2'));
    backend.setItem('gc.c1.wounds', JSON.stringify(5));

    await expect(buildSettingsExport('character', 'c1', 'Stale selection', {
      backend,
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    }))
      .rejects.toThrow(/active character changed.*"c2"/i);
  });

  it('treats an absent locked active pointer as the fallback during character export', async () => {
    await expect(buildSettingsExport('character', 'c2', 'Stale selection', {
      backend,
      core,
      builtInCharacterIds: new Set(['c1', 'c2']),
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    })).rejects.toThrow(/active character changed.*"c1"/i);
  });

  it('rejects a character export whose locked active id has no template or custom record', async () => {
    backend.setItem('gc.activeCharId', JSON.stringify('orphan'));
    backend.setItem('gc.orphan.wounds', JSON.stringify(5));

    await expect(buildSettingsExport('character', 'orphan', 'Orphan', {
      backend,
      core,
      builtInCharacterIds: new Set(['c1']),
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    })).rejects.toThrow(/does not exist in the locked export roster/i);
  });

  it('rejects a roster export whose active pointer is absent from the exact roster', async () => {
    backend.setItem('gc.activeCharId', JSON.stringify('orphan'));
    const fallback = packWithCharacter(validCustomCharacter('c1'));

    await expect(buildSettingsExport('roster', 'orphan', 'Orphan', {
      backend,
      core,
      bundledContentPacks: [fallback],
    })).rejects.toThrow(/does not exist in the locked export roster/i);
  });

  it('treats the implicit fallback as active when validating a roster export', async () => {
    const bundled = packWithCharacter(validCustomCharacter('c1'));
    backend.setItem('gc.content.userEdits', JSON.stringify(tombstonePack('c1')));

    await expect(buildSettingsExport('roster', 'c1', 'Fallback', {
      backend,
      core,
      bundledContentPacks: [bundled],
    })).rejects.toThrow(/required fallback character "c1"/i);
  });

  it('requires a full roster export for imported-only or overridden character templates', async () => {
    const importedId = 'imported-template';
    backend.setItem('gc.activeCharId', JSON.stringify(importedId));
    backend.setItem('gc.content.packs', JSON.stringify([{
      enabled: true,
      pack: packWithCharacter(validCustomCharacter(importedId)),
    }]));
    await expect(buildSettingsExport('character', importedId, 'Imported', {
      backend,
      core,
      builtInCharacterIds: new Set([importedId]),
      bundledContentPacks: [],
    })).rejects.toThrow(/use a full roster export/i);

    const bundledId = 'bundled-template';
    const bundled = packWithCharacter(validCustomCharacter(bundledId));
    backend.setItem('gc.activeCharId', JSON.stringify(bundledId));
    backend.setItem('gc.content.packs', JSON.stringify([{
      enabled: true,
      pack: packWithCharacter(validCustomCharacter(bundledId, { name: 'Override' })),
    }]));
    await expect(buildSettingsExport('character', bundledId, 'Override', {
      backend,
      core,
      builtInCharacterIds: new Set([bundledId]),
      bundledContentPacks: [bundled],
    })).rejects.toThrow(/use a full roster export/i);
  });

  it('rejects dangerous known shapes on export while keeping unknown dynamic keys portable', async () => {
    backend.setItem('gc.content.packs', JSON.stringify({ not: 'an array' }));
    const exactContext = {
      backend,
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    };
    await expect(buildSettingsExport('roster', 'c1', 'Test', exactContext))
      .rejects.toThrow(/gc\.content\.packs.*array/);

    backend.removeItem('gc.content.packs');
    backend.setItem('gc.c1.weapons', JSON.stringify({ not: 'an array' }));
    await expect(buildSettingsExport('roster', 'c1', 'Test', exactContext))
      .rejects.toThrow(/gc\.c1\.weapons.*array/);

    backend.removeItem('gc.c1.weapons');
    backend.setItem('gc.future.extension', JSON.stringify({ version: 7, payload: ['kept'] }));
    const parsed = JSON.parse(await buildSettingsExport(
      'roster',
      'c1',
      'Test',
      exactContext,
    )) as Record<string, unknown>;
    expect(parsed['gc.future.extension']).toEqual({ version: 7, payload: ['kept'] });
  });

  it('omits web creation progress so a roster backup passes native validation', async () => {
    backend.setItem('gc.activeCharId', JSON.stringify('c1'));
    backend.setItem('gc.c1.wounds', JSON.stringify(7));
    backend.setItem('gc.newchar.step', JSON.stringify(7));
    backend.setItem('gc.newchar.draft', JSON.stringify({
      name: 'Marta',
      species: 'Human',
      careerId: 'car.roadwarden',
      extraToFate: 0,
      speciesRandom: false,
      careerMode: 'choose',
      careerChoices: [],
      inits: {},
    }));

    expect(grimCompanionStorageKeys(backend)).not.toContain('gc.newchar.step');
    expect(grimCompanionStorageKeys(backend)).not.toContain('gc.newchar.draft');
    const parsed = JSON.parse(await buildSettingsExport('roster', 'c1', 'Elsa', {
      backend,
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    })) as Record<string, unknown>;

    expect(parsed).not.toHaveProperty('gc.newchar.step');
    expect(parsed).not.toHaveProperty('gc.newchar.draft');
    expect(validateNativeSettingsImport(parsed, {
      availableCharacterIds: new Set(['c1']),
    })).toMatchObject({ ok: true, keyCount: 2 });
  });

  it('refuses to create a web backup over the shared import-file cap', async () => {
    backend.setItem('gc.future.payload', JSON.stringify('a'.repeat(4 * 1024 * 1024)));

    await expect(buildSettingsExport('roster', 'c1', 'Elsa', {
      backend,
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    })).rejects.toThrow(/larger than the 960 KiB import limit/iu);
  });
});

describe('journaled settings import and reset', () => {
  let backend: FaultBackend;
  let core: StorageCore;
  beforeEach(async () => {
    backend = makeBackend();
    ({ core } = await makeCore(backend));
  });

  it('commits an escape-heavy portable backup while preserving journal headroom', async () => {
    const repetitions = Math.floor(MAX_SETTINGS_BACKUP_FILE_BYTES / 5);
    const incoming = '"\\'.repeat(repetitions);
    const previous = '\\"'.repeat(repetitions);
    const sourceBackend = makeBackend();
    sourceBackend.setItem(STORAGE_VERSION_KEY, JSON.stringify(STORAGE_VERSION));
    sourceBackend.setItem('gc.future.payload', JSON.stringify(incoming));
    const { core: sourceCore } = await makeCore(sourceBackend);
    const exported = await buildSettingsExport('roster', 'c1', 'Elsa', {
      backend: sourceBackend,
      core: sourceCore,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    });
    backend.setItem('gc.future.payload', JSON.stringify(previous));

    expect(exported.length).toBeGreaterThan(MAX_SETTINGS_BACKUP_FILE_BYTES * 0.75);
    const result = await applySettingsImport(
      JSON.parse(exported) as Record<string, unknown>,
      { core },
    ).completion;

    expect(result).toMatchObject({ ok: true, outcome: 'committed' });
    expect(backend.journalWrites).toHaveLength(1);
    expect(backend.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
    expect(backend.getItem('gc.future.payload')).toBe(JSON.stringify(incoming));
  });

  it('merges custom characters', async () => {
    const custom1 = validCustomCharacter('custom-1');
    const custom2 = validCustomCharacter('custom-2');
    backend.setItem('gc.customChars', JSON.stringify({ 'custom-1': custom1 }));
    const ticket = applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.customChars': { 'custom-2': custom2 },
      'gc.activeCharId': 'custom-2',
    }, { core, builtInCharacterIds: new Set(['c1']) });

    await expect(ticket.completion).resolves.toMatchObject({ ok: true, outcome: 'committed' });
    expect(ticket.value.requested).toBe(2);
    expect(JSON.parse(backend.getItem('gc.customChars') ?? '{}')).toEqual({
      'custom-1': custom1,
      'custom-2': custom2,
    });
    expect(backend.getItem('gc.activeCharId')).toBe('"custom-2"');
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBeNull();
    expect(backend.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
  });

  it('rejects an active pointer missing from the post-import roster', async () => {
    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.activeCharId': 'missing-character',
    }, {
      core,
      builtInCharacterIds: new Set(['c1']),
    }).completion;

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'transaction_failed',
        cause: expect.stringContaining('does not exist in the post-import roster'),
      },
    });
    expect(backend.getItem('gc.activeCharId')).toBeNull();
  });

  it('accepts active pointers to a current template or an existing custom character', async () => {
    const custom = validCustomCharacter('custom-1');
    backend.setItem('gc.customChars', JSON.stringify({ 'custom-1': custom }));

    const customResult = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.activeCharId': 'custom-1',
    }, { core, builtInCharacterIds: new Set(['c1']) }).completion;
    expect(customResult).toMatchObject({ ok: true });

    const templateResult = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.activeCharId': 'c1',
    }, { core, builtInCharacterIds: new Set(['c1']) }).completion;
    expect(templateResult).toMatchObject({ ok: true });
    expect(backend.getItem('gc.activeCharId')).toBe('"c1"');
  });

  it('rejects an active pointer supplied only by a disabled post-import pack', async () => {
    const disabledId = 'disabled-template';
    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.content.packs': [{
        enabled: false,
        pack: packWithCharacter(validCustomCharacter(disabledId)),
      }],
      'gc.activeCharId': disabledId,
    }, {
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    }).completion;

    expect(result).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('does not exist in the post-import roster') },
    });
    expect(backend.getItem('gc.content.packs')).toBeNull();
    expect(backend.getItem('gc.activeCharId')).toBeNull();
  });

  it('rejects more stored content packs than runtime can load', async () => {
    const minimalPack = {
      $schema: 'grimcomp.content.v2',
      id: 'minimal',
      name: 'Minimal',
      version: '1.0.0',
    };
    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.content.packs': Array.from(
        { length: MAX_STORED_CONTENT_PACKS + 1 },
        () => ({ enabled: false, pack: minimalPack }),
      ),
    }, { core, bundledContentPacks: [] }).completion;

    expect(result).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining(`at most ${MAX_STORED_CONTENT_PACKS} packs`) },
    });
    expect(backend.getItem('gc.content.packs')).toBeNull();
  });

  it('rejects replacing content packs when the stored active pointer would become orphaned', async () => {
    const oldId = 'old-template';
    backend.setItem('gc.content.packs', JSON.stringify([{
      enabled: true,
      pack: packWithCharacter(validCustomCharacter(oldId)),
    }]));
    backend.setItem('gc.activeCharId', JSON.stringify(oldId));

    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.content.packs': [],
    }, {
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    }).completion;

    expect(result).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('does not exist in the post-import roster') },
    });
    expect(JSON.parse(backend.getItem('gc.content.packs') ?? 'null')).toHaveLength(1);
    expect(backend.getItem('gc.activeCharId')).toBe(JSON.stringify(oldId));
  });

  it('rejects a user-edit tombstone that would delete the active bundled template', async () => {
    const activeId = 'bundled-template';
    const bundled = packWithCharacter(validCustomCharacter(activeId));
    const fallback = packWithCharacter(validCustomCharacter('c1'));
    backend.setItem('gc.activeCharId', JSON.stringify(activeId));

    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.content.userEdits': tombstonePack(activeId),
    }, { core, bundledContentPacks: [fallback, bundled] }).completion;

    expect(result).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('does not exist in the post-import roster') },
    });
    expect(backend.getItem('gc.content.userEdits')).toBeNull();
    expect(backend.getItem('gc.activeCharId')).toBe(JSON.stringify(activeId));
  });

  it('rejects deleting the implicit fallback character on a fresh store', async () => {
    const bundled = packWithCharacter(validCustomCharacter('c1'));

    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.content.userEdits': tombstonePack('c1'),
    }, { core, bundledContentPacks: [bundled] }).completion;

    expect(result).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('must preserve fallback character') },
    });
    expect(backend.getItem('gc.content.userEdits')).toBeNull();
    expect(backend.getItem('gc.activeCharId')).toBeNull();
  });

  it('rejects a fallback tombstone while a custom character is active', async () => {
    const activeId = 'active-custom';
    backend.setItem('gc.activeCharId', JSON.stringify(activeId));
    backend.setItem('gc.customChars', JSON.stringify({
      [activeId]: validCustomCharacter(activeId),
    }));
    const fallback = packWithCharacter(validCustomCharacter('c1'));

    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.content.userEdits': tombstonePack('c1'),
    }, { core, bundledContentPacks: [fallback] }).completion;

    expect(result).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('must preserve fallback character') },
    });
    expect(backend.getItem('gc.content.userEdits')).toBeNull();
    expect(backend.getItem('gc.activeCharId')).toBe(JSON.stringify(activeId));
  });

  it('uses runtime fallback preservation when checking custom imports against legacy layers', async () => {
    backend.setItem('gc.content.userEdits', JSON.stringify(tombstonePack('c1')));
    const fallback = packWithCharacter(validCustomCharacter('c1'));

    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.customChars': { c1: validCustomCharacter('c1') },
    }, { core, bundledContentPacks: [fallback] }).completion;

    expect(result).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('collides with a built-in character') },
    });
    expect(backend.getItem('gc.customChars')).toBeNull();
  });

  it('accepts an active pointer resolved from the exact bundled layers', async () => {
    const activeId = 'bundled-template';
    const bundled = packWithCharacter(validCustomCharacter(activeId));
    const fallback = packWithCharacter(validCustomCharacter('c1'));

    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.activeCharId': activeId,
    }, { core, bundledContentPacks: [fallback, bundled] }).completion;

    expect(result).toMatchObject({ ok: true, outcome: 'committed' });
    expect(backend.getItem('gc.activeCharId')).toBe(JSON.stringify(activeId));
  });

  it.each([
    STORAGE_VERSION_KEY,
    STORAGE_TRANSACTION_JOURNAL_KEY,
    STORAGE_RECOVERY_RESET_INTENT_KEY,
  ])(
    'rejects reserved internal import key %s instead of silently ignoring it',
    async (reservedKey) => {
      const result = await applySettingsImport({
        $schema: 'grimcomp.v1',
        'gc.safe': 1,
        [reservedKey]: 999,
      }, { core }).completion;
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'transaction_failed', cause: expect.stringContaining('reserved internal storage key') },
      });
      expect(backend.getItem('gc.safe')).toBeNull();
      expect(backend.getItem(reservedKey)).toBeNull();
    },
  );

  it('rejects a schema-only import with no app data keys', async () => {
    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      scope: 'roster',
      exportedAt: new Date(0).toISOString(),
    }, {
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    }).completion;
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'transaction_failed', cause: expect.stringContaining('no importable') },
    });
  });

  it('rolls every imported key back on a write fault', async () => {
    backend.setItem('gc.a', '"old-a"');
    backend.setItem('gc.b', '"old-b"');
    backend.failNextSetFor = 'gc.b';

    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.a': 'new-a',
      'gc.b': 'new-b',
    }, {
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    }).completion;
    expect(result).toMatchObject({ ok: false, outcome: 'rolled-back' });
    expect(backend.getItem('gc.a')).toBe('"old-a"');
    expect(backend.getItem('gc.b')).toBe('"old-b"');
    expect(backend.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
  });

  it('validates every import key/value before staging any write', async () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const badValue = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.ok': 1,
      'gc.circular': circular,
    }, { core }).completion;
    expect(badValue).toMatchObject({ ok: false, error: { code: 'transaction_failed' } });
    expect(backend.getItem('gc.ok')).toBeNull();

    const badKey = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.ok': 1,
      'gc.bad\n': 2,
    }, { core }).completion;
    expect(badKey).toMatchObject({ ok: false, error: { code: 'transaction_failed' } });
    expect(backend.getItem('gc.ok')).toBeNull();
  });

  it('rolls a multi-key reset back on a remove fault', async () => {
    backend.setItem('gc.a', '1');
    backend.setItem('gc.b', '2');
    backend.failNextRemoveFor = 'gc.b';

    const result = await wipeGrimCompanionStorage(core).completion;
    expect(result).toMatchObject({ ok: false, outcome: 'rolled-back' });
    expect(backend.getItem('gc.a')).toBe('1');
    expect(backend.getItem('gc.b')).toBe('2');
  });

  it('preserves the storage-format version while durably wiping user data', async () => {
    backend.setItem(STORAGE_VERSION_KEY, '7');
    backend.setItem(STORAGE_RECOVERY_RESET_INTENT_KEY, STORAGE_RECOVERY_RESET_INTENT_RAW);
    backend.setItem('gc.activeCharId', JSON.stringify('c2'));
    backend.setItem('gc.c2.wounds', JSON.stringify(3));

    const ticket = wipeGrimCompanionStorage(core);
    const result = await ticket.completion;
    expect(result).toMatchObject({ ok: true, outcome: 'committed', metadata: 2 });
    expect(backend.getItem(STORAGE_VERSION_KEY)).toBe('7');
    expect(backend.getItem(STORAGE_RECOVERY_RESET_INTENT_KEY)).toBe(STORAGE_RECOVERY_RESET_INTENT_RAW);
    expect(backend.getItem('gc.activeCharId')).toBeNull();
    expect(backend.getItem('gc.c2.wounds')).toBeNull();
    expect(backend.getItem(STORAGE_TRANSACTION_JOURNAL_KEY)).toBeNull();
  });

  it('requires the schema at the utility boundary before writing', async () => {
    const missing = await applySettingsImport({ 'gc.x': 1 }, { core }).completion;
    expect(missing).toMatchObject({ ok: false, error: { code: 'transaction_failed' } });
    const wrong = await applySettingsImport({ $schema: 'grimcomp.v2', 'gc.x': 1 }, { core }).completion;
    expect(wrong).toMatchObject({ ok: false, error: { code: 'transaction_failed' } });
    expect(backend.getItem('gc.x')).toBeNull();
  });

  it.each(['__proto__', 'prototype', 'constructor'])('rejects forbidden custom character id %s', async (id) => {
    const imported = JSON.parse(`{"${id}":{"id":"${id}"}}`) as Record<string, unknown>;
    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.customChars': imported,
    }, { core }).completion;
    expect(result).toMatchObject({ ok: false, error: { code: 'transaction_failed' } });
    expect(backend.getItem('gc.customChars')).toBeNull();
  });

  it('rejects character ids containing the per-character storage delimiter', async () => {
    const dottedId = 'a.b';
    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.customChars': {
        [dottedId]: validCustomCharacter(dottedId),
      },
      'gc.activeCharId': dottedId,
    }, { core }).completion;

    expect(result).toMatchObject({ ok: false, error: { code: 'transaction_failed' } });
    expect(backend.getItem('gc.customChars')).toBeNull();
    expect(backend.getItem('gc.activeCharId')).toBeNull();
  });

  it('rejects malformed custom characters, id mismatches, and built-in collisions on import', async () => {
    const malformed = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.customChars': {
        custom: validCustomCharacter('custom', { characteristics: 'not-an-array' }),
      },
    }, { core, builtInCharacterIds: new Set(['c1']) }).completion;
    expect(malformed).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('characteristics') },
    });

    const mismatched = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.customChars': { custom: validCustomCharacter('other') },
    }, { core, builtInCharacterIds: new Set(['c1']) }).completion;
    expect(mismatched).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('must declare id "custom"') },
    });

    const collision = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.customChars': { c1: validCustomCharacter('c1') },
    }, { core, builtInCharacterIds: new Set(['c1']) }).completion;
    expect(collision).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('collides with a built-in character') },
    });
    expect(backend.getItem('gc.customChars')).toBeNull();
  });

  it('rejects custom ids that collide with character templates in the same imported content', async () => {
    const shared = validCustomCharacter('shared-id');
    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.content.packs': [{ enabled: true, pack: packWithCharacter(shared) }],
      'gc.customChars': { 'shared-id': shared },
    }, {
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    }).completion;

    expect(result).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('collides with a built-in character') },
    });
    expect(backend.getItem('gc.content.packs')).toBeNull();
    expect(backend.getItem('gc.customChars')).toBeNull();
  });

  it('rejects imported content that would collide with an existing custom character', async () => {
    const shared = validCustomCharacter('shared-id');
    backend.setItem('gc.customChars', JSON.stringify({ 'shared-id': shared }));

    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.content.packs': [{ enabled: true, pack: packWithCharacter(shared) }],
    }, {
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    }).completion;

    expect(result).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('collides with a built-in character') },
    });
    expect(backend.getItem('gc.content.packs')).toBeNull();
    expect(JSON.parse(backend.getItem('gc.customChars') ?? '{}')).toEqual({ 'shared-id': shared });
  });

  it('rejects a valid content-layer import when exact bundled context is omitted', async () => {
    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.content.packs': [{
        enabled: true,
        pack: packWithCharacter(validCustomCharacter('imported-template')),
      }],
    }, { core }).completion;

    expect(result).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('Exact bundled content') },
    });
    expect(backend.getItem('gc.content.packs')).toBeNull();
  });

  it('rejects dangerous known shapes before staging any imported key', async () => {
    const badPacks = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.safe': 1,
      'gc.content.packs': { not: 'an array' },
    }, {
      core,
      bundledContentPacks: [packWithCharacter(validCustomCharacter('c1'))],
    }).completion;
    expect(badPacks).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('gc.content.packs') },
    });
    expect(backend.getItem('gc.safe')).toBeNull();

    const badOverlay = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.safe': 1,
      'gc.c1.weapons': { not: 'an array' },
    }, { core }).completion;
    expect(badOverlay).toMatchObject({
      ok: false,
      error: { cause: expect.stringContaining('gc.c1.weapons') },
    });
    expect(backend.getItem('gc.safe')).toBeNull();
  });

  it('keeps unknown dynamic gc keys forward-compatible after generic safety checks', async () => {
    const value = { version: 7, payload: ['kept'] };
    const ticket = applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.future.extension': value,
    }, { core });

    await expect(ticket.completion).resolves.toMatchObject({ ok: true, outcome: 'committed' });
    expect(JSON.parse(backend.getItem('gc.future.extension') ?? 'null')).toEqual(value);
  });

  it('repairs a corrupt included key by raw replacement without clearing unrelated dirtiness', async () => {
    backend.setItem('gc.repair', '{bad');
    backend.setItem('gc.stillBad', '{bad');
    expect(core.read('gc.repair', null)).toBeNull();
    expect(core.read('gc.stillBad', null)).toBeNull();

    const result = await applySettingsImport({
      $schema: 'grimcomp.v1',
      'gc.repair': { repaired: true },
    }, { core }).completion;
    expect(result).toMatchObject({ ok: true, outcome: 'committed' });
    expect(JSON.parse(backend.getItem('gc.repair') ?? 'null')).toEqual({ repaired: true });
    expect(core.getStatus()).toMatchObject({
      dirty: true,
      lastError: { key: 'gc.stillBad' },
    });
  });
});
