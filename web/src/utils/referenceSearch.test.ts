import { describe, expect, it } from 'vitest';
import { ContentRegistry } from '@/content/registry';
import type { ContentPack } from '@/content/types';
import { buildReferenceItems } from './referenceSearch';

const pack: ContentPack = {
  $schema: 'grimcomp.content.v2',
  id: 'reference-test',
  name: 'Reference test',
  version: '1',
  careers: [{
    id: 'car.roadwarden',
    name: 'Roadwarden',
    class: 'Ranger',
    species: ['human'],
    ranks: [{ level: 1, name: 'Roadwarden', status: 'Silver 1' }],
  }],
  skills: [{
    id: 'skill.ride',
    name: 'Ride (Horse)',
    char: 'ag',
    advanced: false,
    grouped: true,
    description: 'Control a mount.',
  }],
  talents: [{
    id: 'tal.sharp',
    name: 'Sharp',
    description: 'See farther.',
    max: 2,
  }],
  spells: [{
    id: 'spell.light',
    name: 'Light',
    lore: 'Petty',
    cn: 0,
    range: 'Touch',
    target: 'Object',
    duration: 'Minutes',
    description: 'An object glows.',
  }],
  prayers: [{
    id: 'prayer.bless',
    name: 'Bless',
    deity: 'Any',
    range: 'Touch',
    target: 'Creature',
    duration: 'Rounds',
    description: 'Aid the target.',
  }],
  conditions: [{ name: 'Bleeding', penalty: -10, description: 'Lose Wounds.' }],
  criticals: [{ name: 'Broken Bone', effect: 'The limb is broken.', days: 14 }],
  references: [{
    id: 'chaos.test',
    category: 'Chaos & Mutation',
    name: 'Warped Senses',
    meta: 'Mental mutation',
    description: 'Perceive traces of the unnatural.',
    approximate: true,
  }],
};

describe('buildReferenceItems', () => {
  it('indexes every reference category with searchable rule detail', () => {
    const items = buildReferenceItems(new ContentRegistry([pack]));

    expect(new Set(items.map(item => item.category))).toEqual(new Set([
      'Careers',
      'Skills',
      'Talents',
      'Spells',
      'Prayers',
      'Conditions',
      'Critical Wounds',
      'Chaos & Mutation',
    ]));
    expect(items.find(item => item.name === 'Light')).toMatchObject({
      category: 'Spells',
      meta: 'Petty · CN 0 · Touch · Minutes',
    });
    expect(items.find(item => item.name === 'Roadwarden')?.detail).toContain('Silver 1');
    expect(items.find(item => item.name === 'Broken Bone')?.detail).toContain('limb is broken');
    expect(items.find(item => item.name === 'Warped Senses')).toMatchObject({
      category: 'Chaos & Mutation',
      meta: 'Mental mutation · Approximate companion rule',
    });
  });
});
