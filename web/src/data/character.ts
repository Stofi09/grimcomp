// Character data — TYPES and helpers only. The full character templates,
// XP-log seeds, condition tables, and small-species rules now live in JSON
// content packs (public/content) and are read through the ContentRegistry.
// This module is the source of truth for the shapes those packs author against
// and that every per-character hook consumes.

// Characteristic keys are open strings: the roster (names, shorts, order) is
// defined by the content packs' `characteristics` section, so a pack can ship
// any stat set — WFRP's ws/bs/s/t…, a d20 game's str/dex/con…, or anything else.
export type CharacteristicKey = string;

export interface Characteristic {
  key: CharacteristicKey;
  name: string;
  short: string;
  init: number;
  adv: number;
}

export interface Skill {
  name: string;
  char: CharacteristicKey;
  adv: number;
  career: boolean;
  advanced?: boolean;
  grouped?: string;
}

export interface Talent {
  name: string;
  times: number;
  desc: string;
  career: boolean;
}

export interface Weapon {
  name: string;
  group: string;
  enc: number;
  reach?: string;
  range?: string;
  dmg: string;
  qual: string[];
}

export interface Armour {
  name: string;
  locs: string[];
  enc: number;
  ap: number;
  qual: string[];
}

export interface Critical {
  loc: string;
  roll: number;
  name: string;
  effect: string;
  days: number;
}

export interface Trapping {
  name: string;
  enc: number;
}

// Class / career rank progression used by useCareer to render path and
// status pills. Each character's class defines its 4-rank progression.
export interface CareerRank {
  level: number;
  name: string;
  status: string;
}

export interface Character {
  id: string;
  name: string;
  species: string;
  class: string;
  career: string;             // currently-occupied career name
  careerLevel: number;
  careerLevelName: string;
  // 4-rank progression for this career (used by Career screen + useCareer).
  careerRanks: CareerRank[];
  status: string;
  age: number;
  height: string;
  hair: string;
  eyes: string;
  motivation: string;
  fate: number;
  fortune: number;
  resilience: number;
  resolve: number;
  xpCurrent: number;
  xpSpent: number;
  wounds: { current: number; max: number };
  corruption: number;
  sin: number;
  movement: number;
  /** Coin per denomination, keyed by the system currency units (gc/ss/d in WFRP). */
  wealth: Record<string, number>;
  characteristics: Characteristic[];
  skills: Skill[];
  talents: Talent[];
  weapons: Weapon[];
  armour: Armour[];
  ap: { head: number; arm_l: number; arm_r: number; body: number; leg_l: number; leg_r: number; shield: number };
  conditions: Array<{ type: string; stacks: number }>;
  criticals: Critical[];
  trappings: Trapping[];
  party: {
    name: string;
    short: string;
    members: Array<{ name: string; role: string }>;
  };
  psychology: string[];
  mutations: Array<{ name: string }>;
  ambitionsShort: string;
  ambitionsLong: string;
  initials: string;
  accent: string;
  isCaster?: boolean;          // toggles Magic screen content
  isAnointed?: boolean;        // toggles Faith screen content
  /** Spell IDs resolved against the content registry (caster characters only). */
  knownSpells?: string[];
  /** Prayer IDs resolved against the content registry (Anointed characters only). */
  knownPrayers?: string[];
  /** Display labels for the Faith / Magic screen banners. */
  deity?: string;
  spellLore?: string;
}

export type XpKind = 'gain' | 'skill' | 'char' | 'talent' | 'career';

export interface RosterEntry {
  id: string;
  name: string;
  career: string;
  level: number;
  species: string;
  status: string;
  wounds: string;
  xp: number;
  initials: string;
  accent: string;
  active?: boolean;
}

/** Fallback active-character id, used before the registry has loaded. */
export const FALLBACK_CHARACTER_ID = 'c1';

// Max Wounds is no longer computed here: the formula is system config
// (system.formulas.maxWounds in the content packs) evaluated by
// utils/formula.ts — see hooks/useDerived.ts for the live hook.
