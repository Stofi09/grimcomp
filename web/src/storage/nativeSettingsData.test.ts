import { describe, expect, it } from 'vitest';
import { serializeNativeSettingsExportSnapshot } from '../../../src/storage/settingsData';

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
});
