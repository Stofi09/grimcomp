// The web catalogue is the single source for bundled reference entities. Native
// keeps its v1 engine configuration and storage envelope; importing the web
// engine or its v2 singleton configuration would change native game behaviour.
//
// Nothing here validates at import time: App imports this module before the
// storage gate renders, so a throw would crash launch with no recovery screen.
// The catalogue is projected on first use and failures are reported instead.

import coreRules from '../../web/public/content/core-rules.json';
import coreChaos from '../../web/public/content/core-chaos.json';
import coreRaces from '../../web/public/content/core-races.json';
import coreCareers from '../../web/public/content/core-careers.json';
import coreSkills from '../../web/public/content/core-skills.json';
import coreTalents from '../../web/public/content/core-talents.json';
import coreItems from '../../web/public/content/core-items.json';
import coreMagic from '../../web/public/content/core-magic.json';
import windsOfMagic from '../../web/public/content/winds-of-magic.json';
import coreFaith from '../../web/public/content/core-faith.json';
import nativeRules from './packs/core-rules.json';
import nativeMagic from './packs/core-magic.json';
import nativeSkills from './packs/core-skills.json';
import nativeTalents from './packs/core-talents.json';
import {
  CONTENT_SCHEMA,
  type ContentPack,
  type ReferenceDef,
  type SkillDef,
  type Spell,
  type TalentDef,
} from './types';
import { validatePack } from './validate';

const ENTITY_SECTIONS = [
  'spells', 'prayers', 'tables', 'races', 'careers', 'skills', 'talents',
  'weapons', 'armour', 'trappings', 'references',
] as const;

function object(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function objects(value: unknown, where: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${where} must be an array.`);
  return value.map((entry, index) => object(entry, `${where}[${index}]`));
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new Error(`${where} must be a string.`);
  return value;
}

function requiredInteger(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${where} must be an integer.`);
  return value;
}

function healingDays(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return `${value} healing ${value === 1 ? 'day' : 'days'}`;
}

/**
 * Display names for hit-location keys, taken from the pack itself: the d100
 * hit-location labels ("Left Arm"), else the figure captions ("L. ARM"), else
 * the key with underscores spaced out.
 */
function locationLabeller(raw: Record<string, unknown>): (key: string) => string {
  const labels = new Map<string, string>();
  const figureLabels = raw.figureLabels;
  if (typeof figureLabels === 'object' && figureLabels !== null && !Array.isArray(figureLabels)) {
    for (const [key, label] of Object.entries(figureLabels)) {
      if (typeof label === 'string' && label.trim()) labels.set(key, label.trim());
    }
  }
  if (Array.isArray(raw.hitLocations)) {
    for (const location of raw.hitLocations as unknown[]) {
      if (typeof location !== 'object' || location === null) continue;
      const { key, label } = location as Record<string, unknown>;
      if (typeof key === 'string' && typeof label === 'string' && label.trim()) labels.set(key, label.trim());
    }
  }
  return key => labels.get(key) ?? key.replace(/_/g, ' ');
}

/**
 * Critical wounds come from one coherent source. The per-location d100 tables
 * are what play uses; the flat `criticals` list is a legacy summary whose
 * names overlap the tables with different healing times, so it is shown only
 * for a pack that has no tables. Ids derive from the location and roll band,
 * so they stay stable if rows or tables are reordered.
 */
