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
    sourceBook: 'Winds of Magic',
    sourcePage: 36,
    rulesNote: 'Use the revised Career equipment from the source.',
    rulesStatus: 'bibliographic',
    creationAvailable: false,
    randomEligible: false,
    magicAccess: 'later',
  }, {
    id: 'car.druid',
    name: 'Druid',
    class: 'Academic',
    species: ['human'],
    ranks: [{ level: 1, name: "Druid's Apprentice", status: 'Brass 3' }],
    sourceBook: 'Winds of Magic',
    sourcePage: 80,
    rulesStatus: 'approximate',
    magicAccess: 'starting',
  }],
  skills: [{
    id: 'skill.ride',
    name: 'Ride (Horse)',
    char: 'ag',
    advanced: false,
    grouped: true,
    description: 'Control a mount.',
  }, {
    id: 'skill.augury',
    name: 'Augury',
    char: 'int',
    advanced: true,
    grouped: false,
    description: 'Interpret omens.',
    sourceBook: 'Winds of Magic',
    sourcePage: 44,
    rulesNote: 'Use the source outcome table.',
    rulesStatus: 'bibliographic',
  }],
  talents: [{
    id: 'tal.sharp',
    name: 'Sharp',
    description: 'See farther.',
    max: 2,
  }, {
    id: 'tal.suffuse-with-wind',
    name: 'Suffuse with (Wind)',
    description: 'Carry a chosen Wind.',
    max: 1,
    tests: 'See text',
    specializations: ['Aqshy', 'Ulgu'],
    sourceBook: 'Winds of Magic',
    sourcePage: 186,
    restriction: 'Power Familiar only',
    rulesNote: 'Choose a Wind and consult the source.',
    rulesStatus: 'bibliographic',
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
    sourceBook: 'Winds of Magic',
    sourcePage: 42,
    rulesNote: 'This is the revised version.',
    rulesStatus: 'approximate',
  }, {
    id: 'spell.indexed',
    name: 'Indexed Spell',
    lore: 'Light',
    cn: 5,
    range: 'See source',
    target: '1',
    duration: 'See source',
    description: 'See Winds of Magic page 60 for the complete spell rules.',
    sourceBook: 'Winds of Magic',
    sourcePage: 60,
    rulesStatus: 'bibliographic',
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
      meta: 'Petty · CN 0 · Touch · Minutes · Approximate summary · Winds of Magic · p. 42',
    });
    expect(items.find(item => item.name === 'Light')?.detail)
      .toContain('Approximate companion summary — verify in source');
    expect(items.find(item => item.name === 'Light')?.detail).toContain('Rules note: This is the revised version.');
    expect(items.find(item => item.name === 'Indexed Spell')).toMatchObject({
      meta: 'Light · CN 5 · See source · Index only · Winds of Magic · p. 60',
      detail: 'Index only — resolve from source\nTarget: 1',
    });
    expect(items.find(item => item.name === 'Augury')).toMatchObject({
      category: 'Skills',
      meta: 'Advanced · INT · Index only · Winds of Magic · p. 44',
      detail: 'Index only — resolve its special procedure from the source\nInterpret omens.\nRules note: Use the source outcome table.',
    });
    expect(items.find(item => item.name === 'Ride (Horse)')?.meta).toBe('Basic · Grouped · AG');
    expect(items.find(item => item.name === 'Suffuse with (Wind)')).toMatchObject({
      category: 'Talents',
      meta: 'Max 1 · Tests: See text · 2 choices · Restricted · Index only · Winds of Magic · p. 186',
      detail: [
        'Index only — resolve this Talent\'s effect from the source',
        'Ranks, XP, and listed Max are tracked; Talent effects are resolved manually.',
        'Carry a chosen Wind.',
        'Choices: Aqshy, Ulgu',
        'Tests: See text',
        'Restriction: Power Familiar only',
        'Rules note: Choose a Wind and consult the source.',
      ].join('\n'),
    });
    expect(items.find(item => item.name === 'Roadwarden')).toMatchObject({
      category: 'Careers',
      meta: 'Ranger · 1 ranks · Index only · Winds of Magic · p. 36 · Unavailable at creation · Later magic access',
      detail: [
        'Index only — resolve this Career\'s full advance scheme from the source',
        '1. Roadwarden — Silver 1',
        'Rules note: Use the revised Career equipment from the source.',
        'Creation: unavailable for new characters.',
        'Magic access begins at a later Career rank.',
      ].join('\n'),
    });
    expect(items.find(item => item.name === 'Druid')).toMatchObject({
      category: 'Careers',
      meta: 'Academic · 1 ranks · Approximate summary · Winds of Magic · p. 80 · Starting magic access',
    });
    expect(items.find(item => item.name === 'Druid')?.detail)
      .toContain('Approximate companion summary — verify in source');
    expect(items.find(item => item.name === 'Broken Bone')?.detail).toContain('limb is broken');
    expect(items.find(item => item.name === 'Warped Senses')).toMatchObject({
      category: 'Chaos & Mutation',
      meta: 'Mental mutation · Approximate companion rule',
    });
  });
});
