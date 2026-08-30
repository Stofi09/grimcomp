import { describe, expect, it } from 'vitest';
import { MAX_SETTINGS_BACKUP_FILE_BYTES } from '@grimcomp/core';
import { serializeNativeSettingsExportSnapshot } from '../../../src/storage/settingsData';
import { nativeImportTextSizeError } from '../../../src/storage/nativeImportLimits';
import { validatePortableStorageValue } from '../utils/settingsDataValidation';

const EXPORTED_AT = '2026-08-30T12:00:00.000Z';

describe('native Settings export snapshots', () => {
  it('rejects a character export when the locked active id changed', () => {
    const snapshot = new Map([
      ['gc.activeCharId', JSON.stringify('c2')],
      ['gc.c1.wounds', JSON.stringify(5)],
    ]);

    expect(() => serializeNativeSettingsExportSnapshot(
      'character',
      'c1',
      'Stale selection',
      snapshot,
      EXPORTED_AT,
    )).toThrow(/active character changed.*"c2"/iu);
  });

  it('makes a character export self-contained when no active pointer is persisted', () => {
    const json = serializeNativeSettingsExportSnapshot(
      'character',
      'c1',
      'Elsa',
      new Map([['gc.c1.wounds', JSON.stringify(7)]]),
      EXPORTED_AT,
    );

    expect(JSON.parse(json)).toMatchObject({
      $schema: 'grimcomp.v1',
      exportedAt: EXPORTED_AT,
      scope: 'character',
      character: 'Elsa',
      'gc.activeCharId': 'c1',
      'gc.c1.wounds': 7,
    });
  });

  it('does not synthesize an active pointer for roster exports', () => {
    const json = serializeNativeSettingsExportSnapshot(
      'roster',
      'c1',
      'Elsa',
      new Map([['gc.c1.wounds', JSON.stringify(7)]]),
      EXPORTED_AT,
    );

    expect(JSON.parse(json)).not.toHaveProperty('gc.activeCharId');
  });

  it('rejects an orphan character export that its own importer could not open', () => {
    expect(() => serializeNativeSettingsExportSnapshot(
      'character',
      'missing-character',
      'Fallback template',
      new Map([['gc.activeCharId', JSON.stringify('missing-character')]]),
      EXPORTED_AT,
    )).toThrow(/does not exist in the export snapshot/iu);
  });

  it('omits native creation progress so the exported data passes web validation', () => {
    const json = serializeNativeSettingsExportSnapshot(
      'roster',
      'c1',
      'Elsa',
      new Map([
        ['gc.activeCharId', JSON.stringify('c1')],
        ['gc.c1.wounds', JSON.stringify(7)],
        ['gc.newchar.step', JSON.stringify(3)],
        ['gc.newchar.draft', JSON.stringify({
          name: 'Marta',
          species: 'Human',
          archetypeKey: 'academic',
          inits: { ws: 31 },
        })],
      ]),
      EXPORTED_AT,
    );
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed).not.toHaveProperty('gc.newchar.step');
    expect(parsed).not.toHaveProperty('gc.newchar.draft');
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith('gc.')) {
        expect(() => validatePortableStorageValue(
          key,
          value,
          'Native export',
          { builtInCharacterIds: new Set(['c1']) },
        )).not.toThrow();
      }
    }
  });

  it('emits an exact-boundary backup accepted by the import gate and rejects one byte more', () => {
    const key = 'gc.future.payload';
    const empty = serializeNativeSettingsExportSnapshot(
      'roster',
      'c1',
      'Elsa',
      new Map([[key, JSON.stringify('')]]),
      EXPORTED_AT,
    );
    const remainingBytes = MAX_SETTINGS_BACKUP_FILE_BYTES - empty.length;
    const boundary = serializeNativeSettingsExportSnapshot(
      'roster',
      'c1',
      'Elsa',
      new Map([[key, JSON.stringify('a'.repeat(remainingBytes))]]),
      EXPORTED_AT,
    );

    expect(boundary).toHaveLength(MAX_SETTINGS_BACKUP_FILE_BYTES);
    expect(nativeImportTextSizeError('boundary.json', boundary)).toBeNull();
    expect(() => serializeNativeSettingsExportSnapshot(
      'roster',
      'c1',
      'Elsa',
      new Map([[key, JSON.stringify('a'.repeat(remainingBytes + 1))]]),
      EXPORTED_AT,
    )).toThrow(/larger than the 960 KiB import limit/iu);
  });
});
