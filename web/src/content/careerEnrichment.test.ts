import { describe, expect, it } from 'vitest';
import careersPack from '../../public/content/core-careers.json';
import skillsPack from '../../public/content/core-skills.json';
import talentsPack from '../../public/content/core-talents.json';
import { ContentRegistry } from './registry';
import type { ContentPack } from './types';

const registry = new ContentRegistry([
  careersPack,
  skillsPack,
  talentsPack,
] as unknown as ContentPack[]);

const resolvesGroupedName = (available: Set<string>, name: string) =>
  available.has(name) || [...available].some(base => name.startsWith(`${base} (`));

describe('bundled career fallback coverage', () => {
  it('makes every bundled career playable without overwriting its identity', () => {
    expect(registry.allCareers).toHaveLength(65);
    for (const career of registry.allCareers) {
      expect(career.approximate, career.name).toBe(true);
      expect(career.advanceScheme?.characteristics.length, career.name).toBeGreaterThanOrEqual(5);
      expect(career.advanceScheme?.skills?.length, career.name).toBe(8);
      expect(career.advanceScheme?.talents?.length, career.name).toBeGreaterThanOrEqual(8);
      expect(career.ranks, career.name).toHaveLength(4);
      for (const rank of career.ranks.slice(1)) {
        expect(rank.requirements?.length, `${career.name} rank ${rank.level}`).toBeGreaterThan(0);
      }
    }
  });

  it('only points career profiles at loaded skill families and talents', () => {
    const skillNames = new Set(registry.allSkillDefs.map(skill => skill.name));
    const talentNames = new Set(registry.allTalentDefs.map(talent => talent.name));

    for (const career of registry.allCareers) {
      for (const skill of career.advanceScheme?.skills ?? []) {
        expect(resolvesGroupedName(skillNames, skill), `${career.name}: ${skill}`).toBe(true);
      }
      for (const talent of career.advanceScheme?.talents ?? []) {
        expect(talentNames.has(talent), `${career.name}: ${talent}`).toBe(true);
      }
    }
  });
});
