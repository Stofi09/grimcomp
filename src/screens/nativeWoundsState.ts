import type { Critical } from '@/data/character';

export type NativeConditionMap = Record<string, number>;

type SyncFunctionalUpdate<T> = (update: (previous: T) => T) => unknown;

export interface NativeEndOfSceneBindings {
  /** These bindings must resolve their functional updaters synchronously. */
  readonly refreshFortune: () => unknown;
  readonly replaceCriticals: SyncFunctionalUpdate<Critical[]>;
  readonly updateConditions: SyncFunctionalUpdate<NativeConditionMap>;
}

export interface NativeEndOfSceneSummary {
  readonly healed: number;
  readonly removedConditions: number;
}

/**
 * Compose the native end-of-scene state changes. Call this inside one
 * `runStoredTransaction` so Fortune, criticals, and conditions share a journal.
 */
export function applyNativeEndOfSceneUpdates(
  bindings: NativeEndOfSceneBindings,
): NativeEndOfSceneSummary {
  let healed = 0;
  let removedConditions = 0;

  bindings.refreshFortune();
  bindings.replaceCriticals((current) => {
    const next = current
      .map(critical => ({ ...critical, days: Math.max(0, critical.days - 1) }))
      .filter(critical => critical.days > 0);
    healed = current.length - next.length;
    return next;
  });
  bindings.updateConditions((previous) => {
    const next: NativeConditionMap = { ...previous };
    for (const name of Object.keys(next)) {
      const stacks = next[name] ?? 0;
      if (stacks <= 0) continue;
      const decrement = name === 'Surprised' ? stacks : 1;
      const remaining = Math.max(0, stacks - decrement);
      if (remaining === 0) removedConditions += 1;
      next[name] = remaining;
    }
    return next;
  });

  return { healed, removedConditions };
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
