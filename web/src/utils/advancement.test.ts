import { describe, it, expect } from 'vitest';
import { talentMaxRank, isCareerCharacteristic, characteristicAdvanceCost } from './advancement';

const bonus: Record<string, number> = { t: 4, wp: 3, s: 5 };
const bonusFor = (k: string) => bonus[k] ?? 0;

describe('talentMaxRank', () => {
  it('uses a flat max when present', () => {
    expect(talentMaxRank({ max: 1 }, bonusFor)).toBe(1);
    expect(talentMaxRank({ max: 3, maxChar: 't' }, bonusFor)).toBe(3); // flat wins
  });

  it('falls back to the characteristic Bonus for maxChar', () => {
    expect(talentMaxRank({ maxChar: 't' }, bonusFor)).toBe(4);
    expect(talentMaxRank({ maxChar: 'wp' }, bonusFor)).toBe(3);
  });

  it('is undefined when no cap is listed', () => {
    expect(talentMaxRank({}, bonusFor)).toBeUndefined();
    expect(talentMaxRank(undefined, bonusFor)).toBeUndefined();
  });

  it('never returns below 1', () => {
    expect(talentMaxRank({ maxChar: 'nonexistent' }, bonusFor)).toBe(1);
    expect(talentMaxRank({ max: 0 }, bonusFor)).toBe(1);
  });
});

describe('isCareerCharacteristic', () => {
  const career = { advanceScheme: { characteristics: ['ws', 's', 't'] } };
  it('is true for characteristics inside the scheme', () => {
    expect(isCareerCharacteristic(career, 'ws')).toBe(true);
    expect(isCareerCharacteristic(career, 't')).toBe(true);
  });
  it('is false for characteristics outside the scheme', () => {
    expect(isCareerCharacteristic(career, 'int')).toBe(false);
    expect(isCareerCharacteristic(career, 'fel')).toBe(false);
  });
  it('treats every characteristic as in-career when no scheme is declared', () => {
    expect(isCareerCharacteristic(undefined, 'int')).toBe(true);
    expect(isCareerCharacteristic({ advanceScheme: { characteristics: [] } }, 'int')).toBe(true);
  });
});

describe('characteristicAdvanceCost', () => {
  it('keeps the base cost in-career', () => {
    expect(characteristicAdvanceCost(125, true, 2)).toBe(125);
  });
  it('applies the multiplier out-of-career', () => {
    expect(characteristicAdvanceCost(125, false, 2)).toBe(250);
    expect(characteristicAdvanceCost(125, false, 1)).toBe(125);
  });
});
