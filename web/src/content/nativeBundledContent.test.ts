import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../../public/content/manifest.json';
import nativeRules from '../../../src/content/packs/core-rules.json';
import {
  BUNDLED_CATALOGUE_FILES,
  buildBundledCatalogue,
  loadBundledCatalogue,
  projectBundledPack,
} from '../../../src/content/bundled';
import { ContentRegistry } from '../../../src/content/registry';
import { CONTENT_SCHEMA, type ContentPack } from '../../../src/content/types';
import { validatePack } from '../../../src/content/validate';
import { isNativeCreationCareerAvailable, resolveNativeCreationCareer, resolveNativeRaceGrants } from '../../../src/content/creation';
import { buildNativeReferenceItems } from '../../../src/utils/nativeReferenceSearch';
import { CHARACTER_TEMPLATES } from '../../../src/data/character';
import { validateNativeStoredValue } from '../../../src/storage/nativeDataValidation';

type RawPack = Record<string, unknown>;
const catalogue = manifest.packs
  .filter(file => file !== 'core-creation.json' && file !== 'core-characters.json')
  .map(file => JSON.parse(readFileSync(new URL(`../../public/content/${file}`, import.meta.url), 'utf8')) as RawPack);
const bundledCatalogue = loadBundledCatalogue();
const BUNDLED_PACKS = [...bundledCatalogue.packs];
const legacyLookups = bundledCatalogue.legacyLookups;
const LEGACY_NATIVE_SPELLS = legacyLookups.legacySpells;
const registry = new ContentRegistry(BUNDLED_PACKS, legacyLookups);

function merged(section: string): unknown[] {
  const entries = new Map<string, unknown>();
  for (const pack of catalogue) {
    for (const entry of (pack[section] ?? []) as Array<{ id: string }>) entries.set(entry.id, entry);
  }
  return [...entries.values()];
}

