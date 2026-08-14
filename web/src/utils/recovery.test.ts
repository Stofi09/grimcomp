import { describe, expect, it } from 'vitest';
import type { ConditionDef } from '@/content/types';
import type { Critical } from '@/data/character';
import { advanceCriticalHealingDay, clearSceneEndConditions } from './recovery';

describe('recovery clocks', () => {
  it('clears only conditions explicitly tied to the end of a scene', () => {
    const definitions: ConditionDef[] = [
      { name: 'Surprised', clearsAtSceneEnd: true },
      { name: 'Bleeding' },
    ];

    const result = clearSceneEndConditions({ Surprised: 2, Bleeding: 1 }, definitions);

    expect(result.conditions).toEqual({ Surprised: 0, Bleeding: 1 });
    expect(result.clearedConditions).toBe(1);
    expect(result.clearedStacks).toBe(2);
  });

  it('advances critical healing separately by one day', () => {
    const criticals: Critical[] = [
      { loc: 'Head', roll: 4, name: 'Cut', effect: 'Painful.', days: 1 },
      { loc: 'Body', roll: 50, name: 'Bruise', effect: 'Tender.', days: 3 },
    ];

    const result = advanceCriticalHealingDay(criticals);

    expect(result.healed).toBe(1);
    expect(result.criticals).toEqual([
      { loc: 'Body', roll: 50, name: 'Bruise', effect: 'Tender.', days: 2 },
    ]);
  });
});
