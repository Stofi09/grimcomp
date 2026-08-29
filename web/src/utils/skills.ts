import type { SkillDef } from '@/content/types';

/** Resolve a character-level skill name to its loaded base definition. */
export function skillDefForName(skillDefs: SkillDef[], name: string): SkillDef | undefined {
  return skillDefs.find(definition => definition.name === name)
    ?? skillDefs.find(definition => definition.grouped && name.startsWith(`${definition.name} (`));
}

/** Compact provenance label shared by Skills and the global reference search. */
export function skillSourceLabel(
  skill: Pick<SkillDef, 'sourceBook' | 'sourcePage'>,
): string {
  const book = skill.sourceBook?.trim();
  const page = skill.sourcePage !== undefined ? `p. ${skill.sourcePage}` : '';
  return [book, page].filter(Boolean).join(' · ');
}

/** User-facing disclosure for how much rules authority a skill entry carries. */
export function skillRulesStatusLabel(
  skill: Pick<SkillDef, 'rulesStatus'>,
): string {
  if (skill.rulesStatus === 'bibliographic') return 'Index only — resolve its special procedure from the source';
  if (skill.rulesStatus === 'approximate') return 'Approximate companion summary — verify in source';
  return '';
}

/** Short form used in dense reference and picker metadata. */
export function skillRulesStatusMeta(
  skill: Pick<SkillDef, 'rulesStatus'>,
): string {
  if (skill.rulesStatus === 'bibliographic') return 'Index only';
  if (skill.rulesStatus === 'approximate') return 'Approximate summary';
  return '';
}
