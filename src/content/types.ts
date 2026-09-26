// Content type definitions and the ContentPack envelope.
//
// Game content — spells, prayers, rules tables, races, careers, skills,
// talents, items — is projected from the shared web catalogue by bundled.ts.
// Native engine defaults and old saved-spell ids stay under src/content/packs.
// Screens read the merged ContentRegistry through useContent hooks.

import type { CharacteristicKey } from '@/data/character';

/** Provenance and completeness of a catalogue entry's rule detail. */
export interface SourceMetadata {
  sourceBook?: string;
  sourcePage?: number;
  rulesStatus?: 'bibliographic' | 'approximate';
  rulesNote?: string;
}

export interface Spell extends SourceMetadata {
  id: string;
  name: string;
  lore: string;
  /** Casting Number: target SL to reach. Null is unknown for an indexed entry. */
  cn: number | null;
  range: string;
  target: string;
  duration: string;
  description: string;
  /** Damage formula when the spell hits something. Optional. */
  damage?: string;
}

export interface Prayer extends SourceMetadata {
  id: string;
  name: string;
  deity: string;
  range: string;
  target: string;
  duration: string;
  description: string;
  type?: 'blessing' | 'miracle';
}

/** One d100 outcome band: a roll in [min, max] yields `effect`. */
export interface RollTableRow {
  min: number;
  max: number;
  effect: string;
}

export interface RollTable extends SourceMetadata {
  id: string;
  name: string;
  rows: RollTableRow[];
}

export interface XpCostRow {
  range: string;
  cost: number;
}

export interface Race extends SourceMetadata {
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

export interface Career extends SourceMetadata {
  id: string;
  name: string;
  class: string;
  /** Race IDs eligible to take this career. */
  species: string[];
  ranks: CareerRankDef[];
  approximate?: boolean;
  creationAvailable?: boolean;
  randomEligible?: boolean;
  magicAccess?: 'none' | 'starting' | 'later';
}

export interface SkillDef extends SourceMetadata {
  id: string;
  name: string;
  char: CharacteristicKey;
  advanced: boolean;
  grouped: boolean;
  description: string;
  restriction?: string;
  exclusiveWith?: string[];
}

export interface TalentDef extends SourceMetadata {
  id: string;
  name: string;
  description: string;
  max?: number;
  maxChar?: CharacteristicKey;
  tests?: string;
  specializations?: string[];
  restriction?: string;
}

/** Searchable material that does not alter the native rules engine. */
export interface ReferenceDef extends SourceMetadata {
  id: string;
  category: string;
  name: string;
  meta?: string;
  description: string;
  approximate?: boolean;
}

export interface WeaponDef extends SourceMetadata {
  id: string;
  name: string;
  group: string;
  enc: number;
  reach?: string;
  range?: string;
  dmg: string;
  qual: string[];
}

export interface ArmourDef extends SourceMetadata {
  id: string;
  name: string;
  locs: string[];
  enc: number;
  ap: number;
  qual: string[];
}

export interface TrappingDef extends SourceMetadata {
  id: string;
  name: string;
  enc: number;
}

/** Schema tag every ContentPack JSON file must carry. */
export const CONTENT_SCHEMA = 'grimcomp.content.v1';

/**
 * A unit of loadable native game content. Bundled catalogue projections and
 * native rules use this same envelope. User packs live under `gc.content.packs`.
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
  references?: ReferenceDef[];
  weapons?: WeaponDef[];
  armour?: ArmourDef[];
  trappings?: TrappingDef[];
}
