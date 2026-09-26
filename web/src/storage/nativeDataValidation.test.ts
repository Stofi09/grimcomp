import { describe, expect, it } from 'vitest';
import { CHARACTER_TEMPLATES } from '../../../src/data/character';
import { countQuarantinedPacks, partitionStoredPacks } from '../../../src/content/storedPacks';
import { NATIVE_RECOVERY_RESET_INTENT_KEY } from '../../../src/storage/nativeRecoveryKeys';
import {
  decodeNativeStoredValueForExport,
  isPortableNativeDataKey,
  validateNativeSettingsImport,
  validateNativeStoredValue,
} from '../../../src/storage/nativeDataValidation';

function nativeCharacter(id: string): Record<string, unknown> {
  return {
    ...JSON.parse(JSON.stringify(CHARACTER_TEMPLATES.c1)) as Record<string, unknown>,
    id,
    name: 'Imported Native Character',
  };
}

describe('native persisted-data validation', () => {
  it('accepts every bundled native character shape', () => {
    for (const [templateId, template] of Object.entries(CHARACTER_TEMPLATES)) {
      const id = `custom-${templateId}`;
      expect(validateNativeStoredValue('gc.customChars', {
        [id]: { ...template, id },
      })).toEqual({ ok: true });
    }
  });

  it('accepts a complete native character and legacy fields the runtime explicitly defaults', () => {
    const current = nativeCharacter('c5');
    expect(validateNativeStoredValue('gc.customChars', { c5: current })).toEqual({ ok: true });

    const legacy = nativeCharacter('c6');
    delete legacy.careerRanks;
    delete legacy.conditions;
    expect(validateNativeStoredValue('gc.customChars', { c6: legacy })).toEqual({ ok: true });
    expect(validateNativeStoredValue('gc.c6.xp', {
      current: 10,
      spent: 5,
      log: [{ date: '2026.08.30', reason: 'Legacy entry', amount: 10 }],
    })).toEqual({ ok: true });
    expect(validateNativeStoredValue('gc.c6.talents.times', { Hardy: 0 })).toEqual({ ok: true });
  });

  it('passes through unknown forward-compatible gc keys', () => {
    expect(validateNativeStoredValue('gc.future.system.overlay', {
      schema: 7,
      nested: [null, true, { extension: 'kept' }],
    })).toEqual({ ok: true });
  });

  it.each([
    ['gc.activeCharId', { id: 'c1' }],
    ['gc.settings.xpRule', 'permissive'],
    ['gc.newchar.step', 4],
    ['gc.newchar.draft', { name: '', species: 'Human', inits: {} }],
    ['gc.c1.xp', { current: 10, spent: 0, log: {} }],
    ['gc.c1.vitals', { fate: 2, fortune: 2 }],
    ['gc.c1.conditions', { Fatigued: 'one' }],
    ['gc.c1.weapons', { name: 'Sword' }],
  ])('rejects the incompatible known shape for %s', (key, value) => {
    expect(validateNativeStoredValue(key, value)).toMatchObject({ ok: false });
  });

  it('rejects partial and mismatched custom characters', () => {
    expect(validateNativeStoredValue('gc.customChars', {
      c5: { id: 'c5', name: 'Partial' },
    })).toMatchObject({ ok: false });
    expect(validateNativeStoredValue('gc.customChars', {
      c5: nativeCharacter('different-id'),
    })).toMatchObject({ ok: false });
    expect(validateNativeStoredValue('gc.customChars', {
      'a.b': nativeCharacter('a.b'),
    })).toMatchObject({ ok: false });
    expect(validateNativeStoredValue('gc.activeCharId', 'a.b')).toMatchObject({ ok: false });
    expect(validateNativeStoredValue('gc.activeCharId', 'toString')).toMatchObject({ ok: false });
  });

  it('keeps stored content packs with unsafe nested race data out of the registry instead of blocking storage', () => {
    const baseRace = {
      id: 'race.test',
      name: 'Test',
      movement: 4,
      fate: 2,
      resilience: 1,
      extra: 3,
      charModifiers: { ws: 5 },
      skills: ['skill.test'],
      talents: ['talent.test'],
      description: '',
    };
    const pack = (race: Record<string, unknown>) => [{
      enabled: true,
      pack: {
        $schema: 'grimcomp.content.v1',
        id: 'pack.test',
        name: 'Test pack',
        version: '1.0.0',
        races: [race],
      },
    }];

    for (const unsafe of [
      pack({ ...baseRace, charModifiers: { ws: {} } }),
      pack({ ...baseRace, skills: [42] }),
    ]) {
      // Storage keeps the list openable; the content layer never loads the pack.
      expect(validateNativeStoredValue('gc.content.packs', unsafe)).toEqual({ ok: true });
      const partition = partitionStoredPacks(unsafe);
      expect(partition.active).toEqual([]);
      expect(partition.quarantined).toEqual([expect.objectContaining({ id: 'pack.test', quarantined: true })]);
    }
    expect(partitionStoredPacks(pack(baseRace)).active.map(loaded => loaded.id)).toEqual(['pack.test']);
  });

  it.each([
    ['a non-array list', { 'pack.test': { enabled: true } }],
    ['a non-boolean enabled flag', [{ enabled: 1, pack: { id: 'pack.test' } }]],
    ['a missing pack object', [{ enabled: true, pack: null }]],
    ['a non-string pack id', [{ enabled: true, pack: { id: 7 } }]],
    ['duplicate pack ids', [{ enabled: true, pack: { id: 'pack.test' } }, { enabled: false, pack: { id: 'pack.test' } }]],
  ])('rejects a stored pack-list envelope with %s', (_label, value) => {
    expect(validateNativeStoredValue('gc.content.packs', value)).toMatchObject({ ok: false });
  });

  it('classifies every destructive Settings-wipe category as portable data', () => {
    expect([
      'gc.customChars',
      'gc.content.packs',
      'gc.newchar.draft',
      'gc.settings.xpRule',
      'gc.activeCharId',
      'gc.c1.wounds',
      'gc.notes',
    ].every(isPortableNativeDataKey)).toBe(true);
  });

  it('preserves the native roster\'s historical custom-over-built-in precedence', () => {
    expect(validateNativeStoredValue('gc.customChars', {
      c1: nativeCharacter('c1'),
    })).toEqual({ ok: true });
  });
});

