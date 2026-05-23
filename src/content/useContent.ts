// Typed hooks for reading game content. Screens use these instead of importing
// content packs or the registry directly.

import { useContext } from 'react';
import { ContentContext } from './ContentProvider';
import type { ContentRegistry } from './registry';
import type {
  Spell, Prayer, RollTable, XpCostRow,
  Race, Career, SkillDef, TalentDef, WeaponDef, ArmourDef, TrappingDef,
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

export function useConditionList(): string[] {
  return useContent().conditions;
}

export function useXpCosts(): XpCostRow[] {
  return useContent().xpCosts;
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
