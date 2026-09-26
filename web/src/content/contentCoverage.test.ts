import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditContentPacks, readBundledPacks } from '../../../scripts/content-coverage.mjs';
import { ContentRegistry } from './registry';
import { validatePack } from './validate';

describe('bundled sourcebook inventory', () => {
  it('matches the actual registry after validation, overrides and deletions', () => {
    const rawPacks = readBundledPacks(fileURLToPath(new URL('../../public/content', import.meta.url)));
    const packs = rawPacks.map((raw: unknown) => {
      const result = validatePack(raw);
      expect(result.errors).toEqual([]);
      expect(result.pack).not.toBeNull();
      return result.pack!;
    });
    const registry = new ContentRegistry(packs);
    const report = auditContentPacks(rawPacks);
    expect(report.errors).toEqual([]);
    const effective = {
      skills: registry.allSkillDefs,
      talents: registry.allTalentDefs,
      spells: registry.allSpells,
      prayers: registry.allPrayers,
      careers: registry.allCareers,
      races: registry.allRaces,
      deities: registry.allDeities,
      references: registry.allReferences,
      tables: registry.allTables,
      weapons: registry.allWeapons,
      armour: registry.allArmour,
      trappings: registry.allTrappings,
    };
    for (const [section, entries] of Object.entries(effective)) {
      expect(report.sections[section].total, section).toBe(entries.length);
      expect(report.entries.filter((entry: { section: string }) => entry.section === section)
        .map((entry: { id: string }) => entry.id).sort(), section)
        .toEqual(entries.map(entry => entry.id).sort());
    }
    expect(report.sourcebookCompleteness).toBe('not-verified');
  });
});
