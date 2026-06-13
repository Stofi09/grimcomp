import { describe, it, expect } from 'vitest';
import { resolveTest, isDouble, diceLabel, rollDice } from './roll';
import type { TestRules } from '@/content/types';

// resolveTest is the resolution engine. These lock in WFRP 4e behaviour AND a
// d20 roll-over config, so the planned resolution-mode work (PbtA tiers, dice
// pools, advantage) can refactor freely without silently changing either.

describe('resolveTest — WFRP d100 roll-under (defaults)', () => {
  it('passes when roll <= target and computes signed SL', () => {
    const r = resolveTest({ target: 50, forceRoll: 30 });
    expect(r.success).toBe(true);
    expect(r.outcome).toBe('success');
    expect(r.sl).toBe(2); // floor(50/10) - floor(30/10) = 5 - 3
    expect(r.hasSl).toBe(true);
  });

  it('fails when roll > target with negative SL', () => {
    const r = resolveTest({ target: 50, forceRoll: 64 });
    expect(r.success).toBe(false);
    expect(r.outcome).toBe('fail');
    expect(r.sl).toBe(-1); // 5 - 6
  });

  it('honours the auto-success band regardless of target', () => {
    const r = resolveTest({ target: 1, forceRoll: 3 }); // 3 > 1 but inside 1–5
    expect(r.success).toBe(true);
    expect(r.outcome).toBe('crit-success');
  });

  it('honours the auto-failure band regardless of target', () => {
    const r = resolveTest({ target: 100, forceRoll: 98 }); // 98 <= 100 but inside 96–100
    expect(r.success).toBe(false);
    expect(r.outcome).toBe('fumble');
  });

  it('upgrades a passing double to a critical and a failing double to a fumble', () => {
    expect(resolveTest({ target: 50, forceRoll: 33 }).outcome).toBe('crit-success'); // 33 <= 50, double
    expect(resolveTest({ target: 40, forceRoll: 55 }).outcome).toBe('fumble'); // 55 > 40, double
  });

  it('applies a positive modifier by raising the target (roll-under)', () => {
    expect(resolveTest({ target: 40, forceRoll: 52 }).success).toBe(false);
    const r = resolveTest({ target: 40, modifier: 20, forceRoll: 52 });
    expect(r.effectiveTarget).toBe(60);
    expect(r.success).toBe(true);
  });

  it('clamps the effective target into the configured range', () => {
    const r = resolveTest({ target: 95, modifier: 20, forceRoll: 50 });
    expect(r.effectiveTarget).toBe(100); // clamped down from 115
  });
});

describe('resolveTest — d20 roll-over (config-driven direction)', () => {
  const D20: TestRules = {
    dice: { count: 1, sides: 20 },
    direction: 'over',
    doubles: false,
    // no auto bands, no SL, no clamp — a clean roll-over system
  };

  it('passes when roll >= target', () => {
    expect(resolveTest({ target: 12, forceRoll: 15 }, D20).success).toBe(true);
    expect(resolveTest({ target: 12, forceRoll: 9 }, D20).success).toBe(false);
  });

  it('applies a positive modifier by lowering the target (roll-over)', () => {
    const r = resolveTest({ target: 15, modifier: 3, forceRoll: 13 }, D20);
    expect(r.effectiveTarget).toBe(12);
    expect(r.success).toBe(true);
  });

  it('reports no success levels when sl is omitted', () => {
    const r = resolveTest({ target: 12, forceRoll: 15 }, D20);
    expect(r.hasSl).toBe(false);
    expect(r.sl).toBe(0);
  });
});

describe('isDouble / diceLabel / rollDice', () => {
  it('detects d100 doubles only', () => {
    expect(isDouble(11)).toBe(true);
    expect(isDouble(99)).toBe(true);
    expect(isDouble(55)).toBe(true);
    expect(isDouble(100)).toBe(false);
    expect(isDouble(10)).toBe(false);
    expect(isDouble(5)).toBe(false);
  });

  it('formats dice labels', () => {
    expect(diceLabel({ count: 1, sides: 100 })).toBe('d100');
    expect(diceLabel({ count: 2, sides: 10 })).toBe('2d10');
  });

  it('rollDice stays within [count, count*sides]', () => {
    for (let i = 0; i < 200; i += 1) {
      const v = rollDice({ count: 2, sides: 6 });
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(12);
    }
  });
});
