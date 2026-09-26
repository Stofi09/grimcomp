// Content type definitions and the ContentPack envelope (schema v2).
//
// Game content — spells, prayers, rules tables, races, careers, skills,
// talents, items, XP economy, character templates — is authored as JSON
// ContentPacks under public/content and fetched at runtime by the loader.
// Screens read content through the useContent hooks, never by importing a
// pack directly.

import type { Character, CharacteristicKey, XpKind } from '@/data/character';

/** A dice expression: roll `count` dice of `sides` faces and sum them. */
export interface DiceSpec {
  count: number;
  sides: number;
}

/**
 * How a test roll is judged against its target. The WFRP 4e defaults live in
 * DEFAULT_TEST_RULES (utils/roll.ts); packs overlay any subset via `system.test`.
 */
export interface TestRules {
  /** The test dice (1d100 in WFRP, 1d20 in d20 systems). */
  dice: DiceSpec;
  /** 'under': pass when roll ≤ target. 'over': pass when roll ≥ target. */
  direction: 'under' | 'over';
  /** Raw-roll band that always succeeds, regardless of target (1–5 in WFRP). */
  autoSuccess?: { min: number; max: number };
  /** Raw-roll band that always fails (96–100 in WFRP). */
  autoFailure?: { min: number; max: number };
  /** Doubles (11, 22 … 99) upgrade success→crit / failure→fumble. d100 systems only. */
  doubles?: boolean;
  /** Success-level formula; vars: roll, target. Omit for systems without SL. */
  sl?: string;
  /** Clamp the effective target into this range before resolution. */
  targetClamp?: { min: number; max: number };
}

/**
 * Derived-stat formulas (see utils/formula.ts for the expression language).
 * Every formula receives the full characteristic set as vars — current value
 * by key ("s") and short name ("S"), bonus by key+"b" ("sb") and short+"B"
 * ("SB") — plus the extra vars documented per field.
 */
export interface DerivedFormulas {
  /** Characteristic bonus from its current value. Vars: value. */
  bonus: string;
  /** Maximum Wounds / HP. Extra vars: small (0/1), bonusRanks (ranks of woundsRules.bonusTalent). */
  maxWounds: string;
  /** Walk / run speeds. Extra var: m (the species' base Movement). */
  walk: string;
  run: string;
  /** Carrying capacity. */
  maxEncumbrance: string;
  /** Corruption threshold. */
  corruptionThreshold: string;
  /** Wounds recovered by the Rest quick-action. */
  restRecovery: string;
}

/** One coin denomination. `key` indexes Character.wealth; `factor` is its value in base units. */
export interface CurrencyUnit {
  key: string;
  label: string;
  factor: number;
}

export interface CurrencyRules {
  /** Denominations, largest first. */
  units: CurrencyUnit[];
  /** Display name of the base unit ("brass"). */
  baseLabel: string;
}

/** Names and table ids the Magic screen binds its mechanics to. */
export interface MagicRules {
  /** Skill-name prefix identifying the channelling skill ("Channelling"). */
  channellingSkillPrefix: string;
  /** Exact name of the casting skill ("Language (Magick)"). */
  castSkill: string;
  /** Characteristic keys the channel / cast targets build on. */
  channelChar: string;
  castChar: string;
  /** Roll-table ids for miscasts. */
  minorMiscastTable: string;
  majorMiscastTable: string;
}

/** Names and table ids the Faith screen binds its mechanics to. */
export interface FaithRules {
  praySkill: string;
  prayChar: string;
  wrathTable: string;
  /** Added to the wrath roll per Sin point. */
  wrathBonusPerSin: number;
}

/** How weapons map to test characteristics and skills on the Combat screen. */
export interface CombatRules {
  /** Bounded, safety-checked case-insensitive regex matched against the weapon group. */
  rangedGroupPattern: string;
  meleeChar: string;
  rangedChar: string;
  /** Skill-name templates; "{group}" is replaced with the weapon group. */
  meleeSkillPattern: string;
  rangedSkillPattern: string;
}

/** The full game-system mechanics config (resolved, after pack overlays). */
export interface SystemRules {
  test: TestRules;
  formulas: DerivedFormulas;
  currency: CurrencyRules;
  magic: MagicRules;
  faith: FaithRules;
  combat: CombatRules;
}

