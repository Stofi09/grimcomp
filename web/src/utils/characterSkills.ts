import type { Character, Skill } from '@/data/character';
import type { SkillDef } from '@/content/types';

// Character overlays are user-importable JSON. Ignore malformed records rather
// than letting one bad value break every skill calculation and table render.
export const normalizeExtraSkills = (value: unknown): Skill[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: Skill[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const char = typeof record.char === 'string' ? record.char.trim() : '';
    const adv = record.adv;
    if (!name || !char || !Number.isInteger(adv) || (adv as number) < 0) continue;
    if (typeof record.career !== 'boolean') continue;
    if (record.advanced !== undefined && typeof record.advanced !== 'boolean') continue;
    if (record.grouped !== undefined && typeof record.grouped !== 'string') continue;
    if (record.definitionId !== undefined
      && (typeof record.definitionId !== 'string' || !record.definitionId.trim())) continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      name,
      char,
      adv: adv as number,
      career: record.career,
      advanced: record.advanced as boolean | undefined,
      grouped: record.grouped as string | undefined,
      definitionId: typeof record.definitionId === 'string' ? record.definitionId.trim() : undefined,
    });
  }
  return normalized;
};

export function mergeCharacterSkills(
  c: Character,
  careerSkillNames: string[] | undefined,
  extraSkills: Skill[],
  skillDefs: SkillDef[],
): Skill[] {
  const careerNames = new Set(careerSkillNames ?? []);
  const merged: Skill[] = c.skills.map(skill => careerNames.has(skill.name)
    ? { ...skill, career: true }
    : skill);
  const have = new Set(merged.map(skill => skill.name));
  for (const name of careerSkillNames ?? []) {
    if (have.has(name)) continue;
    const def = skillDefs.find(candidate => candidate.name === name)
      ?? skillDefs.find(candidate => name.startsWith(`${candidate.name} (`));
    merged.push({
      name,
      char: def?.char ?? c.characteristics[0]?.key ?? 'ws',
      adv: 0,
      career: true,
      advanced: def?.advanced,
      definitionId: def?.id,
    });
    have.add(name);
  }
  for (const skill of extraSkills) {
    if (!have.has(skill.name)) merged.push(skill);
  }
  return merged;
}
