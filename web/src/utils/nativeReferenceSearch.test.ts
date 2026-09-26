import { describe, expect, it } from 'vitest';
import { ContentRegistry } from '../../../src/content/registry';
import { BUNDLED_PACKS } from '../../../src/content/bundled';
import type { ContentPack } from '../../../src/content/types';
import {
  buildNativeReferenceItems,
  nativeReferenceCategoryCounts,
  nativeSourceLabel,
  searchNativeReferenceItems,
} from '../../../src/utils/nativeReferenceSearch';

const pack: ContentPack = {
  $schema: 'grimcomp.content.v1', id: 'native-reference-test', name: 'Test catalogue', version: '1',
  races: [{ id: 'human', name: 'Human', charModifiers: {}, movement: 4, fate: 2, resilience: 1,
    extra: 3, skills: ['skill.ride'], talents: ['tal.sharp'], description: 'A species.' }],
  careers: [{ id: 'career.scholar', name: 'Scholar', class: 'Academic', species: ['human'],
    ranks: [{ level: 1, name: 'Student', status: 'Brass 3' }] }],
  skills: [{ id: 'skill.ride', name: 'Ride (Horse)', char: 'ag', advanced: false, grouped: true,
    description: 'Control a mount.', sourceBook: 'WFRP Core', sourcePage: 130 }],
  talents: [{ id: 'tal.sharp', name: 'Sharp', description: 'Notice subtle signs.', max: 2,
    tests: 'Perception', specializations: ['Sight', 'Sound'], restriction: 'Test restriction',
    sourceBook: 'Winds of Magic', sourcePage: 186, rulesStatus: 'bibliographic', rulesNote: 'Use the source procedure.' }],
  spells: [{ id: 'spell.light', name: 'Light', lore: 'Petty', cn: 0, range: 'Touch', target: 'Object',
    duration: 'Minutes', description: 'An object glows.', sourceBook: 'Winds of Magic', sourcePage: 42,
    rulesStatus: 'approximate', rulesNote: 'An approximate summary.' },
  { id: 'spell.index', name: 'Indexed Spell', lore: 'Light', cn: 999, range: 'placeholder range',
    target: 'placeholder target', duration: 'placeholder duration', damage: 'placeholder damage',
    description: 'placeholder effect', sourceBook: 'Winds of Magic', sourcePage: 60, rulesStatus: 'bibliographic' }],
  prayers: [{ id: 'prayer.bless', name: 'Bless', deity: 'Any', range: 'Touch', target: 'Creature',
    duration: 'Rounds', description: 'Aid the target.' }],
  weapons: [{ id: 'weapon.bow', name: 'Bow', group: 'Bow', enc: 2, range: '50', dmg: '+SB', qual: ['Silent'] }],
  armour: [{ id: 'armour.coat', name: 'Coat', enc: 2, ap: 1, locs: ['Body'], qual: ['Flexible'] }],
  trappings: [{ id: 'trapping.rope', name: 'Rope', enc: 1 }],
  tables: [{ id: 'table.miscast', name: 'Minor Miscast', sourceBook: 'WFRP Core', sourcePage: 234,
    rulesStatus: 'approximate', rows: [{ min: 1, max: 49, effect: 'A strange noise.' }, { min: 50, max: 100, effect: 'A bright flash.' }] }],
  conditions: ['Bleeding', 'Stunned'],
  references: [
    { id: 'condition.bleeding', name: 'Bleeding', category: 'Conditions', description: 'Lose Wounds.' },
    { id: 'critical.bone', name: 'Broken Bone', category: 'Critical Wounds', description: 'The limb is broken.' },
    { id: 'chaos.senses', name: 'Warped Senses', category: 'Chaos & Mutation', description: 'Unnatural perceptions.', approximate: true },
    { id: 'rule.channel', name: 'Channelling', category: 'Rules', description: 'Accumulate power.',
      sourceBook: 'Winds of Magic', sourcePage: 20, rulesStatus: 'bibliographic' },
    { id: 'career.special', name: 'Special Career', category: 'Careers', description: 'Additional path.' },
    { id: 'custom.ritual', name: 'Ritual [A]', category: 'Custom Rituals', description: 'User-authored preparation.' },
  ],
};