/** Pack-authored `system` section — each subsection overlays field-by-field. */
export interface SystemOverlay {
  test?: Partial<TestRules>;
  formulas?: Partial<DerivedFormulas>;
  currency?: Partial<CurrencyRules>;
  magic?: Partial<MagicRules>;
  faith?: Partial<FaithRules>;
  combat?: Partial<CombatRules>;
}

export interface Spell {
  id: string;
  name: string;
  lore: string;
  /** Casting Number: target SL to reach; null only for an index entry with an unknown CN. */
  cn: number | null;
  range: string;
  target: string;
  duration: string;
  description: string;
  /** Damage formula when the spell hits something. Optional. */
  damage?: string;
  /** Printed source title for provenance and rules lookup. */
  sourceBook?: string;
  /** Printed page number; 0 is accepted for unpaginated/front-matter references. */
  sourcePage?: number;
  /** Short clarification, erratum, or special handling shown with the spell. */
  rulesNote?: string;
  /** Confidence/scope of the bundled rules text; distinct from a per-spell note. */
  rulesStatus?: 'bibliographic' | 'approximate';
}

export interface Prayer {
  id: string;
  name: string;
  deity: string;
  range: string;
  target: string;
  duration: string;
  description: string;
  /**
   * WFRP 4e distinguishes Blessings (minor invocations — no Test, no Wrath) from
   * Miracles (a Pray Test that risks the Wrath of the Gods). Omit and the Faith
   * screen infers it: a deity-agnostic prayer (deity === creation.anyDeity) is a
   * Blessing, a deity-specific one is a Miracle.
   */
  type?: 'blessing' | 'miracle';
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
  /** Dice rolled on this table. Omitted = 1d100. */
  dice?: DiceSpec;
}

/** Legacy v1 XP-cost row ("0–5" → 25). Normalized into XpRules bands. */
export interface XpCostRow {
  range: string;
  cost: number;
}

/** One XP-cost band: buying an advance while you have [min, max] advances. */
export interface XpCostBand {
  min: number;
  max: number;
  cost: number;
}

/** The structured XP economy (replaces the v1 `xpCosts` table). */
export interface XpRules {
  /** Per-advance characteristic cost ladder, keyed by advances already bought. */
  characteristicAdvances: XpCostBand[];
  /** Per-advance skill cost ladder, keyed by advances already bought. */
  skillAdvances: XpCostBand[];
  /** Talent rank N costs N × this. */
  talentCostPerRank: number;
  /** XP to advance to the next rank of the current career. */
  careerAdvanceCost: number;
  /** Non-career skill advances cost this multiple of the listed rate. */
  nonCareerSkillMultiplier: number;
  /** Non-career characteristic advances cost this multiple of the listed rate
      (WFRP 4e: ×2). A characteristic is "in-career" when it's in the current
      career's advanceScheme. */
  nonCareerCharacteristicMultiplier: number;
  /** Quick-award buttons on the XP screen. */
  quickAwards: number[];
  /** Advances are bought in steps of this many points (+5). */
  buyStep: number;
}

/** A condition chip. v1 packs carried plain strings; those normalize to { name }. */
export interface ConditionDef {
  name: string;
  /** Test modifier per stack (e.g. -10). Omitted = no numeric penalty modelled. */
  penalty?: number;
  /** Maximum stack count cycled through on tap (default 2). */
  maxStacks?: number;
  /** One-line rule text. */
  description?: string;
  /** All stacks clear at end of scene. Omitted/false conditions are unchanged. */
  clearsAtSceneEnd?: boolean;
}

/** Roster entry for the 10 canonical characteristics, in canonical order. */
export interface CharacteristicDef {
  key: CharacteristicKey;
  name: string;
  short: string;
}

export type HitLocationKey = 'head' | 'body' | 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r';

/** One d100 hit-location band: a roll in [min, max] strikes `key`. */
export interface HitLocationRow {
  min: number;
  max: number;
  key: HitLocationKey;
  label: string;
}

/** Prefab critical injury rolled on the Wounds screen. */
export interface CriticalDef {
  name: string;
  effect: string;
  days: number;
  /** Immediate condition stacks added when this injury is inflicted. */
  conditions?: Record<string, number>;
}

/** One d100 band on a location-specific critical-wound table. */
export interface CriticalRow extends CriticalDef {
  min: number;
  max: number;
}

