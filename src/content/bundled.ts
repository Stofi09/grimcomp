// The web catalogue is the single source for bundled reference entities. Native
// keeps its v1 engine configuration and storage envelope; importing the web
// engine or its v2 singleton configuration would change native game behaviour.

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
import { CONTENT_SCHEMA, type ContentPack, type ReferenceDef, type SkillDef } from './types';
import { validatePack } from './validate';

/** Kept in manifest order: the Winds of Magic entries override Core by id. */
export const BUNDLED_CATALOGUE_FILES = [
  'core-rules.json', 'core-chaos.json', 'core-races.json', 'core-careers.json',
  'core-skills.json', 'core-talents.json', 'core-items.json', 'core-magic.json',
  'winds-of-magic.json', 'core-faith.json',
] as const;

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

function optionalNumber(value: unknown, label: string): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value} ${label}` : '';
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
  const criticals = objects(raw.criticals, 'criticals').map((critical, index): ReferenceDef => ({
    id: `ref.${packId}.critical.${index}`,
    category: 'Critical Wounds',
    name: requiredString(critical.name, `criticals[${index}].name`),
    description: requiredString(critical.effect, `criticals[${index}].effect`),
    meta: optionalNumber(critical.days, 'healing days'),
  }));
  const criticalTables = objects(raw.criticalTables, 'criticalTables').flatMap((table, tableIndex) => {
    if (!Array.isArray(table.locations) || !table.locations.every(location => typeof location === 'string')) {
      throw new Error(`criticalTables[${tableIndex}].locations must be a string array.`);
    }
    const locations = table.locations.join(', ');
    return objects(table.rows, `criticalTables[${tableIndex}].rows`).map((row, rowIndex): ReferenceDef => ({
      id: `ref.${packId}.critical-table.${tableIndex}.${rowIndex}`,
      category: 'Critical Wounds',
      name: requiredString(row.name, `criticalTables[${tableIndex}].rows[${rowIndex}].name`),
      description: requiredString(row.effect, `criticalTables[${tableIndex}].rows[${rowIndex}].effect`),
      meta: [locations, `${row.min}–${row.max}`, optionalNumber(row.days, 'healing days')].filter(Boolean).join(' · '),
    }));
  });
  const deities = objects(raw.deities, 'deities').map((deity, index): ReferenceDef => ({
    id: `ref.${packId}.deity.${requiredString(deity.id, `deities[${index}].id`)}`,
    category: 'Deities',
    name: requiredString(deity.name, `deities[${index}].name`),
    description: requiredString(deity.dogma, `deities[${index}].dogma`),
    meta: requiredString(deity.epithet, `deities[${index}].epithet`),
  }));
  return [...conditions, ...criticals, ...criticalTables, ...deities];
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
  if (!pack) throw new Error(`Invalid native catalogue projection: ${errors.join('; ')}`);
  return pack;
}

export const BUNDLED_PACKS: ContentPack[] = [
  {
    ...projectBundledPack(coreRules),
    conditions: nativeRules.conditions,
    xpCosts: nativeRules.xpCosts,
  },
  ...[coreChaos, coreRaces, coreCareers, coreSkills, coreTalents, coreItems,
    coreMagic, windsOfMagic, coreFaith].map(projectBundledPack),
];

/** Old m.* ids remain resolvable for saved characters without adding the
 * obsolete sample spell list to the shared catalogue or guessing new ids. */
export const LEGACY_NATIVE_SPELLS = nativeMagic.spells;

/** Imported v1 races may grant these old ids. They remain lookup fallbacks,
 * not additional entries in the shared catalogue. Validate the authored native
 * skill keys once instead of asserting arbitrary strings as characteristics. */
const validatedNativeSkills = validatePack(nativeSkills);
if (!validatedNativeSkills.pack) throw new Error(`Invalid legacy native skills: ${validatedNativeSkills.errors.join('; ')}`);
export const LEGACY_NATIVE_SKILLS: readonly SkillDef[] = validatedNativeSkills.pack.skills ?? [];
export const LEGACY_NATIVE_TALENTS = nativeTalents.talents;