function criticalReferences(raw: Record<string, unknown>, packId: string): ReferenceDef[] {
  const tables = objects(raw.criticalTables, 'criticalTables');
  if (tables.length === 0) {
    return objects(raw.criticals, 'criticals').map((critical, index): ReferenceDef => ({
      id: `ref.${packId}.critical.${index}`,
      category: 'Critical Wounds',
      name: requiredString(critical.name, `criticals[${index}].name`),
      description: requiredString(critical.effect, `criticals[${index}].effect`),
      meta: healingDays(critical.days),
    }));
  }
  const labelFor = locationLabeller(raw);
  return tables.flatMap((table, tableIndex) => {
    const where = `criticalTables[${tableIndex}]`;
    const locations = table.locations;
    if (!Array.isArray(locations) || locations.length === 0
      || !locations.every(location => typeof location === 'string' && location.trim())) {
      throw new Error(`${where}.locations must be a nonempty array of location keys.`);
    }
    const locationKeys = locations as string[];
    const locationLabel = locationKeys.map(labelFor).join(' / ');
    return objects(table.rows, `${where}.rows`).map((row, rowIndex): ReferenceDef => {
      const rowWhere = `${where}.rows[${rowIndex}]`;
      const min = requiredInteger(row.min, `${rowWhere}.min`);
      const max = requiredInteger(row.max, `${rowWhere}.max`);
      return {
        id: `ref.${packId}.critical.${locationKeys.join('+')}.${min}-${max}`,
        category: 'Critical Wounds',
        name: requiredString(row.name, `${rowWhere}.name`),
        description: requiredString(row.effect, `${rowWhere}.effect`),
        meta: [locationLabel, min === max ? `${min}` : `${min}–${max}`, healingDays(row.days)]
          .filter(Boolean).join(' · '),
      };
    });
  });
}

/** Expose v2 descriptive sections as references, without connecting their rules
 * to the native conditions, critical-wound, or deity engines. */
function descriptiveReferences(raw: Record<string, unknown>): ReferenceDef[] {
  const packId = requiredString(raw.id, 'Pack id');
  const conditions = objects(raw.conditions, 'conditions').map((condition, index): ReferenceDef => ({
    id: `ref.${packId}.condition.${index}`,
    category: 'Conditions',
    name: requiredString(condition.name, `conditions[${index}].name`),
    description: requiredString(condition.description ?? '', `conditions[${index}].description`),
    meta: 'Bundled condition reference',
  }));
  const deities = objects(raw.deities, 'deities').map((deity, index): ReferenceDef => ({
    id: `ref.${packId}.deity.${requiredString(deity.id, `deities[${index}].id`)}`,
    category: 'Deities',
    name: requiredString(deity.name, `deities[${index}].name`),
    description: requiredString(deity.dogma, `deities[${index}].dogma`),
    meta: requiredString(deity.epithet, `deities[${index}].epithet`),
  }));
  return [...conditions, ...criticalReferences(raw, packId), ...deities];
}

/** Only for the app's bundled v2 catalogue, never a permissive v2 import path.
 * Runtime user imports continue to be checked against the native v1 schema. */
export function projectBundledPack(value: unknown): ContentPack {
  const raw = object(value, 'Bundled pack');
  if (raw.$schema !== 'grimcomp.content.v2') throw new Error('Bundled catalogue must use grimcomp.content.v2.');
  const projected: Record<string, unknown> = {
    $schema: CONTENT_SCHEMA,
    id: raw.id,
    name: raw.name,
    version: raw.version,
  };
  for (const section of ENTITY_SECTIONS) {
    if (raw[section] !== undefined) projected[section] = raw[section];
  }
  const extraReferences = descriptiveReferences(raw);
  if (extraReferences.length) {
    projected.references = [...objects(raw.references, 'references'), ...extraReferences];
  }
  const { pack, errors } = validatePack(projected);
  if (!pack) throw new Error(`Invalid native catalogue projection: ${errors.slice(0, 3).join('; ')}`);
  return pack;
}

/** A bundled source that could not be loaded; empty for a healthy build. */
export interface BundledCatalogueIssue {
  readonly source: string;
  readonly message: string;
}

export interface NativeLegacyLookups {
  readonly legacySpells: readonly Spell[];
  readonly legacySkills: readonly SkillDef[];
  readonly legacyTalents: readonly TalentDef[];
}

export interface BundledCatalogue {
  /** Successfully projected packs, in manifest (override) order. */
  readonly packs: readonly ContentPack[];
  readonly issues: readonly BundledCatalogueIssue[];
  readonly legacyLookups: NativeLegacyLookups;
}

