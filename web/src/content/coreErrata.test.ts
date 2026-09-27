import { describe, expect, it } from 'vitest';
import items from '../../public/content/core-items.json';
import talents from '../../public/content/core-talents.json';
import type { ContentPack } from './types';
import { validatePack } from './validate';

const definitions = (talents as ContentPack).talents!;
const talent = (id: string) => definitions.find(entry => entry.id === `tal.${id}`);

describe('bundled core errata corrections', () => {
  it('keeps the corrected packs valid and versioned', () => {
    for (const pack of [items, talents]) {
      expect(pack.version).toBe('2026.09.07');
      const result = validatePack(pack);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    }
  });

  it('records corrected skill families and source pages', () => {
    for (const [id, family, page] of [
      ['aethyric-attunement', 'Channelling', 132],
      ['artistic', 'Art', 133],
    ] as const) {
      expect(talent(id)).toMatchObject({
        tests: `${family} (Any)`, sourceBook: 'WFRP Core Rulebook', sourcePage: page,
      });
    }
  });

  it('keeps the corrected test qualifiers visible without changing talent identities', () => {
    expect(talent('jump-up')?.rulesNote).toMatch(/Athletics.*\+0/);
    expect(talent('jump-up')?.description).toContain("Talent's test");
    expect(talent('jump-up')?.sourcePage).toBe(140);
    expect(talent('tower-of-memories')?.rulesNote).toMatch(/Average.*\+20/);
    expect(talent('tower-of-memories')?.sourcePage).toBe(147);
    expect(talent('magic-resistance')?.maxChar).toBe('t');
    expect(talent('magic-resistance')?.max).toBeUndefined();
  });

  it('preserves the existing weapon qualities while adding the correction', () => {
    // WFRP 4e Warhammer (Two-Handed): +SB+6, Damaging, Pummel, Slow.
    expect(items.weapons.find(entry => entry.id === 'wp.warhammer')?.qual)
      .toEqual(['Damaging', 'Pummel', 'Slow']);
  });
});
