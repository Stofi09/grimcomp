import { describe, expect, it } from 'vitest';
import {
  formatTestResult,
  resolveTest,
} from '../../../src/utils/roll';

describe('native roll outcome consistency', () => {
  it('reports a negative SL when the auto-failure band overrides a passing target', () => {
    const result = resolveTest({ target: 100, forceRoll: 96 });

    expect(result).toMatchObject({
      outcome: 'fumble',
      success: false,
      sl: -1,
    });
    expect(formatTestResult(result)).toContain('-1 SL');
  });

  it('keeps an ordinary high-target success positive', () => {
    const result = resolveTest({ target: 100, forceRoll: 95 });

    expect(result).toMatchObject({
      outcome: 'success',
      success: true,
      sl: 1,
    });
  });
});