describe('native Settings import validation', () => {
  it('accepts native data plus unknown future keys as one import envelope', () => {
    const result = validateNativeSettingsImport({
      $schema: 'grimcomp.v1',
      scope: 'roster',
      'gc.activeCharId': 'c5',
      'gc.customChars': { c5: nativeCharacter('c5') },
      'gc.c5.xp': { current: 25, spent: 10, log: [] },
      'gc.future.overlay': { revision: 2, payload: ['kept'] },
    });

    expect(result).toMatchObject({ ok: true, keyCount: 4 });
  });

  it('restores a backup whose stored pack the current validator rejects, reporting it as quarantined', () => {
    const legacyPack = {
      $schema: 'grimcomp.content.v1', id: 'homebrew.legacy', name: 'Legacy homebrew', version: '0.9',
      prayers: [{
        id: 'prayer.legacy', name: 'Legacy Blessing', deity: 'Sigmar', range: 'Touch', target: '1',
        duration: '1 hour', description: 'Saved by an older build.', type: 'Blessing',
      }],
    };
    const packs = [{ enabled: true, pack: legacyPack }];
    const result = validateNativeSettingsImport({ $schema: 'grimcomp.v1', scope: 'roster', 'gc.content.packs': packs });

    expect(result).toMatchObject({ ok: true, keyCount: 1 });
    expect(countQuarantinedPacks(packs)).toBe(1);
    expect(countQuarantinedPacks(undefined)).toBe(0);
  });

  it('rejects valid JSON with a web-only draft shape before import can write anything', () => {
    const result = validateNativeSettingsImport({
      $schema: 'grimcomp.v1',
      'gc.newchar.draft': {
        name: 'Marta',
        species: 'Human',
        careerId: 'car.roadwarden',
        extraToFate: 0,
        speciesRandom: false,
        careerMode: 'choose',
        careerChoices: [],
        inits: {},
      },
    });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('gc.newchar.draft'),
    });
  });

  it('rejects an internal version marker and malformed native character payloads', () => {
    expect(validateNativeSettingsImport({
      $schema: 'grimcomp.v1',
      'gc.storageVersion': 1,
    })).toMatchObject({ ok: false, message: expect.stringContaining('internal storage key') });

    expect(validateNativeSettingsImport({
      $schema: 'grimcomp.v1',
      [NATIVE_RECOVERY_RESET_INTENT_KEY]: { kind: 'grimcomp.native.recovery-reset', version: 1 },
    })).toMatchObject({ ok: false, message: expect.stringContaining('internal storage key') });

    expect(validateNativeSettingsImport({
      $schema: 'grimcomp.v1',
      'gc.customChars': { c5: { id: 'c5', name: 'Partial' } },
    })).toMatchObject({ ok: false, message: expect.stringContaining('incompatible native data') });
  });

  it('rejects an active pointer missing from the post-import native roster', () => {
    expect(validateNativeSettingsImport({
      $schema: 'grimcomp.v1',
      'gc.activeCharId': 'missing-character',
    }, {
      availableCharacterIds: new Set(Object.keys(CHARACTER_TEMPLATES)),
    })).toMatchObject({
      ok: false,
      message: expect.stringContaining('does not exist in the post-import roster'),
    });

    expect(validateNativeSettingsImport({
      $schema: 'grimcomp.v1',
      'gc.activeCharId': 'c5',
      'gc.customChars': { c5: nativeCharacter('c5') },
    }, {
      availableCharacterIds: new Set(Object.keys(CHARACTER_TEMPLATES)),
    })).toMatchObject({ ok: true });
  });
});

describe('native normal-export decoding', () => {
  it('rejects corrupt raw JSON with the offending key', () => {
    expect(() => decodeNativeStoredValueForExport('gc.c1.xp', '{nope')).toThrow(/gc\.c1\.xp.*not valid JSON/u);
  });

  it('rejects a parseable incompatible known value instead of changing its meaning', () => {
    expect(() => decodeNativeStoredValueForExport('gc.c1.xp', JSON.stringify([]))).toThrow(/gc\.c1\.xp/u);
  });

  it('preserves an unknown forward-compatible value exactly as parsed', () => {
    expect(decodeNativeStoredValueForExport(
      'gc.future.overlay',
      JSON.stringify({ revision: 3, enabled: true }),
    )).toEqual({ revision: 3, enabled: true });
  });
});
