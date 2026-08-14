import type { ConditionDef } from '@/content/types';
import type { Critical } from '@/data/character';

export interface SceneEndConditionsResult {
  conditions: Record<string, number>;
  clearedConditions: number;
  clearedStacks: number;
}

/** Clear only conditions whose loaded rule explicitly uses the scene clock. */
export function clearSceneEndConditions(
  current: Record<string, number>,
  definitions: ConditionDef[],
): SceneEndConditionsResult {
  const conditions = { ...current };
  let clearedConditions = 0;
  let clearedStacks = 0;

  for (const definition of definitions) {
    if (!definition.clearsAtSceneEnd) continue;
    const stacks = Math.max(0, conditions[definition.name] ?? 0);
    if (stacks === 0) continue;
    conditions[definition.name] = 0;
    clearedConditions += 1;
    clearedStacks += stacks;
  }

  return { conditions, clearedConditions, clearedStacks };
}

export interface HealingDayResult {
  criticals: Critical[];
  healed: number;
}

/** Advance the day-based healing clock without touching scene/session state. */
export function advanceCriticalHealingDay(current: Critical[]): HealingDayResult {
  const criticals = current
    .map(critical => ({ ...critical, days: Math.max(0, critical.days - 1) }))
    .filter(critical => critical.days > 0);
  return { criticals, healed: current.length - criticals.length };
}
