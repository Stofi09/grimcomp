import type { ContentRegistry } from './registry';
import type { Career, Race, SkillDef, TalentDef } from './types';

/** The original native priest archetype used a cult-specific catalogue id. */
export function resolveNativeCreationCareer(careers: Career[], id: string): Career | undefined {
  return careers.find(career => career.id === id)
    ?? (id === 'car.priest-shallya' ? careers.find(career => career.id === 'car.priest') : undefined);
}

export function isNativeCreationCareerAvailable(career: Career | undefined): boolean {
  return career !== undefined && career.creationAvailable !== false;
}

/** Keep imported v1 species grants usable after catalogue ids are replaced. */
export function resolveNativeRaceGrants(registry: ContentRegistry, race: Race | undefined): {
  skills: SkillDef[];
  talents: TalentDef[];
} {
  return {
    skills: (race?.skills ?? []).map(id => registry.getSkillDef(id))
      .filter((definition): definition is SkillDef => definition !== undefined),
    talents: (race?.talents ?? []).map(id => registry.getTalentDef(id))
      .filter((definition): definition is TalentDef => definition !== undefined),
  };
}