const MAX_ISSUE_MESSAGE_LENGTH = 500;

function issueMessage(error: unknown): string {
  let message = 'Unknown failure';
  try { message = error instanceof Error ? error.message : String(error); }
  catch { /* keep the generic message */ }
  return message.slice(0, MAX_ISSUE_MESSAGE_LENGTH);
}

/**
 * The native engine configuration (conditions, XP costs) is not reference
 * data: it rides on the Core rules layer when that projects, and stands alone
 * when it does not, so a broken catalogue file can never disable XP spending.
 */
function withNativeEngineRules(pack: ContentPack | undefined): ContentPack {
  return {
    ...(pack ?? { $schema: CONTENT_SCHEMA, id: nativeRules.id, name: nativeRules.name, version: nativeRules.version }),
    conditions: nativeRules.conditions,
    xpCosts: nativeRules.xpCosts,
  };
}

const CATALOGUE_SOURCES: ReadonlyArray<readonly [string, unknown]> = [
  ['core-rules.json', coreRules],
  ['core-chaos.json', coreChaos],
  ['core-races.json', coreRaces],
  ['core-careers.json', coreCareers],
  ['core-skills.json', coreSkills],
  ['core-talents.json', coreTalents],
  ['core-items.json', coreItems],
  ['core-magic.json', coreMagic],
  ['winds-of-magic.json', windsOfMagic],
  ['core-faith.json', coreFaith],
];
const CORE_RULES_SOURCE = 'core-rules.json';

/** Kept in manifest order: the Winds of Magic entries override Core by id. */
export const BUNDLED_CATALOGUE_FILES: readonly string[] = CATALOGUE_SOURCES.map(([file]) => file);

function buildLegacyLookups(issues: BundledCatalogueIssue[]): NativeLegacyLookups {
  // Imported v1 races may grant these old skill ids. They remain lookup
  // fallbacks, not catalogue entries; validate the authored characteristic
  // keys once instead of asserting arbitrary strings.
  const validatedNativeSkills = validatePack(nativeSkills);
  if (!validatedNativeSkills.pack) {
    issues.push({
      source: 'native core-skills.json',
      message: issueMessage(`Invalid legacy native skills: ${validatedNativeSkills.errors.slice(0, 3).join('; ')}`),
    });
  }
  return {
    // Old m.* ids stay resolvable for saved characters without adding the
    // obsolete sample spell list to the shared catalogue or guessing new ids.
    legacySpells: nativeMagic.spells,
    legacySkills: validatedNativeSkills.pack?.skills ?? [],
    legacyTalents: nativeTalents.talents,
  };
}

/**
 * Project the bundled catalogue without ever throwing. A file that fails
 * validation is left out and reported, so one bad pack cannot crash launch
 * ahead of the storage-recovery gate; the native test suite requires `issues`
 * to be empty for the shipped catalogue.
 */
export function buildBundledCatalogue(
  sources: ReadonlyArray<readonly [string, unknown]> = CATALOGUE_SOURCES,
): BundledCatalogue {
  const packs: ContentPack[] = [];
  const issues: BundledCatalogueIssue[] = [];
  for (const [source, raw] of sources) {
    let projected: ContentPack | undefined;
    try {
      projected = projectBundledPack(raw);
    } catch (error) {
      issues.push({ source, message: issueMessage(error) });
    }
    if (source === CORE_RULES_SOURCE) packs.push(withNativeEngineRules(projected));
    else if (projected) packs.push(projected);
  }
  return { packs, issues, legacyLookups: buildLegacyLookups(issues) };
}

let loadedCatalogue: BundledCatalogue | null = null;

/** Built on first use (inside the content provider), then shared. */
export function loadBundledCatalogue(): BundledCatalogue {
  if (!loadedCatalogue) loadedCatalogue = buildBundledCatalogue();
  return loadedCatalogue;
}
