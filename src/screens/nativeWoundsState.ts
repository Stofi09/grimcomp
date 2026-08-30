import type { Critical } from '@/data/character';

export type NativeConditionMap = Record<string, number>;

export interface NativeSceneEndResult {
  readonly conditions: NativeConditionMap;
  readonly clearedConditions: number;
  readonly clearedStacks: number;
}

/**
 * Clear only conditions whose native rules use the scene clock. Fortune uses
 * the session clock, while critical healing uses the day clock, so neither is
 * part of this transition.
 */
export function clearNativeSceneEndConditions(
  current: NativeConditionMap,
): NativeSceneEndResult {
  const conditions = { ...current };
  const surprisedStacks = Math.max(0, conditions.Surprised ?? 0);
  if (surprisedStacks === 0) {
    return { conditions, clearedConditions: 0, clearedStacks: 0 };
  }
  conditions.Surprised = 0;
  return { conditions, clearedConditions: 1, clearedStacks: surprisedStacks };
}

export interface NativeHealingDayResult {
  readonly criticals: Critical[];
  readonly healed: number;
}

/** Advance day-based critical healing without touching scene/session state. */
export function advanceNativeCriticalHealingDay(
  current: readonly Critical[],
): NativeHealingDayResult {
  const criticals = current
    .map(critical => ({ ...critical, days: Math.max(0, critical.days - 1) }))
    .filter(critical => critical.days > 0);
  return { criticals, healed: current.length - criticals.length };
}

function sameCritical(left: Critical, right: Critical): boolean {
  return (
    left.loc === right.loc
    && left.roll === right.roll
    && left.name === right.name
    && left.effect === right.effect
    && left.days === right.days
  );
}

export interface LocatedCriticalOccurrence {
  readonly critical: Critical;
  readonly occurrence: number;
}

/** Identify the selected value by its occurrence among otherwise equal wounds. */
export function locateCriticalOccurrence(
  criticals: readonly Critical[],
  index: number,
): LocatedCriticalOccurrence | null {
  const critical = criticals[index];
  if (!critical) return null;
  const occurrence = criticals
    .slice(0, index)
    .filter(candidate => sameCritical(candidate, critical)).length;
  return { critical, occurrence };
}

export interface CriticalRemovalResult {
  readonly criticals: Critical[];
  readonly removed: boolean;
}

/** Remove exactly one matching occurrence, never every structurally equal wound. */
export function removeCriticalOccurrence(
  criticals: readonly Critical[],
  target: Critical,
  occurrence: number,
): CriticalRemovalResult {
  if (!Number.isSafeInteger(occurrence) || occurrence < 0) {
    return { criticals: [...criticals], removed: false };
  }

  let seen = 0;
  let removed = false;
  const remaining = criticals.filter((candidate) => {
    if (!sameCritical(candidate, target)) return true;
    if (seen++ !== occurrence) return true;
    removed = true;
    return false;
  });
  return { criticals: remaining, removed };
}