describe('native bundled catalogue', () => {
  it('ships a catalogue that loads without a single projection issue', () => {
    // Projection no longer throws at import time, so this assertion is what
    // keeps a broken catalogue file from reaching a build.
    expect(bundledCatalogue.issues).toEqual([]);
    expect(loadBundledCatalogue()).toBe(bundledCatalogue);
    expect(legacyLookups.legacySkills.length).toBeGreaterThan(0);
  });

  it('isolates a catalogue file that fails projection instead of throwing', () => {
    const [coreRulesFile, ...rest] = catalogue;
    const broken = {
      $schema: 'grimcomp.content.v2', id: 'broken', name: 'Broken', version: '1',
      talents: [{ id: 'tal.broken', name: 'Broken', description: '', maxChar: 'invalid' }],
    };
    const result = buildBundledCatalogue([
      ['core-rules.json', coreRulesFile],
      ['broken.json', broken],
      ['core-chaos.json', rest[0]],
    ]);

    expect(result.packs.map(pack => pack.id)).toEqual(['core-rules', 'core-chaos']);
    expect(result.issues).toEqual([{ source: 'broken.json', message: expect.stringContaining('maxChar') }]);
  });

  it('keeps native engine rules when the Core rules file itself fails projection', () => {
    const result = buildBundledCatalogue([['core-rules.json', { $schema: 'grimcomp.content.v2' }]]);

    expect(result.issues).toEqual([expect.objectContaining({ source: 'core-rules.json' })]);
    expect(result.packs).toHaveLength(1);
    const engineOnly = new ContentRegistry([...result.packs]);
    expect(engineOnly.conditions).toEqual(nativeRules.conditions);
    expect(engineOnly.xpCosts).toEqual(nativeRules.xpCosts);
    expect(engineOnly.allSpells).toEqual([]);
  });

  it('projects every catalogue pack in the web manifest in the same override order', () => {
    expect(BUNDLED_CATALOGUE_FILES).toEqual(manifest.packs.filter(file =>
      file !== 'core-creation.json' && file !== 'core-characters.json'));
    expect(BUNDLED_PACKS.map(pack => pack.id)).toEqual(catalogue.map(pack => pack.id));
    for (const pack of BUNDLED_PACKS) {
      expect(validatePack(pack).errors, pack.id).toEqual([]);
      expect(pack.$schema).toBe(CONTENT_SCHEMA);
    }
  });

  it('exposes the same spell, prayer, skill, talent, career, race, and item entities as web', () => {
    expect(registry.allSpells).toEqual(merged('spells'));
    expect(registry.allPrayers).toEqual(merged('prayers'));
    expect(registry.allSkillDefs).toEqual(merged('skills'));
    expect(registry.allTalentDefs).toEqual(merged('talents'));
    expect(registry.allCareers).toEqual(merged('careers'));
    expect(registry.allRaces).toEqual(merged('races'));
    expect(registry.allWeapons).toEqual(merged('weapons'));
    expect(registry.allArmour).toEqual(merged('armour'));
    expect(registry.allTrappings).toEqual(merged('trappings'));
    expect(registry.allTables).toEqual(merged('tables'));
    expect(registry.allSpells.length).toBeGreaterThan(200);
  });

  it('keeps native conditions, XP, and v1 import behaviour while omitting web engine configuration', () => {
    expect(registry.conditions).toEqual(nativeRules.conditions);
    expect(registry.xpCosts).toEqual(nativeRules.xpCosts);
    for (const pack of BUNDLED_PACKS) {
      for (const field of ['system', 'xpRules', 'characters', 'creation', 'criticalTables', 'capabilities', 'screens']) {
        expect(pack).not.toHaveProperty(field);
      }
    }
    expect(validatePack(catalogue[0]).pack).toBeUndefined();
    expect(validatePack(nativeRules).pack).toEqual(nativeRules);
    expect(validateNativeStoredValue('gc.content.packs', BUNDLED_PACKS.map(pack => ({ pack, enabled: true }))))
      .toEqual({ ok: true });
  });

  it('preserves source and completeness metadata when Winds of Magic overrides Core', () => {
    const winds = BUNDLED_PACKS.find(pack => pack.id === 'winds-of-magic')
      ?? BUNDLED_PACKS.find(pack => pack.name.includes('Winds of Magic'));
    expect(winds).toBeDefined();
    for (const spell of winds!.spells ?? []) {
      expect(registry.getSpell(spell.id)).toEqual(spell);
      expect(registry.getSpell(spell.id)?.sourceBook).toBe('Winds of Magic');
      expect(registry.getSpell(spell.id)?.rulesStatus).toBe(spell.rulesStatus);
    }
    expect(registry.allSkillDefs.find(skill => skill.id === 'sk.augury')).toMatchObject({
      sourceBook: 'Winds of Magic', rulesStatus: 'bibliographic', exclusiveWith: ['sk.psychometry'],
    });
  });

  it('makes condition details, critical outcomes, deities, and existing references searchable', () => {
    expect(registry.allReferences).toEqual(expect.arrayContaining(merged('references')));
    expect(registry.allReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'Conditions', name: 'Ablaze', description: expect.stringContaining('fire') }),
      expect.objectContaining({ category: 'Deities', name: 'Sigmar' }),
    ]));
    expect(new Set(registry.allReferences.map(reference => reference.id)).size).toBe(registry.allReferences.length);
  });

  it('lists critical wounds once, from the per-location tables, with readable locations and stable ids', () => {
    const coreRules = catalogue.find(pack => pack.id === 'core-rules') as unknown as {
      criticalTables: Array<{ locations: string[]; rows: Array<{ name: string; min: number; max: number }> }>;
    };
    const tableRows = coreRules.criticalTables.flatMap(table => table.rows);
    const criticals = registry.allReferences.filter(reference => reference.category === 'Critical Wounds');

    // One coherent source: no second copy of a name from the flat summary list.
    expect(criticals).toHaveLength(tableRows.length);
    expect(new Set(criticals.map(critical => critical.name)).size).toBe(criticals.length);
    expect(criticals.map(critical => critical.name).sort()).toEqual(tableRows.map(row => row.name).sort());
    expect(criticals.some(critical => critical.name === 'Bruised Muscle')).toBe(false);

    expect(criticals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'ref.core-rules.critical.head.1-10', name: 'Struck Silly', meta: 'Head · 1–10 · 1 healing day',
      }),
      expect.objectContaining({
        id: 'ref.core-rules.critical.arm_l+arm_r.31-45', name: 'Dislocated Shoulder',
        meta: expect.stringMatching(/^Left Arm \/ Right Arm · 31–45 · \d+ healing days$/),
      }),
      expect.objectContaining({ name: 'Decapitated', meta: expect.stringMatching(/^Head · 100 · /) }),
    ]));
    for (const critical of criticals) {
      expect(critical.meta).not.toMatch(/arm_l|arm_r|leg_l|leg_r/);
    }
  });

  it('falls back to the flat critical list only for a pack without per-location tables', () => {
    const projected = projectBundledPack({
      $schema: 'grimcomp.content.v2', id: 'flat', name: 'Flat criticals', version: '1',
      criticals: [{ name: 'Deep Cut', effect: 'Bleeding 1.', days: 5 }],
    });
    expect(projected.references).toEqual([
      { id: 'ref.flat.critical.0', category: 'Critical Wounds', name: 'Deep Cut', description: 'Bleeding 1.', meta: '5 healing days' },
    ]);
  });

  it('retains every old spell id for saved characters without adding legacy spells to the catalogue', () => {
    for (const legacySpell of LEGACY_NATIVE_SPELLS) expect(registry.getSpell(legacySpell.id)).toEqual(legacySpell);
    for (const character of Object.values(CHARACTER_TEMPLATES)) {
      expect(registry.resolveSpells(character.knownSpells ?? []).map(spell => spell.id)).toEqual(character.knownSpells ?? []);
    }
    expect(registry.allSpells.some(spell => spell.id.startsWith('m.'))).toBe(false);
    const imported = { ...LEGACY_NATIVE_SPELLS[0], description: 'Local override of a saved spell' };
    const overridden = new ContentRegistry([
      ...BUNDLED_PACKS,
      { $schema: CONTENT_SCHEMA, id: 'local', name: 'Local', version: '1', spells: [imported] },
    ], { legacySpells: LEGACY_NATIVE_SPELLS });
    expect(overridden.getSpell(imported.id)).toEqual(imported);
    expect(registry.resolveSpells(['missing'])).toEqual([]);
  });

  it('keeps bibliographic careers in the reference catalogue while excluding them from creation', () => {
    const restricted = registry.allCareers.filter(career => career.creationAvailable === false);
    expect(restricted.length).toBeGreaterThan(0);
    expect(restricted.every(career => !isNativeCreationCareerAvailable(career))).toBe(true);
    expect(isNativeCreationCareerAvailable(undefined)).toBe(false);
    expect(isNativeCreationCareerAvailable(registry.getCareer('car.wizard'))).toBe(true);
    expect(resolveNativeCreationCareer(registry.allCareers, 'car.priest-shallya')).toEqual(registry.getCareer('car.priest'));
    const nativeOverride = { ...registry.getCareer('car.priest')!, id: 'car.priest-shallya', creationAvailable: false };
    expect(isNativeCreationCareerAvailable(resolveNativeCreationCareer([...registry.allCareers, nativeOverride], 'car.priest-shallya')))
      .toBe(false);
  });

  it('resolves legacy imported species grants during creation and reference browsing without adding catalogue duplicates', () => {
    const race = {
      ...registry.allRaces[0], id: 'race.legacy', name: 'Legacy species',
      skills: ['sk.ride-horse', 'sk.channelling-fire'],
      talents: ['tal.kind-hearted', 'tal.bless-shallya'],
    };
    const imported: ContentPack = {
      $schema: CONTENT_SCHEMA, id: 'legacy-species', name: 'Legacy species pack', version: '1', races: [race],
    };
    expect(validateNativeStoredValue('gc.content.packs', [{ pack: imported, enabled: true }])).toEqual({ ok: true });
    const combined = new ContentRegistry([...BUNDLED_PACKS, imported], legacyLookups);
    const grants = resolveNativeRaceGrants(combined, race);
    expect(grants.skills.map(skill => skill.id)).toEqual(race.skills);
    expect(grants.talents.map(talent => talent.id)).toEqual(race.talents);
    expect(combined.allSkillDefs).toEqual(registry.allSkillDefs);
    expect(combined.allTalentDefs).toEqual(registry.allTalentDefs);
    const species = buildNativeReferenceItems(combined).find(entry => entry.id === 'race:race.legacy');
    for (const entry of [...grants.skills, ...grants.talents]) {
      expect(species?.detail).toContain(entry.name);
      expect(species?.detail).not.toContain(entry.id);
    }

    const skillOverride = { ...combined.getSkillDef(race.skills[0])!, name: 'Locally revised riding' };
    const talentOverride = { ...combined.getTalentDef(race.talents[0])!, name: 'Locally revised kindness' };
    const overlay: ContentPack = {
      $schema: CONTENT_SCHEMA, id: 'overrides', name: 'Overrides', version: '1',
      skills: [skillOverride], talents: [talentOverride],
    };
    const overridden = new ContentRegistry([...BUNDLED_PACKS, imported, overlay], legacyLookups);
    expect(overridden.getSkillDef(skillOverride.id)).toEqual(skillOverride);
    expect(overridden.getTalentDef(talentOverride.id)).toEqual(talentOverride);
    expect(resolveNativeRaceGrants(overridden, race).skills[0]).toEqual(skillOverride);
    expect(resolveNativeRaceGrants(overridden, race).talents[0]).toEqual(talentOverride);
    expect(buildNativeReferenceItems(overridden).find(entry => entry.id === 'race:race.legacy')?.detail)
      .toContain('Locally revised riding');
    expect(resolveNativeRaceGrants(overridden, undefined)).toEqual({ skills: [], talents: [] });
  });

  it('lets imported references override catalogue references by id', () => {
    const reference = { ...registry.allReferences[0], description: 'Local rule correction' };
    const imported: ContentPack = { $schema: CONTENT_SCHEMA, id: 'local', name: 'Local', version: '1', references: [reference] };
    expect(validatePack(imported).errors).toEqual([]);
    const combined = new ContentRegistry([...BUNDLED_PACKS, imported]);
    expect(combined.allReferences.find(entry => entry.id === reference.id)).toEqual(reference);
  });

  it.each([
    { sourceBook: 123 }, { sourcePage: -1 }, { sourcePage: 1.5 },
    { rulesStatus: 'complete' }, { rulesNote: {} }, { approximate: 'yes' },
  ])('rejects malformed source metadata on imported references: %j', invalid => {
    const result = validatePack({
      $schema: CONTENT_SCHEMA, id: 'local', name: 'Local', version: '1',
      references: [{ id: 'ref', name: 'Example', category: 'Rules', description: '', ...invalid }],
    });
    expect(result.pack).toBeUndefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects malformed catalogue metadata instead of silently dropping it during projection', () => {
    expect(() => projectBundledPack({
      $schema: 'grimcomp.content.v2', id: 'broken', name: 'Broken', version: '1',
      talents: [{ id: 'tal', name: 'Example', description: '', maxChar: 'invalid' }],
    })).toThrow('maxChar');
    expect(() => projectBundledPack(nativeRules)).toThrow('grimcomp.content.v2');
  });
});
