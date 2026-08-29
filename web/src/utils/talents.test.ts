import { describe, expect, it } from 'vitest';
import type { TalentDef } from '@/content/types';
import {
  canonicalizeAddedTalentRefs,
  canonicalTalentRef,
  isTalentCareerOption,
  migrateTalentTimes,
  normalizeAddedTalentRefs,
  normalizeTalentTimes,
  resolveStoredTalentRef,
  talentDefForName,
  talentDefForTalent,
  talentDisplayName,
  talentIdentityKey,
  talentRulesStatusLabel,
  talentRulesStatusMeta,
  talentSourceLabel,
} from './talents';

const talents: TalentDef[] = [{
  id: 'tal.arcane-magic',
  name: 'Arcane Magic',
  description: 'Learn one lore.',
}, {
  id: 'tal.suffuse-with-wind',
  name: 'Suffuse with (Wind)',
  description: 'Carry a chosen Wind.',
  max: 1,
  tests: 'See text',
  specializations: ['Aqshy', 'Ulgu'],
  sourceBook: 'Winds of Magic',
  sourcePage: 186,
  restriction: 'Familiar only',
  rulesStatus: 'bibliographic',
}];

describe('talent definition and persistence helpers', () => {
  it('resolves exact, legacy grouped, and parameterized names without broad prefix matches', () => {
    expect(talentDefForName(talents, 'Arcane Magic')?.id).toBe('tal.arcane-magic');
    expect(talentDefForName(talents, 'Arcane Magic (Fire)')?.id).toBe('tal.arcane-magic');
    expect(talentDefForName(talents, 'Suffuse with Aqshy')?.id).toBe('tal.suffuse-with-wind');
    expect(talentDefForName(talents, 'Suffuse with (Ulgu)')?.id).toBe('tal.suffuse-with-wind');
    expect(talentDefForName(talents, 'Arcane Magical')).toBeUndefined();
  });

  it('creates and resolves stable composite references across a definition rename', () => {
    const suffuse = talents[1];
    expect(talentDisplayName(suffuse, 'Aqshy')).toBe('Suffuse with Aqshy');
    expect(canonicalTalentRef(suffuse)).toBeUndefined();
    expect(canonicalTalentRef(suffuse, 'aqshy')).toEqual({
      definitionId: 'tal.suffuse-with-wind',
      specialization: 'Aqshy',
      name: 'Suffuse with Aqshy',
    });

    const renamed: TalentDef[] = [{ ...suffuse, name: 'Aethyric Suffusion (Wind)' }];
    expect(resolveStoredTalentRef(renamed, {
      definitionId: suffuse.id,
      specialization: 'Aqshy',
      name: 'Old display name',
    }).name).toBe('Aethyric Suffusion Aqshy');
  });

  it('uses exact definition IDs and normalized specializations for identity', () => {
    expect(talentIdentityKey({
      name: 'Suffuse with Aqshy',
      definitionId: 'Tal.MixedCase',
      specialization: ' AQSHY ',
    })).toBe('definition:Tal.MixedCase|specialization:aqshy');
    expect(talentIdentityKey({
      name: 'Suffuse with Aqshy',
      definitionId: 'tal.mixedcase',
      specialization: 'Aqshy',
    })).not.toBe('definition:Tal.MixedCase|specialization:aqshy');
  });

  it('canonicalizes equivalent ownership and preserves stable name snapshots', () => {
    expect(canonicalizeAddedTalentRefs(talents, [
      'Suffuse with Aqshy',
      {
        name: 'Old Suffuse label',
        definitionId: 'tal.suffuse-with-wind',
        specialization: 'aqshy',
      },
      'Arcane Magic (Fire)',
    ], [{ name: 'Arcane Magic (Fire)', definitionId: 'tal.arcane-magic', specialization: 'Fire' }]))
      .toEqual([{
        name: 'Old Suffuse label',
        definitionId: 'tal.suffuse-with-wind',
        specialization: 'Aqshy',
      }]);
  });

  it('migrates a legacy rank once, prefers canonical values, and preserves unmatched data', () => {
    const first = { name: 'Shared Gift', definitionId: 'tal.first' };
    const second = { name: 'Shared Gift', definitionId: 'tal.second' };
    const firstKey = talentIdentityKey(first);
    const secondKey = talentIdentityKey(second);
    const owners = [
      { ref: first, aliases: ['Shared Gift'], initial: 1 },
      { ref: second, aliases: ['Shared Gift'], initial: 1 },
    ];

    const ambiguous = migrateTalentTimes({ 'Shared Gift': 3, Orphan: 4 }, owners);
    expect(ambiguous.times).toEqual({ [firstKey]: 3, [secondKey]: 1, Orphan: 4 });
    expect(ambiguous.migrated).toBe(true);
    expect(migrateTalentTimes(ambiguous.times, owners)).toEqual({
      times: ambiguous.times,
      migrated: false,
    });

    expect(migrateTalentTimes({ [firstKey]: 2, 'Shared Gift': 3 }, owners).times).toEqual({
      [firstKey]: 2,
      [secondKey]: 1,
    });
  });

  it('keeps an unavailable ID or removed specialization authoritative', () => {
    const revised = [{ ...talents[1], specializations: ['Ulgu'] }];
    const stored = {
      name: 'Old Suffuse label',
      definitionId: 'tal.suffuse-with-wind',
      specialization: 'Aqshy',
    };
    expect(resolveStoredTalentRef(revised, stored)).toMatchObject({
      name: 'Suffuse with Aqshy',
      specialization: 'Aqshy',
    });
    expect(canonicalizeAddedTalentRefs(revised, [stored])).toEqual([stored]);
    expect(talentDefForTalent(talents, { name: 'Arcane Magic', definitionId: 'tal.missing' }))
      .toBeUndefined();
  });

  it('normalizes mixed legacy/object overlays and corrupt imported rank data', () => {
    expect(normalizeAddedTalentRefs([
      '  Legacy  ',
      null,
      {},
      { name: 'Suffuse with Aqshy', definitionId: 'tal.suffuse-with-wind', specialization: 'Aqshy' },
      { name: 'Duplicate', definitionId: 'tal.suffuse-with-wind', specialization: 'Aqshy' },
      { name: 'Bad id', definitionId: 4 },
      { name: 'Suffuse with Ulgu', definitionId: 'tal.suffuse-with-wind', specialization: 'Ulgu' },
    ])).toEqual([
      { name: 'Legacy' },
      { name: 'Suffuse with Aqshy', definitionId: 'tal.suffuse-with-wind', specialization: 'Aqshy' },
      { name: 'Suffuse with Ulgu', definitionId: 'tal.suffuse-with-wind', specialization: 'Ulgu' },
    ]);

    expect(normalizeTalentTimes({ Good: 2, Zero: 0, Fraction: 1.5, Infinite: Infinity, Bad: '2' }))
      .toEqual({ Good: 2 });
    expect(normalizeTalentTimes(null)).toEqual({});
  });

  it('matches generalized and concrete career entries and formats disclosure metadata', () => {
    const suffuse = talents[1];
    expect(isTalentCareerOption(new Set(['Suffuse with (Wind)']), talents, suffuse, 'Suffuse with Aqshy'))
      .toBe(true);
    expect(isTalentCareerOption(new Set(['Suffuse with Ulgu']), talents, suffuse, 'Suffuse with Aqshy'))
      .toBe(false);
    expect(isTalentCareerOption(new Set(['Suffuse with (Ulgu)']), talents, suffuse, 'Suffuse with Ulgu'))
      .toBe(true);
    expect(talentSourceLabel(suffuse)).toBe('Winds of Magic · p. 186');
    expect(talentRulesStatusMeta(suffuse)).toBe('Index only');
    expect(talentRulesStatusLabel(suffuse)).toBe(
      'Index only — resolve this Talent\'s effect from the source',
    );
  });
});
