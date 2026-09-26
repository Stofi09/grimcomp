import type { ContentRegistry } from '../content/registry';
import type { SourceMetadata } from '../content/types';

export interface NativeReferenceItem {
  id: string;
  category: string;
  name: string;
  meta: string;
  source: string;
  status: string;
  notice: string;
  detail: string;
}

export const NATIVE_REFERENCE_CATEGORIES = [
  'Careers', 'Skills', 'Talents', 'Spells', 'Prayers', 'Rules', 'Conditions',
  'Critical Wounds', 'Chaos & Mutation', 'Tables', 'Species', 'Weapons', 'Armour', 'Trappings',
] as const;

const join = (...parts: Array<string | number | undefined | false>) =>
  parts.filter(part => part !== undefined && part !== false && String(part).trim()).join(' · ');

const lines = (...parts: Array<string | undefined | false>) => parts.filter(Boolean).join('\n\n');

export function nativeSourceLabel(source: SourceMetadata): string {
  return join(source.sourceBook, source.sourcePage !== undefined && `p. ${source.sourcePage}`)
    || 'Source not recorded';
}

function provenance(source: SourceMetadata & { approximate?: boolean }) {
  const bibliographic = source.rulesStatus === 'bibliographic';
  const approximate = source.rulesStatus === 'approximate' || source.approximate;
  return {
    source: nativeSourceLabel(source),
    status: bibliographic ? 'Index only' : approximate ? 'Approximate summary' : 'Loaded content',
    notice: bibliographic
      ? 'Bibliographic entry. Consult the listed source for the full rules.'
      : approximate
        ? 'Approximate companion summary. Verify the rules in the listed source.'
        : '',
  };
}

function item(
  prefix: string,
  category: string,
  entry: SourceMetadata & { id: string; name: string; approximate?: boolean },
  meta: string,
  detail: string,
): NativeReferenceItem {
  return {
    id: `${prefix}:${entry.id}`,
    category,
    name: entry.name,
    meta,
    ...provenance(entry),
    detail: lines(detail, entry.rulesNote && `Rules note: ${entry.rulesNote}`)
      || 'No further details are included in the loaded content.',
  };
}