describe('native reference browsing', () => {
  it('indexes loaded entities, full table outcomes, condition details and imported reference categories', () => {
    const items = buildNativeReferenceItems(new ContentRegistry([pack]));
    const counts = nativeReferenceCategoryCounts(items);

    expect(counts.reduce((total, category) => total + category.count, 0)).toBe(items.length);
    for (const category of counts) {
      expect(searchNativeReferenceItems(items, '', category.title)).toHaveLength(category.count);
    }
    expect(counts).toContainEqual({ title: 'Careers', count: 2 });
    expect(counts).toContainEqual({ title: 'Conditions', count: 2 });
    expect(counts).toContainEqual({ title: 'Custom Rituals', count: 1 });
    expect(items.find(entry => entry.name === 'Minor Miscast')?.detail).toBe('1–49: A strange noise.\n\n50–100: A bright flash.');
    expect(items.find(entry => entry.name === 'Bleeding')?.detail).toBe('Lose Wounds.');
    expect(items.find(entry => entry.name === 'Stunned')?.detail).toContain('Only the condition name');
    expect(items.find(entry => entry.name === 'Human')?.detail).toContain('Skills: Ride (Horse)');
    expect(items.find(entry => entry.name === 'Human')?.detail).toContain('Talents: Sharp');
    expect(items.find(entry => entry.name === 'Scholar')?.detail).toContain('1. Student — Brass 3');
    expect(items.find(entry => entry.name === 'Bow')?.detail).toContain('Qualities: Silent');
    expect(items.find(entry => entry.name === 'Coat')?.detail).toContain('Locations: Body');
  });

  it('keeps source citations and incomplete-content notices visible for indexed and approximate entries', () => {
    const items = buildNativeReferenceItems(new ContentRegistry([pack]));
    expect(items.find(entry => entry.name === 'Sharp')).toMatchObject({
      source: 'Winds of Magic · p. 186', status: 'Index only',
      notice: 'Bibliographic entry. Consult the listed source for the full rules.',
    });
    expect(items.find(entry => entry.name === 'Sharp')?.detail).toContain('Rules note: Use the source procedure.');
    expect(items.find(entry => entry.name === 'Light')).toMatchObject({
      source: 'Winds of Magic · p. 42', status: 'Approximate summary', meta: 'Petty · CN 0',
    });
    expect(items.find(entry => entry.name === 'Warped Senses')?.notice).toContain('Approximate companion summary');
    expect(items.find(entry => entry.name === 'Bless')?.source).toBe('Source not recorded');
    expect(nativeSourceLabel({ sourceBook: 'Supplement', sourcePage: 0 })).toBe('Supplement · p. 0');
  });

  it('does not present schema placeholders in bibliographic spell entries as usable spell rules', () => {
    const indexed = buildNativeReferenceItems(new ContentRegistry([pack])).find(entry => entry.name === 'Indexed Spell');
    expect(indexed?.status).toBe('Index only');
    expect(indexed?.meta).toBe('Light');
    expect(indexed?.detail).not.toContain('placeholder');
    expect(indexed?.meta).not.toContain('999');
  });

  it('searches multiple terms across names, detail, rules notes and source citations', () => {
    const items = buildNativeReferenceItems(new ContentRegistry([pack]));
    expect(searchNativeReferenceItems(items, '  WINDs 186 procedure ')).toHaveLength(1);
    expect(searchNativeReferenceItems(items, 'WINDs 186 procedure')[0].name).toBe('Sharp');
    expect(searchNativeReferenceItems(items, 'object glows', 'Spells')[0].name).toBe('Light');
    expect(searchNativeReferenceItems(items, 'object glows', 'Prayers')).toEqual([]);
    expect(searchNativeReferenceItems(items, 'range 50')[0].name).toBe('Bow');
    expect(searchNativeReferenceItems(items, 'no such loaded entry')).toEqual([]);
  });

  it('treats parentheses and square brackets as literal search characters', () => {
    const items = buildNativeReferenceItems(new ContentRegistry([pack]));
    expect(searchNativeReferenceItems(items, '(horse)', 'Skills')[0].name).toBe('Ride (Horse)');
    expect(searchNativeReferenceItems(items, '[A]')[0].name).toBe('Ritual [A]');
    expect(searchNativeReferenceItems(items, '.*')).toEqual([]);
  });

  it('reflects imported overrides and prevents entity IDs colliding across categories', () => {
    const overlay: ContentPack = {
      $schema: 'grimcomp.content.v1', id: 'overlay', name: 'Overlay', version: '1',
      talents: [{ id: 'tal.sharp', name: 'Sharper', description: 'Replacement talent.' }],
      references: [{ id: 'tal.sharp', name: 'Separate Rule', category: 'Rules', description: 'A different entry.' }],
    };
    const items = buildNativeReferenceItems(new ContentRegistry([pack, overlay]));
    expect(items.find(entry => entry.name === 'Sharp')).toBeUndefined();
    expect(items.filter(entry => entry.name === 'Sharper')).toHaveLength(1);
    expect(items.find(entry => entry.name === 'Separate Rule')?.id).toBe('reference:tal.sharp');
    expect(items.find(entry => entry.name === 'Sharper')?.id).toBe('talent:tal.sharp');
  });

  it('distinguishes an imported category named All from the unfiltered null selection', () => {
    const overlay: ContentPack = {
      $schema: 'grimcomp.content.v1', id: 'all-category', name: 'Custom category', version: '1',
      references: [{ id: 'rule.custom-all', name: 'Custom All Entry', category: 'All', description: 'One category only.' }],
    };
    const items = buildNativeReferenceItems(new ContentRegistry([pack, overlay]));
    expect(searchNativeReferenceItems(items, '', 'All').map(entry => entry.name)).toEqual(['Custom All Entry']);
    expect(searchNativeReferenceItems(items, '', null)).toHaveLength(items.length);
    expect(searchNativeReferenceItems(items, '')).toHaveLength(items.length);
    expect(nativeReferenceCategoryCounts(items)).toContainEqual({ title: 'All', count: 1 });
  });

  it('keeps a selected custom category visible with zero matches after its pack is removed', () => {
    const items = buildNativeReferenceItems(new ContentRegistry([pack]));
    expect(nativeReferenceCategoryCounts(items, 'All')).toContainEqual({ title: 'All', count: 0 });
    expect(searchNativeReferenceItems(items, '', 'All')).toEqual([]);
    expect(nativeReferenceCategoryCounts(items).some(category => category.title === 'All')).toBe(false);
    expect(searchNativeReferenceItems(items, '', null)).toHaveLength(items.length);
  });

  it('returns honest zero counts and no fictional recent or placeholder records when nothing is loaded', () => {
    const items = buildNativeReferenceItems(new ContentRegistry([]));
    expect(items).toEqual([]);
    expect(nativeReferenceCategoryCounts(items).every(category => category.count === 0)).toBe(true);
    expect(searchNativeReferenceItems(items, '')).toEqual([]);
  });

  it('makes the bundled Core and Winds of Magic catalogue accessible through the native browser', () => {
    const registry = new ContentRegistry(BUNDLED_PACKS);
    const items = buildNativeReferenceItems(registry);
    expect(items.filter(entry => entry.category === 'Spells')).toHaveLength(registry.allSpells.length);
    expect(items.filter(entry => entry.category === 'Tables')).toHaveLength(registry.allTables.length);
    expect(items.filter(entry => entry.category === 'Skills')).toHaveLength(registry.allSkillDefs.length);
    for (const reference of registry.allReferences) {
      expect(items.find(entry => entry.id === `reference:${reference.id}`)).toMatchObject({
        category: reference.category, name: reference.name,
      });
    }
    expect(searchNativeReferenceItems(items, 'Winds of Magic').length).toBeGreaterThan(0);
    expect(searchNativeReferenceItems(items, 'Channelling').length).toBeGreaterThan(0);
    expect(new Set(items.map(entry => entry.id)).size).toBe(items.length);
  });
});
