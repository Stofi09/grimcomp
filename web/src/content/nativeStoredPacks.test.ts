import { describe, expect, it } from 'vitest';
import { CONTENT_SCHEMA, type ContentPack } from '../../../src/content/types';
import { validatePack } from '../../../src/content/validate';
import {
  countQuarantinedPacks,
  partitionStoredPacks,
  removeStoredPack,
  setStoredPackEnabled,
  upsertStoredPack,
  type StoredPackEntry,
} from '../../../src/content/storedPacks';

const valid = (id: string, name = `Pack ${id}`): ContentPack => ({
  $schema: CONTENT_SCHEMA, id, name, version: '1.0.0',
  talents: [{ id: `tal.${id}`, name: `Talent ${id}`, description: 'Valid today.', maxChar: 't' }],
});

// Accepted by the pre-hardening native validator; rejected by today's rules.
const legacy = {
  $schema: CONTENT_SCHEMA, id: 'homebrew.legacy', name: 'Legacy homebrew', version: '0.9',
  spells: [{
    id: 'spell.legacy', name: 'Legacy Dart', lore: 'Petty', cn: 2.5, range: 'Touch', target: '1',
    duration: 'Instant', description: 'Fractional CN.',
  }],
  talents: [{ id: 'tal.legacy', name: 'Legacy Hardy', description: 'Textual max.', max: 'Toughness Bonus' }],
};

describe('native stored content-pack quarantine', () => {
  it('loads only enabled packs that pass the current validator, in stored order', () => {
    const stored: StoredPackEntry[] = [
      { enabled: true, pack: valid('b') },
      { enabled: true, pack: legacy },
      { enabled: false, pack: valid('c') },
      { enabled: true, pack: valid('a') },
    ];
    const partition = partitionStoredPacks(stored);

    expect(partition.active.map(pack => pack.id)).toEqual(['b', 'a']);
    expect(partition.statuses.map(status => [status.id, status.enabled, status.quarantined])).toEqual([
      ['b', true, false], ['homebrew.legacy', true, true], ['c', false, false], ['a', true, false],
    ]);
    expect(partition.quarantined).toEqual([expect.objectContaining({
      id: 'homebrew.legacy',
      errors: expect.arrayContaining([expect.stringContaining('cn'), expect.stringContaining('max')]),
    })]);
    expect(countQuarantinedPacks(stored)).toBe(1);
  });

  it('keeps new imports strict: the tolerated legacy pack is still an invalid import', () => {
    expect(validatePack(legacy).pack).toBeUndefined();
    expect(validatePack(valid('a')).errors).toEqual([]);
  });

  it('reports display-safe labels and bounded diagnostics for malformed stored fields', () => {
    const hostile = {
      $schema: CONTENT_SCHEMA, id: 'pack.hostile', name: { rich: 'text' }, version: 7,
      spells: Array.from({ length: 40 }, (_, index) => ({ id: `spell.${index}` })),
    };
    const [status] = partitionStoredPacks([{ enabled: true, pack: hostile }]).statuses;

    expect(status).toMatchObject({ id: 'pack.hostile', name: 'pack.hostile', version: '', quarantined: true });
    expect(status.errors.length).toBeGreaterThan(0);
    expect(status.errors.length).toBeLessThanOrEqual(5);
    expect(partitionStoredPacks([{ enabled: true, pack: { id: '' } }]).statuses[0].name).toBe('Unnamed pack');
  });

  it('never throws for values outside the storage envelope', () => {
    for (const value of [undefined, null, 'packs', { 0: 'x' }, [null, 7, { pack: 'x' }]]) {
      expect(() => partitionStoredPacks(value)).not.toThrow();
      expect(partitionStoredPacks(value).active).toEqual([]);
    }
  });

  it('validates each stored list once per stored revision', () => {
    const stored: StoredPackEntry[] = [{ enabled: true, pack: valid('a') }];
    expect(partitionStoredPacks(stored)).toBe(partitionStoredPacks(stored));
    expect(partitionStoredPacks([...stored])).not.toBe(partitionStoredPacks(stored));
  });

  it('repairs a quarantined pack by re-importing a valid pack with the same id', () => {
    const stored: StoredPackEntry[] = [{ enabled: false, pack: legacy }, { enabled: true, pack: valid('a') }];
    const repaired = upsertStoredPack(stored, valid('homebrew.legacy', 'Corrected homebrew'));

    expect(repaired.map(entry => entry.pack.id)).toEqual(['homebrew.legacy', 'a']);
    expect(repaired[0]).toEqual({ enabled: true, pack: valid('homebrew.legacy', 'Corrected homebrew') });
    expect(partitionStoredPacks(repaired).quarantined).toEqual([]);
    expect(upsertStoredPack(stored, valid('z')).map(entry => entry.pack.id)).toEqual(['homebrew.legacy', 'a', 'z']);
  });

  it('removes and toggles by id while carrying other entries over verbatim', () => {
    const stored: StoredPackEntry[] = [{ enabled: true, pack: legacy }, { enabled: true, pack: valid('a') }];

    const toggled = setStoredPackEnabled(stored, 'a', false);
    expect(toggled[0]).toBe(stored[0]);
    expect(toggled[1]).toEqual({ enabled: false, pack: valid('a') });
    expect(partitionStoredPacks(toggled).active).toEqual([]);

    const removed = removeStoredPack(stored, 'homebrew.legacy');
    expect(removed).toEqual([{ enabled: true, pack: valid('a') }]);
    expect(removeStoredPack(stored, 'a')[0]).toBe(stored[0]);
  });
});
