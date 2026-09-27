import { describe, expect, it } from 'vitest';
import {
  formatTestResult,
  isDouble,
  resolveTest,
  resultLabel,
  slText,
} from '../../../src/utils/roll';

describe('native roll outcome consistency', () => {
  it('reports a negative SL when the automatic-failure band overrides a passing target', () => {
    const result = resolveTest({ target: 100, forceRoll: 96 });

    expect(result).toMatchObject({
      outcome: 'fail',
      automatic: true,
      success: false,
      sl: -1,
    });
    expect(formatTestResult(result)).toContain('-1 SL');
  });

  it('keeps an ordinary high-target success positive', () => {
    const result = resolveTest({ target: 100, forceRoll: 95 });

    expect(result).toMatchObject({
      outcome: 'success',
      automatic: false,
      success: true,
      sl: 1,
    });
  });
});

describe('native automatic bands versus criticals', () => {
  it('makes 01–05 an automatic success, not a critical', () => {
    const result = resolveTest({ target: 1, forceRoll: 3 });
    expect(result).toMatchObject({ success: true, outcome: 'success', automatic: true });
    expect(resultLabel(result)).toBe('AUTOMATIC SUCCESS');
  });

  it('makes 96–00 an automatic failure, not a fumble', () => {
    for (const roll of [96, 97, 98, 100]) {
      const result = resolveTest({ target: 100, forceRoll: roll });
      expect(result).toMatchObject({ success: false, outcome: 'fail', automatic: true });
      expect(resultLabel(result)).toBe('AUTOMATIC FAILURE');
    }
  });

  it('keeps 99 a fumble: it is both an automatic failure and a double', () => {
    const result = resolveTest({ target: 100, forceRoll: 99 });
    expect(result).toMatchObject({ success: false, outcome: 'fumble', automatic: true });
    expect(resultLabel(result)).toBe('FUMBLE');
  });

  it('still upgrades doubles: a passing double is critical and a failing one a fumble', () => {
    expect(resolveTest({ target: 50, forceRoll: 33 })).toMatchObject({ outcome: 'crit-success', automatic: false });
    expect(resultLabel(resolveTest({ target: 50, forceRoll: 33 }))).toBe('CRITICAL SUCCESS');
    expect(resolveTest({ target: 50, forceRoll: 77 })).toMatchObject({ outcome: 'fumble', automatic: false });
    expect(resultLabel(resolveTest({ target: 50, forceRoll: 30 }))).toBe('SUCCESS');
    expect(resultLabel(resolveTest({ target: 50, forceRoll: 60 }))).toBe('FAILURE');
    expect(isDouble(100)).toBe(false);
    expect(isDouble(5)).toBe(false);
  });

  it('reads results from builds before the automatic flag by their roll', () => {
    // Older builds labelled the 01–05 / 96–00 bands as critical / fumble.
    expect(resultLabel({ outcome: 'crit-success', roll: 3 })).toBe('AUTOMATIC SUCCESS');
    expect(resultLabel({ outcome: 'fumble', roll: 97 })).toBe('AUTOMATIC FAILURE');
    expect(resultLabel({ outcome: 'crit-success', roll: 33 })).toBe('CRITICAL SUCCESS');
    expect(resultLabel({ outcome: 'fumble', roll: 99 })).toBe('FUMBLE');
    expect(resultLabel({ outcome: 'success', roll: 30 })).toBe('SUCCESS');
  });
});

describe('native SL text', () => {
  it('writes a failed zero-SL test as −0 and a passing one as +0', () => {
    const failed = resolveTest({ target: 40, forceRoll: 45 });
    expect(failed).toMatchObject({ success: false, sl: 0 });
    expect(slText(failed)).toBe('−0');
    expect(formatTestResult(failed)).toMatch(/−0 SL$/u);

    const passed = resolveTest({ target: 45, forceRoll: 40 });
    expect(slText(passed)).toBe('+0');
    expect(slText({ sl: -2, success: false })).toBe('-2');
    expect(slText({ sl: 3, success: true })).toBe('+3');
  });
});
