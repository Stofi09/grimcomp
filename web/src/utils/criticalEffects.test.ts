import { describe, expect, it } from 'vitest';
import { addCriticalConditions } from './criticalEffects';

const defs = [
  { name: 'Bleeding', maxStacks: 10 },
  { name: 'Prone', maxStacks: 1 },
  { name: 'Unconscious', maxStacks: 1 },
];

describe('addCriticalConditions', () => {
  it('adds authored stacks onto the current conditions', () => {
    expect(addCriticalConditions({ Fatigued: 1 }, { Bleeding: 2, Stunned: 1 }))
      .toEqual({ Fatigued: 1, Bleeding: 2, Stunned: 1 });
  });

  it('stops a non-stacking condition at its cap while stacking conditions keep adding', () => {
    expect(addCriticalConditions({ Prone: 1, Bleeding: 3 }, { Prone: 1, Bleeding: 4 }, defs))
      .toEqual({ Prone: 1, Bleeding: 7 });
    expect(addCriticalConditions({ Bleeding: 8 }, { Bleeding: 4 }, defs)).toEqual({ Bleeding: 10 });
  });

  it('never lowers stacks already above a cap and leaves undefined caps unbounded', () => {
    expect(addCriticalConditions({ Unconscious: 2 }, { Unconscious: 1 }, defs)).toEqual({ Unconscious: 2 });
    expect(addCriticalConditions({ Ablaze: 12 }, { Ablaze: 1 }, defs)).toEqual({ Ablaze: 13 });
  });
});
