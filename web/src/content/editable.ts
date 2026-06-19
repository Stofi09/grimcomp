// Metadata for the in-app Content editor: which id-keyed sections are editable,
// their labels, and a minimal valid template used by the "New …" action.

import type { EditableSection } from './types';

export interface SectionMeta {
  key: EditableSection;
  /** Plural label for the section tab. */
  label: string;
  /** Singular noun for the "New …" button. */
  singular: string;
  /** A minimal valid skeleton entry for creating a new one. */
  template: Record<string, unknown>;
}

export const SECTION_META: SectionMeta[] = [
  { key: 'careers', label: 'Careers', singular: 'career',
    template: { id: 'car.new', name: 'New Career', class: 'Warrior', species: [], ranks: [{ level: 1, name: 'Rank 1', status: 'Brass 1' }] } },
  { key: 'talents', label: 'Talents', singular: 'talent',
    template: { id: 'tal.new', name: 'New Talent', description: '' } },
  { key: 'skills', label: 'Skills', singular: 'skill',
    template: { id: 'sk.new', name: 'New Skill', char: 'ws', advanced: false, grouped: false, description: '' } },
  { key: 'spells', label: 'Spells', singular: 'spell',
    template: { id: 'sp.new', name: 'New Spell', lore: 'Petty', cn: 0, range: 'Touch', target: '1', duration: 'Instant', description: '' } },
  { key: 'prayers', label: 'Prayers', singular: 'prayer',
    template: { id: 'p.new', name: 'New Prayer', deity: 'Any', range: 'Touch', target: '1', duration: 'Instant', description: '' } },
  { key: 'races', label: 'Species', singular: 'species',
    template: { id: 'race.new', name: 'New Species', charModifiers: {}, movement: 4, fate: 0, resilience: 0, extra: 0, skills: [], talents: [], description: '' } },
  { key: 'deities', label: 'Deities', singular: 'deity',
    template: { id: 'deity.new', name: 'New Deity', epithet: '', dogma: '' } },
  { key: 'weapons', label: 'Weapons', singular: 'weapon',
    template: { id: 'wp.new', name: 'New Weapon', group: 'Basic', enc: 1, dmg: 'SB+0', qual: [] } },
  { key: 'armour', label: 'Armour', singular: 'armour',
    template: { id: 'arm.new', name: 'New Armour', locs: [], enc: 0, ap: 0, qual: [] } },
  { key: 'trappings', label: 'Trappings', singular: 'trapping',
    template: { id: 'tr.new', name: 'New Trapping', enc: 0 } },
];
