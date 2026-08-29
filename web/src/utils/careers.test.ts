import { describe, expect, it } from 'vitest';
import type { Career } from '@/content/types';
import {
  careerDefForCharacter,
  careerMagicAccessLabel,
  careerMagicAccessMeta,
  careerRulesStatusLabel,
  careerRulesStatusMeta,
  careerSourceLabel,
} from './careers';
import charactersPack from '../../public/content/core-characters.json';

const careers: Career[] = [
  {
    id: 'car.wizard',
    name: 'College Wizard',
    class: 'Academic',
    species: ['race.human'],
    ranks: [{ level: 1, name: "Wizard's Apprentice", status: 'Brass 4' }],
  },
  {
    id: 'car.roadwarden',
    name: 'Roadwarden',
    class: 'Ranger',
    species: ['race.human'],
    ranks: [{ level: 1, name: 'Roadwarden', status: 'Silver 1' }],
  },
];

describe('careerDefForCharacter', () => {
  it('uses the stable id when a loaded Career has been renamed', () => {
    const resolved = careerDefForCharacter(careers, {
      careerId: 'car.wizard',
      career: 'Wizard',
    });

    expect(resolved?.name).toBe('College Wizard');
  });

  it('ships stable Career ids on every bundled character template', () => {
    expect(Object.fromEntries(charactersPack.characters.map(character => [
      character.id,
      character.careerId,
    ]))).toEqual({
      c1: 'car.roadwarden',
      c2: 'car.wizard',
      c3: 'car.runesmith',
      c4: 'car.priest',
    });
  });

  it('keeps legacy name-only characters working', () => {
    const resolved = careerDefForCharacter(careers, { career: 'Roadwarden' });

    expect(resolved?.id).toBe('car.roadwarden');
  });

  it('falls back to the name when a stored id is unavailable', () => {
    const resolved = careerDefForCharacter(careers, {
      careerId: 'car.from-disabled-pack',
      career: 'Roadwarden',
    });

    expect(resolved?.id).toBe('car.roadwarden');
  });
});

describe('Career metadata helpers', () => {
  it('formats source and bibliographic-status disclosures', () => {
    const career: Career = {
      ...careers[0],
      sourceBook: ' Winds of Magic ',
      sourcePage: 56,
      rulesStatus: 'bibliographic',
    };

    expect(careerSourceLabel(career)).toBe('Winds of Magic · p. 56');
    expect(careerRulesStatusMeta(career)).toBe('Index only');
    expect(careerRulesStatusLabel(career))
      .toBe('Index only — resolve this Career\'s full advance scheme from the source');
  });

  it('formats approximate and magic-access states without inventing defaults', () => {
    expect(careerRulesStatusMeta({ rulesStatus: 'approximate' })).toBe('Approximate summary');
    expect(careerRulesStatusLabel({ rulesStatus: 'approximate' }))
      .toBe('Approximate companion summary — verify in source');
    expect(careerRulesStatusMeta({})).toBe('');
    expect(careerMagicAccessMeta({ magicAccess: 'none' })).toBe('No magic access');
    expect(careerMagicAccessMeta({ magicAccess: 'starting' })).toBe('Starting magic access');
    expect(careerMagicAccessMeta({ magicAccess: 'later' })).toBe('Later magic access');
    expect(careerMagicAccessLabel({ magicAccess: 'starting' }))
      .toBe('Magic access begins at the first Career rank.');
    expect(careerMagicAccessLabel({})).toBe('');
  });

  it('keeps a page-only source reference usable', () => {
    expect(careerSourceLabel({ sourcePage: 0 })).toBe('p. 0');
  });
});
