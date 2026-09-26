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
  /** Section-specific guidance shown beside the raw JSON editor. */
  editorHint?: string;
}

export const SECTION_META: SectionMeta[] = [
  { key: 'careers', label: 'Careers', singular: 'career',
    template: { id: 'car.new', name: 'New Career', class: 'Warrior', species: [], ranks: [{ level: 1, name: 'Rank 1', status: 'Brass 1' }] },
    editorHint: 'Optional career fields: "advanceScheme", "approximate" (legacy fallback flag), "sourceBook" (string), "sourcePage" (whole number ≥ 0), "rulesStatus" ("bibliographic" or "approximate"), "rulesNote", "creationAvailable" (boolean), "randomEligible" (boolean), and "magicAccess" ("none", "starting", or "later").' },
  { key: 'talents', label: 'Talents', singular: 'talent',
    template: { id: 'tal.new', name: 'New Talent', description: '' },
    editorHint: 'Optional talent fields: "max" (number), "maxChar" (characteristic key), "tests" (string), "specializations" (string array), "sourceBook" (string), "sourcePage" (whole number ≥ 0), "restriction" (eligibility text), "rulesStatus" ("bibliographic" or "approximate"), and "rulesNote" (a talent-specific note only).' },
  { key: 'skills', label: 'Skills', singular: 'skill',
    template: { id: 'sk.new', name: 'New Skill', char: 'ws', advanced: false, grouped: false, description: '' },
    editorHint: 'Optional skill fields: "sourceBook" (string), "sourcePage" (whole number ≥ 0), "rulesStatus" ("bibliographic" or "approximate"), and "rulesNote" (a skill-specific note only).' },
  { key: 'spells', label: 'Spells', singular: 'spell',
    template: { id: 'sp.new', name: 'New Spell', lore: 'Petty', cn: 0, range: 'Touch', target: '1', duration: 'Instant', description: 'Describe the spell effect.' },
    editorHint: 'Optional spell fields: "damage" (string), "sourceBook" (string), "sourcePage" (whole number ≥ 0), "rulesStatus" ("bibliographic" or "approximate"), and "rulesNote" (a spell-specific note only). "cn" is a non-negative integer, or null for a bibliographic entry whose Casting Number is unknown. Unknown CN prevents automated casting.' },
  { key: 'prayers', label: 'Prayers', singular: 'prayer',
    template: { id: 'p.new', name: 'New Prayer', deity: 'Any', range: 'Touch', target: '1', duration: 'Instant', description: '' } },
  { key: 'references', label: 'Rules References', singular: 'reference',
    template: { id: 'ref.new', name: 'New Reference', category: 'Rules', description: 'Describe the rule or source reference.' },
    editorHint: 'Choose a "category" to group this entry in Reference. Optional fields: "meta" (a short summary or source citation) and "approximate" (true for provisional companion rules).' },
  { key: 'tables', label: 'Roll Tables', singular: 'roll table',
    template: { id: 'table.new', name: 'New Roll Table', rows: [{ min: 1, max: 100, effect: 'Describe the outcome.' }] },
    editorHint: 'Each row has numeric "min" and "max" bounds and an "effect". Optional "dice": { "count": 1, "sides": 100 }; omitted dice use 1d100. Keep an existing table id to update the rules actions that use it.' },
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
