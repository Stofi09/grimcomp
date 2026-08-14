import type { ContentRegistry } from '@/content/registry';

export type ReferenceCategory =
  | 'Careers'
  | 'Skills'
  | 'Talents'
  | 'Spells'
  | 'Prayers'
  | 'Conditions'
  | 'Critical Wounds'
  | 'Chaos & Mutation';

export interface ReferenceItem {
  id: string;
  category: ReferenceCategory;
  name: string;
  meta: string;
  detail: string;
}

const nonEmpty = (...parts: Array<string | number | undefined>) =>
  parts.filter(part => part !== undefined && String(part).trim().length > 0).join(' · ');

/** Turn the loaded registry into one searchable, display-ready reference list. */
export function buildReferenceItems(registry: ContentRegistry): ReferenceItem[] {
  const careers: ReferenceItem[] = registry.allCareers.map(career => ({
    id: `career:${career.id}`,
    category: 'Careers',
    name: career.name,
    meta: nonEmpty(
      career.class,
      `${career.ranks.length} ranks`,
      career.approximate ? 'Approximate details' : undefined,
    ),
    detail: [
      career.ranks.map(rank => {
        const requirements = rank.requirements?.length
          ? ` · requires ${rank.requirements.map(req => `${req.skill} +${req.min}`).join(', ')}`
          : '';
        return `${rank.level}. ${rank.name} — ${rank.status}${requirements}`;
      }).join('\n'),
      career.advanceScheme?.characteristics?.length
        ? `Characteristics: ${career.advanceScheme.characteristics.map(key => key.toUpperCase()).join(', ')}`
        : '',
      career.advanceScheme?.skills?.length
        ? `Career skills: ${career.advanceScheme.skills.join(', ')}`
        : '',
      career.advanceScheme?.talents?.length
        ? `Career talents: ${career.advanceScheme.talents.join(', ')}`
        : '',
    ].filter(Boolean).join('\n'),
  }));
  const skills: ReferenceItem[] = registry.allSkillDefs.map(skill => ({
    id: `skill:${skill.id}`,
    category: 'Skills',
    name: skill.name,
    meta: nonEmpty(skill.advanced ? 'Advanced' : 'Basic', skill.char.toUpperCase()),
    detail: skill.description || 'No description is included in the loaded content.',
  }));
  const talents: ReferenceItem[] = registry.allTalentDefs.map(talent => ({
    id: `talent:${talent.id}`,
    category: 'Talents',
    name: talent.name,
    meta: talent.max !== undefined
      ? `Max ${talent.max}`
      : talent.maxChar
        ? `Max ${talent.maxChar.toUpperCase()} Bonus`
        : 'No listed maximum',
    detail: talent.description || 'No description is included in the loaded content.',
  }));
  const spells: ReferenceItem[] = registry.allSpells.map(spell => ({
    id: `spell:${spell.id}`,
    category: 'Spells',
    name: spell.name,
    meta: nonEmpty(spell.lore, `CN ${spell.cn}`, spell.range, spell.duration),
    detail: nonEmpty(spell.target && `Target: ${spell.target}`, spell.description, spell.damage && `Damage: ${spell.damage}`),
  }));
  const prayers: ReferenceItem[] = registry.allPrayers.map(prayer => ({
    id: `prayer:${prayer.id}`,
    category: 'Prayers',
    name: prayer.name,
    meta: nonEmpty(prayer.type, prayer.deity, prayer.range, prayer.duration),
    detail: nonEmpty(prayer.target && `Target: ${prayer.target}`, prayer.description),
  }));
  const conditions: ReferenceItem[] = registry.conditions.map((condition, index) => ({
    id: `condition:${condition.name}:${index}`,
    category: 'Conditions',
    name: condition.name,
    meta: condition.penalty ? `${condition.penalty} per stack` : 'Condition',
    detail: condition.description || 'No description is included in the loaded content.',
  }));
  const criticals: ReferenceItem[] = registry.criticals.map((critical, index) => ({
    id: `critical:${critical.name}:${index}`,
    category: 'Critical Wounds',
    name: critical.name,
    meta: `${critical.days} healing day${critical.days === 1 ? '' : 's'}`,
    detail: critical.effect,
  }));
  const additional: ReferenceItem[] = registry.allReferences.map(reference => ({
    id: `reference:${reference.id}`,
    category: reference.category as ReferenceCategory,
    name: reference.name,
    meta: nonEmpty(reference.meta, reference.approximate ? 'Approximate companion rule' : undefined),
    detail: reference.description,
  }));

  return [...careers, ...skills, ...talents, ...spells, ...prayers, ...conditions, ...criticals, ...additional];
}
