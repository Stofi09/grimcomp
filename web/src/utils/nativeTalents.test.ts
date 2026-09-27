import { describe, expect, it } from 'vitest';
import { loadBundledCatalogue } from '../../../src/content/bundled';
import type { TalentDef } from '../../../src/content/types';
import { CHARACTER_TEMPLATES } from '../../../src/data/character';
import {
  incrementTalentRank,
  talentDefinitionForName,
  talentMaxRank,
} from '../../../src/utils/nativeTalents';

const bonus: Record<string, number> = { t: 4, wp: 3, s: 5 };
const bonusFor = (key: string) => bonus[key] ?? 0;

describe('native talentMaxRank (web parity)', () => {
  it('uses a flat max when present, over a characteristic bonus', () => {
    expect(talentMaxRank({ max: 1 }, bonusFor)).toBe(1);
    expect(talentMaxRank({ max: 3, maxChar: 't' }, bonusFor)).toBe(3);
  });

  it('falls back to the characteristic Bonus for maxChar', () => {
    expect(talentMaxRank({ maxChar: 't' }, bonusFor)).toBe(4);
    expect(talentMaxRank({ maxChar: 'wp' }, bonusFor)).toBe(3);
  });

  it('is undefined when no cap is listed and never returns below 1', () => {
    expect(talentMaxRank({}, bonusFor)).toBeUndefined();
    expect(talentMaxRank(undefined, bonusFor)).toBeUndefined();
    expect(talentMaxRank({ maxChar: 'ag' }, bonusFor)).toBe(1);
    expect(talentMaxRank({ max: 0 }, bonusFor)).toBe(1);
  });
});

describe('native talent definition lookup by sheet name', () => {
  const definitions: TalentDef[] = [
    { id: 'tal.hardy', name: 'Hardy', description: '', maxChar: 't' },
    { id: 'tal.arcane', name: 'Arcane Magic', description: '' },
    { id: 'tal.acute', name: 'Acute Sense (Sense)', description: '', specializations: ['Sight', 'Taste'], maxChar: 'i' },
    { id: 'tal.etiquette', name: 'Etiquette', description: '', specializations: ['Nobles'] },
  ];

  it('resolves exact, case-insensitive, and parenthesized choice names', () => {
    expect(talentDefinitionForName(definitions, 'Hardy')?.id).toBe('tal.hardy');
    expect(talentDefinitionForName(definitions, 'hardy')?.id).toBe('tal.hardy');
    expect(talentDefinitionForName(definitions, 'Arcane Magic (Fire)')?.id).toBe('tal.arcane');
    expect(talentDefinitionForName(definitions, 'Acute Sense (Sight)')?.id).toBe('tal.acute');
    expect(talentDefinitionForName(definitions, 'Acute Sense Sight')?.id).toBe('tal.acute');
    expect(talentDefinitionForName(definitions, 'Etiquette (Nobles)')?.id).toBe('tal.etiquette');
  });

  it('does not guess for unknown or unlisted choices', () => {
    expect(talentDefinitionForName(definitions, 'Kind-hearted')).toBeUndefined();
    expect(talentDefinitionForName(definitions, 'Acute Sense (Smell)')).toBeUndefined();
    expect(talentDefinitionForName(definitions, 'Etiquette (Guilders)')).toBeUndefined();
    expect(talentDefinitionForName(definitions, 'Hardy (Very (Hardy))')).toBeUndefined();
  });

  it('finds the catalogue caps for the bundled characters\' talents', () => {
    const catalogue = loadBundledCatalogue().packs.flatMap(pack => pack.talents ?? []);
    expect(talentMaxRank(talentDefinitionForName(catalogue, 'Hardy'), bonusFor)).toBe(4);
    expect(talentMaxRank(talentDefinitionForName(catalogue, 'Read/Write'), bonusFor)).toBe(1);
    expect(talentDefinitionForName(catalogue, 'Bless (Shallya)')?.name).toBe('Bless');
    for (const template of Object.values(CHARACTER_TEMPLATES)) {
      for (const talent of template.talents) {
        expect(() => talentMaxRank(talentDefinitionForName(catalogue, talent.name), bonusFor)).not.toThrow();
      }
    }
  });
});

describe('native capped talent purchase', () => {
  it('adds a rank below the cap and refuses without changing anything at it', () => {
    const times = { Hardy: 3 };
    expect(incrementTalentRank(times, 'Hardy', 1, 4)).toEqual({ ok: true, times: { Hardy: 4 }, rank: 4 });

    const atCap = { Hardy: 4 };
    const refused = incrementTalentRank(atCap, 'Hardy', 1, 4);
    expect(refused).toEqual({ ok: false, times: atCap, max: 4 });
    expect(refused.times).toBe(atCap);
  });

  it('continues from the template rank for a talent missing from the stored map', () => {
    expect(incrementTalentRank({ Sharp: 1 }, 'Hardy', 2, 4)).toEqual({
      ok: true, times: { Sharp: 1, Hardy: 3 }, rank: 3,
    });
    expect(incrementTalentRank({}, 'Read/Write', 1, 1)).toMatchObject({ ok: false, max: 1 });
  });

  it('keeps uncapped talents purchasable', () => {
    expect(incrementTalentRank({ Menacing: 7 }, 'Menacing', 1, undefined)).toMatchObject({ ok: true, rank: 8 });
  });
});
