import { describe, it, expect } from 'vitest';
import { validatePack } from './validate';

// Eagerly import every shipped content pack as parsed JSON. Vite resolves these
// at transform time, so the test needs no node:fs and no @types/node.
const modules = import.meta.glob('../../public/content/*.json', { eager: true });

const readPack = (file: string): unknown => {
  const entry = Object.entries(modules).find(([path]) => path.endsWith(`/${file}`));
  if (!entry) throw new Error(`content pack not found: ${file}`);
  return (entry[1] as { default: unknown }).default;
};

describe('validatePack — unit', () => {
  it('accepts a minimal v2 pack', () => {
    const { pack, errors, warnings } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
    });
    expect(errors).toEqual([]);
    expect(pack).toBeTruthy();
    expect(warnings).toEqual([]);
  });

  it('reports missing required fields', () => {
    const { pack, errors } = validatePack({ $schema: 'grimcomp.content.v2' });
    expect(pack).toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-object', () => {
    expect(validatePack(42).errors.length).toBeGreaterThan(0);
  });

  it('warns (but does not fail) on an unknown / typo section', () => {
    const { pack, errors, warnings } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      spels: [], // typo for "spells"
    });
    expect(errors).toEqual([]);
    expect(pack).toBeTruthy();
    expect(warnings.some(w => w.includes('spels'))).toBe(true);
  });

  it('flags a duplicate id within a section', () => {
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      spells: [
        { id: 'm.x', name: 'X' },
        { id: 'm.x', name: 'Y' },
      ],
    });
    expect(errors.some(e => /duplicate/i.test(e))).toBe(true);
  });
});

// Regression lock: every pack the app actually ships must validate cleanly.
// This is the net that makes future schema changes safe — break a core pack and
// CI goes red instead of the app white-screening on load.
describe('validatePack — shipped content regression lock', () => {
  const manifest = readPack('manifest.json') as { packs: string[] };

  it('manifest lists at least one pack', () => {
    expect(Array.isArray(manifest.packs)).toBe(true);
    expect(manifest.packs.length).toBeGreaterThan(0);
  });

  for (const file of manifest.packs) {
    it(`${file} validates with no errors`, () => {
      const { pack, errors } = validatePack(readPack(file));
      expect(errors).toEqual([]);
      expect(pack).toBeTruthy();
    });
  }
});