/**
 * A location-specific d100 critical-wound table (WFRP 4e CRB p.180+). One table
 * serves one or more hit locations — canonically Arms share a table and Legs
 * share a table, so `locations` lists every key it resolves. When present, a
 * critical at a struck location rolls on its table instead of drawing a random
 * `CriticalDef` prefab.
 */
export interface CriticalTableDef {
  locations: HitLocationKey[];
  rows: CriticalRow[];
}

export interface WoundsRules {
  /** Race size bands whose species omit SB from the Wounds total. */
  smallSizes: string[];
  /** Talent that adds TB to max Wounds per rank taken. */
  bonusTalent: string;
}

export interface Deity {
  id: string;
  name: string;
  epithet: string;
  dogma: string;
}

/** Archetype offered by the New Character wizard. */
export interface ArchetypeDef {
  key: string;
  label: string;
  blurb: string;
  /** Icon name rendered by the Icon component. */
  icon: string;
  /** Character template id to clone career, gear, and capabilities from. */
  templateId: string;
  /** Career id in the content pack — drives the species-eligibility check. */
  careerId: string;
  /** Avatar accent hex shown on the review step. */
  accent: string;
}

/** Character-creation configuration (singleton section, like xpRules). */
export interface CreationConfig {
  /** Starting characteristic generation: count d sides + plus (2d10 + 20). */
  statRoll: { count: number; sides: number; plus: number };
  archetypes: ArchetypeDef[];
  defaults: { species: string; archetype: string };
  /** Spell lore fresh casters keep from their template ("Petty"). */
  pettyLore: string;
  /** Prayer deity fresh priests keep from their template ("Any"). */
  anyDeity: string;
}

/** One XP-log line. Seeds ship with the core-characters pack. */
export interface XpEntry {
  date: string;
  reason: string;
  amount: number;
  kind: XpKind;
}

export interface NoteSeed {
  cat: string;
  title: string;
  src: 'official' | 'local';
  body: string;
}

export interface NoteOption {
  value: string;
  label: string;
}

