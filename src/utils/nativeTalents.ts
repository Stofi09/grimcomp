// Talent rank caps for the native app, ported from the web engine
// (web/src/utils/advancement.ts talentMaxRank and the bounded name lookup in
// web/src/utils/talents.ts) without importing web modules into native.
// Native characters record talents by display name only, so the catalogue
// definition is resolved from that name.

import type { CharacteristicKey } from '../data/character';
import type { TalentDef } from '../content/types';

/**
 * The maximum number of ranks a talent may be taken (WFRP 4e p.135). A flat
 * `max` wins; otherwise the Bonus of the talent's `maxChar`; otherwise
 * undefined (no listed cap). Never below 1, matching the web engine.
 */
export function talentMaxRank(
  definition: Pick<TalentDef, 'max' | 'maxChar'> | undefined,
  bonusFor: (key: CharacteristicKey) => number,
): number | undefined {
  if (!definition) return undefined;
  if (typeof definition.max === 'number') return Math.max(1, Math.floor(definition.max));
  if (definition.maxChar) return Math.max(1, Math.floor(bonusFor(definition.maxChar)));
  return undefined;
}

const normalized = (value: string): string => value.trim().toLowerCase();

/** "Name (Choice)" with one trailing, unnested group, else null. */
function splitTrailingChoice(name: string): { base: string; choice: string } | null {
  const trimmed = name.trim();
  if (!trimmed.endsWith(')')) return null;
  const open = trimmed.lastIndexOf('(');
  if (open <= 0) return null;
  const choice = trimmed.slice(open + 1, -1).trim();
  if (!choice || choice.includes('(') || choice.includes(')')) return null;
  const base = trimmed.slice(0, open).trimEnd();
  return base ? { base, choice } : null;
}

/** Whether `name` is a concrete choice of `definition`, as the web resolver allows. */
function namesSpecialization(definition: TalentDef, name: string): boolean {
  const target = normalized(name);
  const marker = splitTrailingChoice(definition.name);
  const base = marker ? marker.base : definition.name;
  for (const specialization of definition.specializations ?? []) {
    // A generalized heading ("Acute Sense (Sense)") displays as "Acute Sense Sight".
    const display = marker ? `${base} ${specialization}` : `${definition.name} (${specialization})`;
    if (normalized(display) === target || normalized(`${base} (${specialization})`) === target) return true;
  }
  if (definition.specializations?.length) return false;
  const choice = splitTrailingChoice(name);
  return choice !== null && normalized(choice.base) === normalized(definition.name);
}

/** Exact definition name first, then case-insensitive, then a bounded choice form. */
export function talentDefinitionForName(
  definitions: readonly TalentDef[],
  name: string,
): TalentDef | undefined {
  return definitions.find(definition => definition.name === name)
    ?? definitions.find(definition => normalized(definition.name) === normalized(name))
    ?? definitions.find(definition => namesSpecialization(definition, name));
}

export type TalentRankIncrement =
  | { readonly ok: true; readonly times: Record<string, number>; readonly rank: number }
  | { readonly ok: false; readonly times: Record<string, number>; readonly max: number };

/**
 * One more rank of `name`, unless its cap is reached. `fallbackTimes` is the
 * character template's rank for a talent absent from the stored map, so a
 * purchase continues from the rank the sheet displays.
 */
export function incrementTalentRank(
  times: Record<string, number>,
  name: string,
  fallbackTimes: number,
  max: number | undefined,
): TalentRankIncrement {
  const current = Object.prototype.hasOwnProperty.call(times, name) ? times[name] : fallbackTimes;
  if (max !== undefined && current >= max) return { ok: false, times, max };
  return { ok: true, times: { ...times, [name]: current + 1 }, rank: current + 1 };
}
