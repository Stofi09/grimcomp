import type { Critical } from '@/data/character';
import type { CriticalDef } from '@/content/types';

export function isConditionEffects(value: unknown): value is Record<string, number> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([name, stacks]) => name.trim().length > 0
      && name.length <= 100 && typeof stacks === 'number' && Number.isSafeInteger(stacks) && stacks > 0 && stacks <= 100);
}

export function criticalFromDefinition(definition: CriticalDef, loc: string, roll: number): Critical {
  return { loc, roll, name: definition.name, effect: definition.effect, days: definition.days,
    ...(definition.conditions ? { conditions: { ...definition.conditions } } : {}) };
}

/** Only authored immediate effects are automated; never infer rules from prose. */
export function addCriticalConditions(current: Record<string, number>, effects: Record<string, number> = {}) {
  const next = { ...current };
  for (const [name, stacks] of Object.entries(effects)) next[name] = (next[name] ?? 0) + stacks;
  return next;
}

export function criticalEffectNotice(critical: Critical): string {
  const effects = Object.entries(critical.conditions ?? {});
  return effects.length > 0
    ? `Conditions applied: ${effects.map(([name, stacks]) => `${name} ×${stacks}`).join(', ')}. Resolve any other effects as described.`
    : 'Resolve these effects manually; no automatic conditions are defined.';
}