/** Seed notes + the category/source pickers for the Notes screen. */
export interface NoteSeedsConfig {
  notes: NoteSeed[];
  categories: NoteOption[];
  srcOptions: NoteOption[];
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

/** Skill requirement for entering a career rank (display name + min advances). */
export interface CareerRankRequirement {
  skill: string;
  min: number;
}

export interface CareerRankDef {
  level: number;
  name: string;
  status: string;
  /**
   * Skill advances required to complete this rank. Omitted = requirements not
   * modelled for this rank; screens leave advancement unblocked in that case.
   */
  requirements?: CareerRankRequirement[];
}

/** The characteristics (and skills) a career advances — its advance scheme. A
    characteristic outside this set is a non-career advance and costs the
    xpRules.nonCareerCharacteristicMultiplier. Omit to model no scheme (every
    characteristic treated as in-career). */
export interface CareerAdvanceScheme {
  characteristics: CharacteristicKey[];
  /** Career-skill display names (informational; skill pricing keys off the
      character's own `career` flag today). */
  skills?: string[];
  /** Talents normally offered by this career. Names resolve against TalentDef. */
  talents?: string[];
}

export interface Career {
  id: string;
  name: string;
  class: string;
  /** Race IDs eligible to take this career. */
  species: string[];
  ranks: CareerRankDef[];
  advanceScheme?: CareerAdvanceScheme;
  /** True when missing rulebook details were filled with bundled fallbacks. */
  approximate?: boolean;
  /** Printed source title for provenance and rules lookup. */
  sourceBook?: string;
  /** Printed page number; 0 is accepted for unpaginated/front-matter references. */
  sourcePage?: number;
  /** Short clarification or special handling shown with the Career. */
  rulesNote?: string;
  /** Confidence/scope of the bundled rules detail; distinct from a Career-specific note. */
  rulesStatus?: 'bibliographic' | 'approximate';
  /** False when the Career is reference-only and cannot start a new character. */
  creationAvailable?: boolean;
  /** False when random creation must not select the Career directly. */
  randomEligible?: boolean;
  /** Whether this Career grants magical ability immediately, later, or never. */
  magicAccess?: 'none' | 'starting' | 'later';
}

export interface SkillDef {
  id: string;
  name: string;
  char: CharacteristicKey;
  advanced: boolean;
  grouped: boolean;
  description: string;
  /** Printed source title for provenance and rules lookup. */
  sourceBook?: string;
  /** Printed page number; 0 is accepted for unpaginated/front-matter references. */
  sourcePage?: number;
  /** Short clarification, access restriction, or special handling shown with the skill. */
  rulesNote?: string;
  /** Eligibility restriction shown alongside the skill's rules metadata. */
  restriction?: string;
  /** Stable SkillDef ids that cannot be owned alongside this definition. */
  exclusiveWith?: string[];
  /** Confidence/scope of the bundled rules text; distinct from a per-skill note. */
  rulesStatus?: 'bibliographic' | 'approximate';
}

export interface TalentDef {
  id: string;
  name: string;
  description: string;
  /** Hard cap on ranks (WFRP 4e "Max"). Wins over maxChar when both are set. */
  max?: number;
  /** The characteristic whose Bonus caps ranks (e.g. Hardy → Toughness Bonus).
      Used when `max` is absent. Omit both for a talent with no listed cap. */
  maxChar?: CharacteristicKey;
  /** Printed Tests line, when the talent has one (for example "See text"). */
  tests?: string;
  /** Canonical choices required when acquiring a parameterised talent. */
  specializations?: string[];
  /** Printed source title for provenance and rules lookup. */
  sourceBook?: string;
  /** Printed page number; 0 is accepted for unpaginated/front-matter references. */
  sourcePage?: number;
  /** Short access restriction or handling note shown with the talent. */
  rulesNote?: string;
  /** Eligibility restriction shown before acquisition; it is not engine-enforced. */
  restriction?: string;
  /** Confidence/scope of the bundled rules text; distinct from a per-talent note. */
  rulesStatus?: 'bibliographic' | 'approximate';
}

/** A searchable rules/reference entry that does not need a dedicated mechanic. */
export interface ReferenceDef {
  id: string;
  category: string;
  name: string;
  meta?: string;
  description: string;
  /** Marks intentionally non-canonical or provisional companion material. */
  approximate?: boolean;
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

/** Schema tag every current ContentPack JSON file carries. */
export const CONTENT_SCHEMA = 'grimcomp.content.v2';

/** Legacy schema tag — still accepted; the validator normalizes v1 packs. */
export const CONTENT_SCHEMA_V1 = 'grimcomp.content.v1';

/** Schema tag of the pack manifest fetched from public/content/manifest.json. */
export const MANIFEST_SCHEMA = 'grimcomp.manifest.v1';

/**
 * Built-in screen component types a pack's `screens` may instantiate. A pack
 * chooses, orders, labels, groups, and gates these — it cannot inject arbitrary
 * React, so the set is fixed in code. (Runtime array so the validator can check
 * an authored `kind` against it.)
 */
export const SCREEN_KINDS = [
  'overview', 'characteristics', 'skills', 'talents', 'career', 'xp',
  'combat', 'wounds', 'magic', 'faith', 'trappings', 'psychology',
  'reference', 'notes', 'roster', 'settings', 'newchar', 'content',
] as const;
export type ScreenKind = typeof SCREEN_KINDS[number];

/**
 * Variables a screen's `enabledWhen` predicate may reference. Kept small and
 * fixed on purpose: unknown identifiers evaluate to 0 (silently hiding a
 * screen), so the validator warns when a predicate references anything else.
 */
export const SCREEN_ENABLED_WHEN_VARS = ['isCaster', 'isAnointed', 'careerLevel'] as const;

/** One nav entry authored by a content pack. */
export interface ScreenDef {
  /** Stable id (storage key + route). Unique within the pack. */
  id: string;
  /** Which built-in screen component renders it. */
  kind: ScreenKind;
  label: string;
  /** Icon name; an unrecognised value falls back to a default glyph. */
  icon?: string;
  /** A screenGroups id; an unknown group lands in a trailing "More" section. */
  group: string;
  /** Formula over SCREEN_ENABLED_WHEN_VARS; omit to always show in the rail. */
  enabledWhen?: string;
  /** Reachable via onNav but not listed in the rail (like the New Character flow). */
  hideFromNav?: boolean;
  badge?: string;
}

/** A rail section header. Order here defines section order. */
export interface ScreenGroupDef {
  id: string;
  label: string;
}

/**
 * A tracked hero-resource pool (Fate/Fortune, Resilience/Resolve, Corruption in
 * WFRP — Sanity, Stress, spell slots, etc. in other systems). The set is
 * data-defined; `capBy`/`refreshTo` model the WFRP paired-pool mechanic where a
 * permanent pool caps a spendable one (Fortune ≤ Fate) that refreshes to it.
 */
export interface ResourceDef {
  id: string;
  label: string;
  /** Another resource id whose current value caps this one (e.g. Fortune ≤ Fate). */
  capBy?: string;
  /** What a "refresh" resets this resource to. 'cap' = its capBy pool's value. */
  refreshTo?: 'cap';
}

/**
 * Toggles for WFRP-specific sub-mechanics ("rituals"). Each defaults to on (the
 * WFRP behaviour); a pack sets one false to drop that mechanic while keeping the
 * screen — e.g. a magic system with spells but no Miscast-on-doubles. These are
 * SUBTRACTIVE: they hide/disable WFRP procedures, they don't synthesise new ones.
 */
export interface Capabilities {
  /** Faith: a Pray roll can trigger Wrath of the Gods (scaled by Sin). */
  faithWrath?: boolean;
  /** Magic: doubles on a channel/cast roll cause a Miscast. */
  magicMiscastOnDouble?: boolean;
  /** Combat: damage resolves against a hit-location table + per-location armour. */
  combatHitLocations?: boolean;
  /** Psychology: Corruption accrues toward a mutation threshold. */
  psychologyCorruption?: boolean;
}

/**
 * A unit of loadable game content. Bundled core packs live in public/content
 * (fetched at runtime); user-imported packs are stored under `gc.content.packs`.
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
  conditions?: ConditionDef[];
  /** Legacy v1 section — normalized into xpRules.characteristicAdvances. */
  xpCosts?: XpCostRow[];
  /** Partial overlay onto the XP economy (missing fields keep prior values). */
  xpRules?: Partial<XpRules>;
  /** Partial overlay onto the game-system mechanics (dice, formulas, bindings). */
  system?: SystemOverlay;
  characteristics?: CharacteristicDef[];
  races?: Race[];
  careers?: Career[];
  skills?: SkillDef[];
  talents?: TalentDef[];
  references?: ReferenceDef[];
  weapons?: WeaponDef[];
  armour?: ArmourDef[];
  trappings?: TrappingDef[];
  hitLocations?: HitLocationRow[];
  figureLabels?: Partial<Record<HitLocationKey, string>>;
  criticals?: CriticalDef[];
  /** Location-specific d100 critical tables. When present, a critical at a
      struck location rolls on its table; `criticals` is the flat fallback. */
  criticalTables?: CriticalTableDef[];
  woundsRules?: WoundsRules;
  deities?: Deity[];
  creation?: CreationConfig;
  characters?: Character[];
  xpLogSeeds?: Record<string, XpEntry[]>;
  noteSeeds?: NoteSeedsConfig;
  /** Pack-authored navigation: which screens exist, their order/labels/icons/
      grouping/gating. Omit to use the built-in WFRP nav unchanged. */
  screens?: ScreenDef[];
  screenGroups?: ScreenGroupDef[];
  /** Tracked hero-resource pools. Omit to use the built-in WFRP set
      (Fate/Fortune, Resilience/Resolve, Corruption). */
  resources?: ResourceDef[];
  /** Toggle WFRP sub-mechanics off (all default on). Overlaid field-by-field. */
  capabilities?: Capabilities;
  /** Tombstones: per id-keyed section, ids to REMOVE after all packs merge.
      Lets a user pack delete a bundled entry (the merge is otherwise additive). */
  deletions?: Partial<Record<string, string[]>>;
}

/** The id-keyed entity sections the in-app content editor can create/edit/delete. */
export const EDITABLE_SECTIONS = [
  'spells', 'prayers', 'races', 'careers', 'skills', 'talents',
  'weapons', 'armour', 'trappings', 'deities', 'references', 'tables',
] as const;
export type EditableSection = typeof EDITABLE_SECTIONS[number];

/** Pack id reserved for edits made in-app via the Content screen. */
export const USER_EDITS_PACK_ID = 'user-edits';

/** Shape of public/content/manifest.json. */
export interface ContentManifest {
  $schema: string;
  packs: string[];
}
