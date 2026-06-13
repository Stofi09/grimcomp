// Typed hooks for reading game content. Screens use these instead of importing
// content packs or the registry directly.

import { useContext } from 'react';
import { ContentContext } from './ContentProvider';
import type { ContentRegistry } from './registry';
import type {
  Spell, Prayer, RollTable, XpCostRow, XpRules,
  Race, Career, SkillDef, TalentDef, WeaponDef, ArmourDef, TrappingDef,
  ConditionDef, CharacteristicDef, CreationConfig, HitLocationRow,
  HitLocationKey, CriticalDef, WoundsRules, Deity, SystemRules,
} from './types';

export function useContent(): ContentRegistry {
  return useContext(ContentContext);
}

export function useResolveSpells(ids: string[]): Spell[] {
  return useContent().resolveSpells(ids);
}

export function useResolvePrayers(ids: string[]): Prayer[] {
  return useContent().resolvePrayers(ids);
}

export function useTable(id: string): RollTable | undefined {
  return useContent().getTable(id);
}

export function useConditionList(): ConditionDef[] {
  return useContent().conditions;
}

/**
 * Legacy view of the characteristic-advance ladder as v1 `{ range, cost }`
 * rows. Backed by the structured xpRules so callers still on the old shape
 * keep working. `999` upper bounds render as "N+".
 */
export function useXpCosts(): XpCostRow[] {
  const bands = useContent().xpRules.characteristicAdvances;
  return bands.map(b => ({
    range: b.max >= 999 ? `${b.min}+` : `${b.min}–${b.max}`,
    cost: b.cost,
  }));
}

export function useRaces(): Race[] {
  return useContent().allRaces;
}

export function useCareers(): Career[] {
  return useContent().allCareers;
}

export function useSkillDefs(): SkillDef[] {
  return useContent().allSkillDefs;
}

export function useTalentDefs(): TalentDef[] {
  return useContent().allTalentDefs;
}

export function useWeapons(): WeaponDef[] {
  return useContent().allWeapons;
}

export function useArmour(): ArmourDef[] {
  return useContent().allArmour;
}

export function useTrappings(): TrappingDef[] {
  return useContent().allTrappings;
}

// --- v2 config singletons + new entities ---

export function useXpRules(): XpRules {
  return useContent().xpRules;
}

/** The resolved game-system mechanics (dice, formulas, currency, bindings). */
export function useSystemRules(): SystemRules {
  return useContent().system;
}

export function useCreation(): CreationConfig | undefined {
  return useContent().creation;
}

export function useHitLocations(): HitLocationRow[] {
  return useContent().hitLocations;
}

export function useDeities(): Deity[] {
  return useContent().allDeities;
}

export function useCriticals(): CriticalDef[] {
  return useContent().criticals;
}

export function useWoundsRules(): WoundsRules {
  return useContent().woundsRules;
}

export function useCharacteristicDefs(): CharacteristicDef[] {
  return useContent().characteristics;
}

export function useNoteSeeds() {
  return useContent().noteSeeds;
}

export function useFigureLabels(): Partial<Record<HitLocationKey, string>> {
  return useContent().figureLabels;
}
