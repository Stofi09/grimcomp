// Content type definitions and the ContentPack envelope.
//
// Game content — spells, prayers, rules tables, races, careers, skills,
// talents, items — is authored as JSON ContentPacks under src/content/packs and
// merged at runtime by the ContentRegistry. Screens read content through the
// useContent hooks, never by importing a pack directly.

import type { CharacteristicKey } from '@/data/character';

export interface Spell {
  id: string;
  name: string;
  lore: string;
  /** Casting Number: target SL to reach. */
  cn: number;
  range: string;
  target: string;
  duration: string;
  description: string;
  /** Damage formula when the spell hits something. Optional. */
  damage?: string;
}

export interface Prayer {
  id: string;
  name: string;
  deity: string;
  range: string;
  target: string;
  duration: string;
  description: string;
}

/** One d100 outcome band: a roll in [min, max] yields `effect`. */
export interface RollTableRow {
  min: number;
  max: number;
  effect: string;
}

export interface RollTable {
  id: string;
  name: string;
  rows: RollTableRow[];
}

export interface XpCostRow {
  range: string;
  cost: number;
}

export interface Race {
  id: string;
  name: string;
  /** Flat modifiers applied to rolled starting characteristic values. */
  charModifiers: Partial<Record<CharacteristicKey, number>>;
  /** Size band. "Small" species (Halflings) omit SB from their Wounds. */
  size?: string;
  movement: number;
  fate: number;
  resilience: number;
  /** Fate / Resilience points the player allocates freely at creation. */
  extra: number;
  /** Skill IDs the race grants. */
  skills: string[];
  /** Talent IDs the race grants. */
  talents: string[];
  description: string;
}

export interface CareerRankDef {
  level: number;
  name: string;
  status: string;
}

export interface Career {
  id: string;
  name: string;
  class: string;
  /** Race IDs eligible to take this career. */
  species: string[];
  ranks: CareerRankDef[];
}

export interface SkillDef {
  id: string;
  name: string;
  char: CharacteristicKey;
  advanced: boolean;
  grouped: boolean;
  description: string;
}

export interface TalentDef {
  id: string;
  name: string;
  description: string;
}

export interface WeaponDef {
  id: string;
  name: string;
  group: string;
  enc: number;
  reach?: string;
  range?: string;
  dmg: string;
  qual: string[];
}

export interface ArmourDef {
  id: string;
  name: string;
  locs: string[];
  enc: number;
  ap: number;
  qual: string[];
}

export interface TrappingDef {
  id: string;
  name: string;
  enc: number;
}

/** Schema tag every ContentPack JSON file must carry. */
export const CONTENT_SCHEMA = 'grimcomp.content.v1';

/**
 * A unit of loadable game content. Bundled core packs live in
 * src/content/packs; user-imported packs are stored under `gc.content.packs`.
 * Every section is optional so a pack can carry just spells, just races, etc.
 */
export interface ContentPack {
  $schema: string;
  id: string;
  name: string;
  version: string;
  spells?: Spell[];
  prayers?: Prayer[];
  tables?: RollTable[];
  conditions?: string[];
  xpCosts?: XpCostRow[];
  races?: Race[];
  careers?: Career[];
  skills?: SkillDef[];
  talents?: TalentDef[];
  weapons?: WeaponDef[];
  armour?: ArmourDef[];
  trappings?: TrappingDef[];
}
