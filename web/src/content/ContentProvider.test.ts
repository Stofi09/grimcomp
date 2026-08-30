import { describe, expect, it } from 'vitest';
import {
  MAX_STORED_CONTENT_PACKS,
  collectEnabledStoredPacks,
  preserveRequiredFallbackCharacter,
} from './storedContentPacks';
import { ContentRegistry } from './registry';
import charactersPack from '../../public/content/core-characters.json';
import type { ContentPack } from './types';

const validPack = {
  $schema: 'grimcomp.content.v2',
  id: 'safe-pack',
  name: 'Safe pack',
  version: '1.0.0',
};

describe('collectEnabledStoredPacks', () => {
  it('skips malformed persisted entries without throwing or losing valid layers', () => {
    const warnings: string[] = [];
    const hostile = new Proxy({}, {
      get: () => { throw new Error('hostile property access'); },
    });

    expect(() => collectEnabledStoredPacks(
      [null, 4, hostile, { enabled: 'yes', pack: validPack }, { enabled: true, pack: validPack }],
      message => { warnings.push(message); },
    )).not.toThrow();
    expect(collectEnabledStoredPacks(
      [null, { enabled: true, pack: validPack }],
      () => undefined,
    )).toEqual([validPack]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('rejects a non-array stored pack collection safely', () => {
    const warnings: string[] = [];
    expect(collectEnabledStoredPacks({ pack: validPack }, message => { warnings.push(message); }))
      .toEqual([]);
    expect(warnings[0]).toMatch(/expected an array/);
  });

  it('rejects rather than truncates an oversized stored pack collection', () => {
    const oversized = Array.from(
      { length: MAX_STORED_CONTENT_PACKS + 1 },
      () => ({ enabled: false, pack: validPack }),
    );
    const warnings: string[] = [];
    expect(collectEnabledStoredPacks(oversized, message => { warnings.push(message); }))
      .toEqual([]);
    expect(warnings[0]).toContain(`${MAX_STORED_CONTENT_PACKS}-entry safety limit`);
  });

  it('preserves legacy imported templates while ignoring a fallback tombstone', () => {
    const base = charactersPack.characters[0] as unknown as Record<string, unknown>;
    const bundled = {
      ...validPack,
      id: 'bundled',
      characters: [{ ...base, id: 'c1', name: 'Fallback' }],
    } as unknown as ContentPack;
    const legacyUser = {
      ...validPack,
      id: 'legacy-user',
      characters: [{ ...base, id: 'imported-x', name: 'Imported X' }],
      deletions: { characters: ['c1'] },
    } as unknown as ContentPack;

    const registry = new ContentRegistry([
      bundled,
      preserveRequiredFallbackCharacter(legacyUser),
    ]);
    expect(registry.getCharacterTemplate('c1')?.name).toBe('Fallback');
    expect(registry.getCharacterTemplate('imported-x')?.name).toBe('Imported X');
  });
});
