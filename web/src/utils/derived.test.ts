import { describe, expect, it } from 'vitest';
import type { Character } from '@/data/character';
import type { DerivedFormulas, Race, WoundsRules } from '@/content/types';
import { deriveStats, type LiveCharacteristic, type LiveTalent } from './derived';

const formulas: DerivedFormulas = {
  bonus: 'floor(value / 10)',
  maxWounds: '(small ? 0 : sb) + 2*tb + wpb + bonusRanks * tb',
  walk: 'm * 2',
  run: 'm * 4',
  maxEncumbrance: 'sb + tb',
  corruptionThreshold: 'max(1, tb + wpb)',
  restRecovery: 'tb',
};

const woundsRules: WoundsRules = {
  smallSizes: ['Small'],
  bonusTalent: 'Hardy',
};

const race = (id: string, name: string, size?: string): Race => ({
  id,
  name,
  size,
  movement: 4,
  fate: 2,
  resilience: 1,
  extra: 0,
  charModifiers: {},
  skills: [],
  talents: [],
  description: '',
});

const character = (raceId: string, species: string): Character => ({
  id: 'c1',
  raceId,
  species,
  movement: 4,
} as Character);

const characteristics: LiveCharacteristic[] = [
  { key: 's', name: 'Strength', short: 'S', init: 30, adv: 10, current: 40, bonus: 4 },
  { key: 't', name: 'Toughness', short: 'T', init: 30, adv: 10, current: 40, bonus: 4 },
  { key: 'wp', name: 'Willpower', short: 'WP', init: 30, adv: 0, current: 30, bonus: 3 },
];

const talents: LiveTalent[] = [
  { name: 'Hardy', times: 2, desc: '', career: true },
];

describe('deriveStats', () => {
  it('uses live characteristics and talent ranks for maximum wounds', () => {
    const result = deriveStats(
      character('human', 'Human'),
      characteristics,
      talents,
      [race('human', 'Human')],
      woundsRules,
      formulas,
    );

    expect(result.maxWounds).toBe(23);
    expect(result.walk).toBe(8);
    expect(result.run).toBe(16);
    expect(result.maxEncumbrance).toBe(8);
  });

  it('resolves race by stable id and applies small-species wounds rules', () => {
    const result = deriveStats(
      character('halfling', 'Renamed species'),
      characteristics,
      talents,
      [race('halfling', 'Halfling', 'Small')],
      woundsRules,
      formulas,
    );

    expect(result.small).toBe(true);
    expect(result.maxWounds).toBe(19);
  });
});