/** Build the browser from the same merged registry used by the native app. */
export function buildNativeReferenceItems(registry: ContentRegistry): NativeReferenceItem[] {
  const items: NativeReferenceItem[] = [];
  for (const career of registry.allCareers) {
    items.push(item('career', 'Careers', career, join(career.class, `${career.ranks.length} ranks`), lines(
      career.ranks.map(rank => `${rank.level}. ${rank.name} — ${rank.status}`).join('\n'),
      career.species.length > 0 && `Species: ${career.species.map(id => registry.getRace(id)?.name ?? id).join(', ')}`,
    )));
  }
  for (const skill of registry.allSkillDefs) {
    items.push(item('skill', 'Skills', skill,
      join(skill.advanced ? 'Advanced' : 'Basic', skill.grouped && 'Grouped', skill.char.toUpperCase()),
      lines(skill.description, skill.restriction && `Restriction: ${skill.restriction}`),
    ));
  }
  for (const talent of registry.allTalentDefs) {
    items.push(item('talent', 'Talents', talent, join(
      talent.max !== undefined ? `Max ${talent.max}` : talent.maxChar && `Max ${talent.maxChar.toUpperCase()} Bonus`,
      talent.tests && `Tests: ${talent.tests}`,
    ), lines(
      talent.description,
      talent.specializations?.length ? `Choices: ${talent.specializations.join(', ')}` : '',
      talent.restriction && `Restriction: ${talent.restriction}`,
    )));
  }
  for (const spell of registry.allSpells) {
    // Bibliographic records can contain placeholders required by the gameplay
    // schema. They are not spell mechanics and must not appear as usable rules.
    const indexed = spell.rulesStatus === 'bibliographic';
    items.push(item('spell', 'Spells', spell, join(spell.lore, spell.cn === null ? 'CN unknown' : !indexed && `CN ${spell.cn}`), indexed ? '' : lines(
      join(`Range: ${spell.range}`, `Target: ${spell.target}`, `Duration: ${spell.duration}`),
      spell.description,
      spell.damage && `Damage: ${spell.damage}`,
    )));
  }
  for (const prayer of registry.allPrayers) {
    items.push(item('prayer', 'Prayers', prayer, join(prayer.deity, prayer.type),
      prayer.rulesStatus === 'bibliographic' ? '' : lines(
        join(`Range: ${prayer.range}`, `Target: ${prayer.target}`, `Duration: ${prayer.duration}`),
        prayer.description,
      ),
    ));
  }
  for (const race of registry.allRaces) {
    items.push(item('race', 'Species', race, join(race.size, `Movement ${race.movement}`), lines(
      race.description,
      join(`Fate: ${race.fate}`, `Resilience: ${race.resilience}`, `Extra points: ${race.extra}`),
      race.skills.length > 0 && `Skills: ${race.skills.map(id => registry.getSkillDef(id)?.name ?? id).join(', ')}`,
      race.talents.length > 0 && `Talents: ${race.talents.map(id => registry.getTalentDef(id)?.name ?? id).join(', ')}`,
    )));
  }
  for (const weapon of registry.allWeapons) {
    items.push(item('weapon', 'Weapons', weapon, join(weapon.group, `Enc ${weapon.enc}`), lines(
      join(`Damage: ${weapon.dmg}`, weapon.reach && `Reach: ${weapon.reach}`, weapon.range && `Range: ${weapon.range}`),
      weapon.qual.length > 0 && `Qualities: ${weapon.qual.join(', ')}`,
    )));
  }
  for (const armour of registry.allArmour) {
    items.push(item('armour', 'Armour', armour, join(`AP ${armour.ap}`, `Enc ${armour.enc}`), lines(
      `Locations: ${armour.locs.join(', ')}`,
      armour.qual.length > 0 && `Qualities: ${armour.qual.join(', ')}`,
    )));
  }
  for (const trapping of registry.allTrappings) {
    items.push(item('trapping', 'Trappings', trapping, `Enc ${trapping.enc}`, ''));
  }
  for (const table of registry.allTables) {
    items.push(item('table', 'Tables', table, `${table.rows.length} outcomes`,
      table.rows.map(row => `${row.min === row.max ? row.min : `${row.min}–${row.max}`}: ${row.effect}`).join('\n\n'),
    ));
  }

  const describedConditions = new Set(registry.allReferences
    .filter(reference => reference.category === 'Conditions')
    .map(reference => reference.name.trim().toLowerCase()));
  for (const condition of new Set(registry.conditions)) {
    if (describedConditions.has(condition.trim().toLowerCase())) continue;
    items.push(item('condition', 'Conditions', { id: condition, name: condition }, 'Condition',
      'Only the condition name is included in the loaded content. Consult your rulebook for its effects.',
    ));
  }
  for (const reference of registry.allReferences) {
    items.push(item('reference', reference.category, reference, reference.meta ?? '', reference.description));
  }
  return items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Counts and filters use the same items, including categories from imported packs. */
export function nativeReferenceCategoryCounts(
  items: NativeReferenceItem[],
  selectedCategory: string | null = null,
): Array<{ title: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of items) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  const known: readonly string[] = NATIVE_REFERENCE_CATEGORIES;
  const titles = [...known, ...[...counts.keys()].filter(title => !known.includes(title)).sort()];
  // Keep an active imported category visible if its pack is removed or disabled.
  if (selectedCategory !== null && !titles.includes(selectedCategory)) titles.push(selectedCategory);
  return titles.map(title => ({ title, count: counts.get(title) ?? 0 }));
}

/** Literal, case-insensitive token matching; punctuation never becomes a regex. */
export function searchNativeReferenceItems(
  items: NativeReferenceItem[],
  query: string,
  category: string | null = null,
): NativeReferenceItem[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(entry => {
    if (category !== null && entry.category !== category) return false;
    const haystack = [entry.name, entry.category, entry.meta, entry.source, entry.status, entry.detail]
      .join(' ').toLowerCase();
    return tokens.every(token => haystack.includes(token));
  });
}
