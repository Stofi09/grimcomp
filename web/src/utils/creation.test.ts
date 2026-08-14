import { describe, it, expect } from 'vitest';
import {
  startingXp, careerChoiceXp, statusTier, startingMoney, startingMoneyDice,
  distributeStartingAdvances, inferCareerCapabilities, pickDistinct,
} from './creation';

describe('startingXp — randomisation rewards (CRB p.36–37)', () => {
  it('sums the species and career awards', () => {
    expect(startingXp(true, 'first')).toBe(70);   // 20 + 50
    expect(startingXp(true, 'three')).toBe(45);   // 20 + 25
    expect(startingXp(false, 'three')).toBe(25);  // 0 + 25
    expect(startingXp(false, 'choose')).toBe(0);  // fully chosen
  });

  it('reports the career award without folding species XP into the option label', () => {
    expect(careerChoiceXp('first')).toBe(50);
    expect(careerChoiceXp('three')).toBe(25);
    expect(careerChoiceXp('choose')).toBe(0);
  });
});

describe('distributeStartingAdvances', () => {
  it('balances the five characteristic advances across three choices', () => {
    expect(distributeStartingAdvances(['ws', 'bs', 's'], 5)).toEqual({ ws: 2, bs: 2, s: 1 });
  });

  it('allocates 40 career-skill advances without exceeding 10', () => {
    const result = distributeStartingAdvances(
      ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'],
      40,
      10,
    );
    expect(Object.values(result).reduce((sum, value) => sum + value, 0)).toBe(40);
    expect(Math.max(...Object.values(result))).toBeLessThanOrEqual(10);
  });

  it('ignores duplicate choices and stops when every choice reaches its cap', () => {
    expect(distributeStartingAdvances(['one', 'one'], 40, 10)).toEqual({ one: 10 });
  });
});

describe('statusTier', () => {
  it('reads the tier word', () => {
    expect(statusTier('Gold 2')).toBe('Gold');
    expect(statusTier('Silver 1')).toBe('Silver');
    expect(statusTier('Brass 0')).toBe('Brass');
  });
  it('defaults to Brass for anything unexpected', () => {
    expect(statusTier('')).toBe('Brass');
    expect(statusTier('Copper 3')).toBe('Brass');
  });
});

describe('startingMoney — by Status tier (CRB p.50)', () => {
  it('Brass rolls 2d10 brass pennies', () => {
    expect(startingMoneyDice('Brass')).toBe(2);
    expect(startingMoney('Brass', [6, 4])).toEqual({ gc: 0, ss: 0, d: 10 });
  });
  it('Silver rolls 1d10 shillings', () => {
    expect(startingMoneyDice('Silver')).toBe(1);
    expect(startingMoney('Silver', [7])).toEqual({ gc: 0, ss: 7, d: 0 });
  });
  it('Gold rolls 1d10 crowns', () => {
    expect(startingMoney('Gold', [3])).toEqual({ gc: 3, ss: 0, d: 0 });
  });
});

describe('inferCareerCapabilities', () => {
  it('flags casters and the anointed', () => {
    expect(inferCareerCapabilities('car.wizard')).toEqual({ isCaster: true, isAnointed: false });
    expect(inferCareerCapabilities('car.priest')).toEqual({ isCaster: false, isAnointed: true });
    expect(inferCareerCapabilities('car.warrior-priest').isAnointed).toBe(true);
  });
  it('treats a mundane career as neither', () => {
    expect(inferCareerCapabilities('car.soldier')).toEqual({ isCaster: false, isAnointed: false });
  });
});

describe('pickDistinct', () => {
  it('picks distinct items using the injected randoms', () => {
    const pool = ['a', 'b', 'c', 'd'];
    // 0 → index 0 ('a'); then 0 → index 0 of the remaining ['b','c','d'] ('b')
    expect(pickDistinct(pool, 2, [0, 0])).toEqual(['a', 'b']);
    // 0.99 → last each time
    expect(pickDistinct(pool, 2, [0.99, 0.99])).toEqual(['d', 'c']);
  });
  it('never exceeds the pool size', () => {
    expect(pickDistinct(['x'], 3, [0, 0, 0])).toEqual(['x']);
  });
});
