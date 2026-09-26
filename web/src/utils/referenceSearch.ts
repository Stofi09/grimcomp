import type { ContentRegistry } from '@/content/registry';
import {
  careerMagicAccessLabel,
  careerMagicAccessMeta,
  careerRulesStatusLabel,
  careerRulesStatusMeta,
  careerSourceLabel,
} from './careers';
import { skillRulesStatusLabel, skillRulesStatusMeta, skillSourceLabel } from './skills';
import { formatSpellCn, spellRulesStatusLabel, spellRulesStatusMeta, spellSourceLabel } from './spells';
import {
  TALENT_TRACKING_NOTICE,
  talentRulesStatusLabel,
  talentRulesStatusMeta,
  talentSourceLabel,
} from './talents';

/** Packs may add their own categories without a code or storage migration. */
export type ReferenceCategory = string;

const CORE_REFERENCE_CATEGORIES = [
  'Careers', 'Skills', 'Talents', 'Spells', 'Prayers', 'Conditions',
  'Critical Wounds', 'Chaos & Mutation', 'Roll Tables',
];

export interface ReferenceItem {
  id: string;
  category: ReferenceCategory;
  name: string;
  meta: string;
  detail: string;
}

/** Preserve the familiar core order, then include every loaded custom category. */
export function getReferenceCategories(items: readonly ReferenceItem[]): ReferenceCategory[] {
  const additional = [...new Set(items.map(item => item.category))]
    .filter(category => !CORE_REFERENCE_CATEGORIES.includes(category))
    .sort((a, b) => a.localeCompare(b));
  return [...CORE_REFERENCE_CATEGORIES, ...additional];
}

const nonEmpty = (...parts: Array<string | number | undefined>) =>
  parts.filter(part => part !== undefined && String(part).trim().length > 0).join(' · ');

const nonEmptyUnique = (...parts: Array<string | number | undefined>) => [
  ...new Set(parts
    .filter(part => part !== undefined && String(part).trim().length > 0)
    .map(part => String(part).trim())),
].join(' · ');

/** Turn the loaded registry into one searchable, display-ready reference list. */
export function buildReferenceItems(registry: ContentRegistry): ReferenceItem[] {
  const careers: ReferenceItem[] = registry.allCareers.map(career => ({
    id: `career:${career.id}`,
    category: 'Careers',
    name: career.name,
    meta: nonEmptyUnique(
      career.class,
      `${career.ranks.length} ranks`,
      career.rulesStatus
        ? careerRulesStatusMeta(career)
        : career.approximate ? 'Approximate details' : undefined,
      careerSourceLabel(career),
      career.creationAvailable === false ? 'Unavailable at creation' : undefined,
      careerMagicAccessMeta(career),
    ),
    detail: [
      careerRulesStatusLabel(career),
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
      career.rulesNote?.trim() ? `Rules note: ${career.rulesNote.trim()}` : '',
      career.creationAvailable === false ? 'Creation: unavailable for new characters.' : '',
      careerMagicAccessLabel(career),
    ].filter(Boolean).join('\n'),
  }));
  const skills: ReferenceItem[] = registry.allSkillDefs.map(skill => ({
    id: `skill:${skill.id}`,
    category: 'Skills',
    name: skill.name,
    meta: nonEmptyUnique(
      skill.advanced ? 'Advanced' : 'Basic',
      skill.grouped ? 'Grouped' : undefined,
      skill.char.toUpperCase(),
      skillRulesStatusMeta(skill),
      skillSourceLabel(skill),
    ),
    detail: [
      skillRulesStatusLabel(skill),
      skill.description || 'No description is included in the loaded content.',
      skill.rulesNote?.trim() ? `Rules note: ${skill.rulesNote.trim()}` : '',
    ].filter(Boolean).join('\n'),
  }));
  const talents: ReferenceItem[] = registry.allTalentDefs.map(talent => ({
    id: `talent:${talent.id}`,
    category: 'Talents',
    name: talent.name,
    meta: nonEmptyUnique(
      talent.max !== undefined
        ? `Max ${talent.max}`
        : talent.maxChar
          ? `Max ${talent.maxChar.toUpperCase()} Bonus`
          : 'No listed maximum',
      talent.tests ? `Tests: ${talent.tests}` : undefined,
      talent.specializations?.length ? `${talent.specializations.length} choices` : undefined,
      talent.restriction ? 'Restricted' : undefined,
      talentRulesStatusMeta(talent),
      talentSourceLabel(talent),
    ),
    detail: [
      talentRulesStatusLabel(talent),
      talent.rulesStatus ? TALENT_TRACKING_NOTICE : '',
      talent.description || 'No description is included in the loaded content.',
      talent.specializations?.length
        ? `Choices: ${talent.specializations.join(', ')}`
        : '',
      talent.tests?.trim() ? `Tests: ${talent.tests.trim()}` : '',
      talent.restriction?.trim() ? `Restriction: ${talent.restriction.trim()}` : '',
      talent.rulesNote?.trim() ? `Rules note: ${talent.rulesNote.trim()}` : '',
    ].filter(Boolean).join('\n'),
  }));
  const spells: ReferenceItem[] = registry.allSpells.map(spell => {
    const description = spell.rulesStatus === 'bibliographic' ? '' : spell.description;
    return {
      id: `spell:${spell.id}`,
      category: 'Spells',
      name: spell.name,
      meta: nonEmptyUnique(
        spell.lore,
        `CN ${formatSpellCn(spell)}`,
        spell.range,
        spell.duration,
        spellRulesStatusMeta(spell),
        spellSourceLabel(spell),
      ),
      detail: [
        spellRulesStatusLabel(spell),
        nonEmpty(spell.target && `Target: ${spell.target}`, description, spell.damage && `Damage: ${spell.damage}`),
        spell.rulesNote?.trim() ? `Rules note: ${spell.rulesNote.trim()}` : '',
      ].filter(Boolean).join('\n'),
    };
  });
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
  const tables: ReferenceItem[] = registry.allTables.map(table => ({
    id: `table:${table.id}`,
    category: 'Roll Tables',
    name: table.name,
    meta: `${table.dice?.count ?? 1}d${table.dice?.sides ?? 100} · ${table.rows.length} outcome${table.rows.length === 1 ? '' : 's'}`,
    detail: table.rows.map(row =>
      `${row.min === row.max ? row.min : `${row.min}–${row.max}`}: ${row.effect}`,
    ).join('\n'),
  }));
  const additional: ReferenceItem[] = registry.allReferences.map(reference => ({
    id: `reference:${reference.id}`,
    category: reference.category.trim() || 'Rules',
    name: reference.name,
    meta: nonEmpty(reference.meta, reference.approximate ? 'Approximate companion rule' : undefined),
    detail: reference.description,
  }));

  return [...careers, ...skills, ...talents, ...spells, ...prayers, ...conditions, ...criticals, ...tables, ...additional];
}
