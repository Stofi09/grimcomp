import { describe, expect, it } from 'vitest';

import characterPack from '../../public/content/core-characters.json';
import coreCareerPack from '../../public/content/core-careers.json';
import corePack from '../../public/content/core-magic.json';
import coreSkillsPack from '../../public/content/core-skills.json';
import coreTalentsPack from '../../public/content/core-talents.json';
import manifest from '../../public/content/manifest.json';
import pack from '../../public/content/winds-of-magic.json';
import { ContentRegistry } from './registry';
import type { ContentPack } from './types';
import { validatePack } from './validate';

const COLOUR_LORES = [
  'Light',
  'Metal',
  'Life',
  'Heavens',
  'Shadow',
  'Death',
  'Fire',
  'Beasts',
] as const;

const REMOVED_CORE_IDS = [
  'sp.beasts.bears-anger',
  'sp.beasts.hunters-eye',
  'sp.beasts.wings-of-the-falcon',
  'sp.beasts.pelt-of-the-winter-wolf',
  'sp.beasts.savagery',
  'sp.beasts.crows-feast',
  'sp.beasts.master-of-beasts',
  'sp.death.doom-and-darkness',
  'sp.death.spirit-leech',
  'sp.death.grim-harvest',
  'sp.life.blossom-of-ghyran',
  'sp.life.shield-of-thorns',
  'sp.life.flesh-of-bark',
  'sp.life.master-of-wood',
  'sp.life.regrowth',
  'sp.life.howl-of-the-wilds',
  'sp.light.boon-of-hysh',
  'sp.light.speed-of-light',
  'sp.light.shems-burning-gaze',
  'sp.light.bironas-timewarp',
  'sp.metal.distillation',
  'sp.metal.transmutation-of-lead',
  'sp.metal.rule-of-burning-iron',
  'sp.metal.word-of-iron',
  'sp.metal.golden-hunter',
  'sp.metal.final-transmutation',
  'sp.shadow.shadowcloak',
  'sp.shadow.steed-of-shadows',
  'sp.shadow.grey-wind',
  'sp.shadow.enfolding-darkness',
  'sp.shadow.the-pit',
] as const;

const SEPARATELY_SOURCED_EXTRA_IDS = [
  'sp.death.deathsight',
  'sp.fire.ceaseless-flame',
  'sp.fire.comfort',
  'sp.fire.flashcook',
  'sp.heavens.birdspeech',
  'sp.heavens.gale',
  'sp.heavens.weathervane',
  'sp.heavens.blessings-of-bel-shanaar',
  'sp.heavens.niezlibs-optimal-firing-solution',
  'sp.heavens.sea-of-glass',
] as const;

const UNREVISED_CORE_MAGIC_TALENT_IDS = [
  'tal.aethyric-attunement',
  'tal.arcane-magic',
  'tal.instinctive-diction',
  'tal.petty-magic',
  'tal.second-sight',
  'tal.war-wizard',
] as const;

const RESTORED_CORE_TALENT_IDS = [
  'tal.detect-artefact',
  'tal.magic-resistance',
  'tal.magical-sense',
  'tal.witch',
] as const;

const WINDS = [
  'Aqshy',
  'Azyr',
  'Chamon',
  'Ghur',
  'Ghyran',
  'Hysh',
  'Shyish',
  'Ulgu',
] as const;

const EXPECTED_CAREERS = [
  {
    id: 'car.beadle', name: 'Beadle', class: 'Warrior', species: ['race.dwarf', 'race.halfling', 'race.human'], sourcePage: 36, magicAccess: 'none',
    characteristics: ['ws', 'int', 'wp', 'ag', 'i', 'fel'],
    ranks: [['Laboratory Assistant', 'Silver 1'], ['Beadle', 'Silver 2'], ['Groundskeeper', 'Silver 4'], ['Terror of the Faculty', 'Silver 5']],
  },
  {
    id: 'car.mundane-alchemist', name: 'Mundane Alchemist', class: 'Academic', species: ['race.dwarf', 'race.halfling', 'race.human'], sourcePage: 38, magicAccess: 'later',
    characteristics: ['t', 'dex', 'int', 'i', 'wp', 'ag'],
    ranks: [['Tinkerer', 'Brass 3'], ['Alchemist', 'Silver 2'], ['Master Alchemist', 'Silver 3'], ['Transmutator', 'Gold 1']],
  },
  {
    id: 'car.magister-vigilant', name: 'Magister Vigilant', class: 'Academic', species: ['race.human'], sourcePage: 40, magicAccess: 'starting',
    characteristics: ['ws', 'int', 'wp', 'ag', 'i', 's'],
    ranks: [['Vigilant’s Apprentice', 'Brass 4'], ['Magister Vigilant', 'Silver 4'], ['Magister Inquisitor', 'Gold 1'], ['Lord Vigilant', 'Gold 2']],
  },
  {
    id: 'car.scryer', name: 'Scryer', class: 'Peasant', species: ['race.human'], sourcePage: 42, magicAccess: 'none',
    characteristics: ['int', 'wp', 'fel', 'i', 'ag', 'dex'],
    ranks: [['Haunted', 'Brass 1'], ['Scryer', 'Brass 3'], ['Psychometrician', 'Silver 2'], ['Reader of the Past', 'Gold 1']],
  },
  {
    id: 'car.hierophant', name: 'Hierophant', class: 'Academic', species: ['race.human'], sourcePage: 56, magicAccess: 'starting',
    characteristics: ['i', 'int', 'wp', 'ag', 'ws', 'fel'],
    ranks: [['Acolyte of the Light Order', 'Brass 3'], ['Hierophant', 'Silver 3'], ['Master Hierophant', 'Gold 1'], ['Guardian of the Light Order', 'Gold 2']],
  },
  {
    id: 'car.alchemist', name: 'Alchemist', class: 'Academic', species: ['race.human'], sourcePage: 68, magicAccess: 'starting',
    characteristics: ['t', 'int', 'wp', 'dex', 'i', 'fel'],
    ranks: [['Alchemist Apprentice', 'Brass 4'], ['Alchemist', 'Silver 4'], ['Master Alchemist', 'Gold 3'], ['Alchemist Lord', 'Gold 4']],
  },
  {
    id: 'car.druid', name: 'Druid', class: 'Academic', species: ['race.human'], sourcePage: 80, magicAccess: 'starting',
    characteristics: ['ag', 'int', 'wp', 'i', 'fel', 'ws'],
    ranks: [['Druid’s Apprentice', 'Brass 3'], ['Druid', 'Silver 3'], ['Master Druid', 'Gold 1'], ['Druid Lord', 'Gold 2']],
  },
  {
    id: 'car.astromancer', name: 'Astromancer', class: 'Academic', species: ['race.human'], sourcePage: 92, magicAccess: 'starting',
    characteristics: ['ws', 'int', 'wp', 'ag', 'i', 'fel'],
    ranks: [['Celestial Acolyte', 'Brass 4'], ['Astromancer', 'Silver 4'], ['Grand Astromancer', 'Gold 1'], ['Lord Celestial', 'Gold 2']],
  },
  {
    id: 'car.shadowmancer', name: 'Shadowmancer', class: 'Academic', species: ['race.human'], sourcePage: 104, magicAccess: 'starting',
    characteristics: ['int', 'wp', 'fel', 'i', 'ws', 'ag'],
    ranks: [['Trickster’s Apprentice', 'Brass 3'], ['Shadowmancer', 'Silver 3'], ['Grey Guardian', 'Gold 1'], ['Grey Lord', 'Gold 2']],
  },
  {
    id: 'car.spiriter', name: 'Spiriter', class: 'Academic', species: ['race.human'], sourcePage: 116, magicAccess: 'starting',
    characteristics: ['dex', 'int', 'wp', 'ag', 'i', 't'],
    ranks: [['Apprentice Spiriter', 'Brass 2'], ['Spiriter', 'Silver 3'], ['Master Spiriter', 'Gold 1'], ['Spiriter Lord', 'Gold 2']],
  },
  {
    id: 'car.pyromancer', name: 'Pyromancer', class: 'Academic', species: ['race.human'], sourcePage: 128, magicAccess: 'starting',
    characteristics: ['ws', 'int', 'wp', 'ag', 'i', 'fel'],
    ranks: [['Apprentice Pyromancer', 'Brass 3'], ['Pyromancer', 'Silver 3'], ['Master Pyromancer', 'Gold 1'], ['Pyromancer Lord', 'Gold 2']],
  },
  {
    id: 'car.shaman', name: 'Shaman', class: 'Academic', species: ['race.human'], sourcePage: 140, magicAccess: 'starting',
    characteristics: ['ws', 'int', 'wp', 'ag', 'i', 't'],
    ranks: [['Shaman’s Apprentice', 'Brass 3'], ['Shaman', 'Silver 3'], ['Master Shaman', 'Gold 1'], ['Shaman Lord', 'Gold 2']],
  },
] as const;

const registry = new ContentRegistry([
  coreSkillsPack,
  coreTalentsPack,
  corePack,
  coreCareerPack,
  pack,
  characterPack,
] as unknown as ContentPack[]);

describe('Winds of Magic content pack', () => {
  it('is valid v2 content loaded immediately after core magic', () => {
    const coreResult = validatePack(corePack);
    const result = validatePack(pack);
    expect(corePack.version).toBe('2026.08.20');
    expect(pack.version).toBe('2026.08.21');
    expect(coreResult.errors).toEqual([]);
    expect(coreResult.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);

    const coreIndex = manifest.packs.indexOf('core-magic.json');
    expect(coreIndex).toBeGreaterThanOrEqual(0);
    expect(manifest.packs[coreIndex + 1]).toBe('winds-of-magic.json');
  });

  it('contains the complete 200-spell ordinary roster', () => {
    expect(pack.spells).toHaveLength(200);
    expect(pack.spells.filter(spell => spell.lore === 'Arcane')).toHaveLength(8);
    for (const lore of COLOUR_LORES) {
      expect(pack.spells.filter(spell => spell.lore === lore), lore).toHaveLength(24);
    }

    expect(new Set(pack.spells.map(spell => spell.id)).size).toBe(200);
    expect(new Set(pack.spells.map(spell => `${spell.lore}:${spell.name}`)).size).toBe(200);
  });

  it('adds the 12 standard print-synced Career paths without replacing Core Wizard', () => {
    expect(pack.careers).toHaveLength(12);
    expect(new Set(pack.careers.map(career => career.id)).size).toBe(12);
    expect(pack.careers.flatMap(career => career.ranks)).toHaveLength(48);
    expect(registry.allCareers).toHaveLength(77);
    expect(registry.allCareers.find(career => career.id === 'car.wizard')?.name).toBe('Wizard');
    expect(pack.careers.some(career => career.id.includes('familiar'))).toBe(false);

    for (const expected of EXPECTED_CAREERS) {
      const career = (pack as unknown as ContentPack).careers
        ?.find(candidate => candidate.id === expected.id);
      expect(career, expected.id).toBeDefined();
      expect(career, expected.id).toMatchObject({
        name: expected.name,
        class: expected.class,
        species: [...expected.species],
        sourceBook: 'Winds of Magic',
        sourcePage: expected.sourcePage,
        rulesStatus: 'bibliographic',
        creationAvailable: false,
        randomEligible: false,
        magicAccess: expected.magicAccess,
      });
      expect(career?.advanceScheme?.characteristics, expected.id).toEqual([...expected.characteristics]);
      expect(career?.advanceScheme?.skills, expected.id).toBeUndefined();
      expect(career?.advanceScheme?.talents, expected.id).toBeUndefined();
      expect(career?.ranks.map(rank => [rank.name, rank.status]), expected.id)
        .toEqual(expected.ranks.map(rank => [...rank]));
      expect(career?.ranks.map(rank => rank.level), expected.id).toEqual([1, 2, 3, 4]);
      expect(career?.rulesNote, expected.id).toContain('current print-synced source');
    }
  });

  it('indexes Familiar-only advancement separately from ordinary Careers', () => {
    expect(pack.references).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'ref.wom.combat-familiar-career',
        name: 'Combat Familiar Career',
        category: 'Careers',
      }),
      expect.objectContaining({
        id: 'ref.wom.spell-familiar-career',
        name: 'Spell Familiar Career',
        category: 'Careers',
      }),
    ]));
    expect(pack.references.find(reference => reference.id === 'ref.wom.spell-familiar-career')?.description)
      .toContain('Power Familiars reuse this advance scheme');
  });

  it('adds exactly the two standalone Winds of Magic skills', () => {
    expect(pack.skills).toEqual([
      expect.objectContaining({
        id: 'sk.augury',
        name: 'Augury',
        char: 'int',
        advanced: true,
        grouped: false,
        sourceBook: 'Winds of Magic',
        sourcePage: 44,
        restriction: 'Humans and Elves only; additional Career or Daemonology access rules apply',
        exclusiveWith: ['sk.psychometry'],
        rulesStatus: 'bibliographic',
      }),
      expect.objectContaining({
        id: 'sk.psychometry',
        name: 'Psychometry',
        char: 'int',
        advanced: true,
        grouped: false,
        sourceBook: 'Winds of Magic',
        sourcePage: 47,
        restriction: 'Humans only; restricted Career and character-creation access applies',
        exclusiveWith: ['sk.augury'],
        rulesStatus: 'bibliographic',
      }),
    ]);
    expect(new Set(pack.skills.map(skill => skill.id)).size).toBe(2);
    expect(registry.allSkillDefs).toHaveLength(46);
    expect(new Set(registry.allSkillDefs.map(skill => skill.name.trim().toLocaleLowerCase())).size).toBe(46);
    expect(registry.allSkillDefs.some(skill => skill.name === 'Alchemy')).toBe(false);
    expect(registry.allSkillDefs.some(skill => /^Channelling \([^)]+\)$/.test(skill.name))).toBe(false);
    expect(pack.references).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'ref.wom.alchemy-practice',
        name: 'Alchemy',
        category: 'Arcane practice',
      }),
    ]));
  });

  it('adds two new Talents and a same-ID Concoct revision', () => {
    expect(pack.talents.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'tal.concoct', name: 'Concoct' },
      { id: 'tal.magical-assistant', name: 'Magical Assistant' },
      { id: 'tal.suffuse-with-wind', name: 'Suffuse with (Wind)' },
    ]);

    const newTalents = pack.talents.filter(talent => talent.id !== 'tal.concoct');
    for (const talent of newTalents) {
      expect(talent.max, talent.name).toBe(1);
      expect(talent.sourceBook, talent.name).toBe('Winds of Magic');
      expect(talent.sourcePage, talent.name).toBe(186);
      expect(talent.rulesStatus, talent.name).toBe('bibliographic');
    }

    expect(pack.talents.find(talent => talent.id === 'tal.concoct')).toMatchObject({
      id: 'tal.concoct',
      maxChar: 'int',
      tests: 'Lore (Apothecary) and Lore (Alchemist)',
      sourceBook: 'Winds of Magic',
      sourcePage: 161,
      rulesStatus: 'bibliographic',
    });

    const suffuse = pack.talents.find(talent => talent.id === 'tal.suffuse-with-wind');
    expect(suffuse?.specializations).toEqual(WINDS);
    expect(new Set(suffuse?.specializations.map(wind => wind.toLocaleLowerCase()))).toHaveLength(8);

    const concreteSuffuseNames = new Set(WINDS.map(wind => `Suffuse with ${wind}`));
    expect(pack.talents.filter(talent => concreteSuffuseNames.has(talent.name))).toEqual([]);

    for (const id of UNREVISED_CORE_MAGIC_TALENT_IDS) {
      expect(pack.talents.some(talent => talent.id === id), id).toBe(false);
    }
  });

  it('merges into a unique 168-talent library with the WoM Concoct revision', () => {
    expect(coreTalentsPack.talents).toHaveLength(166);
    for (const id of RESTORED_CORE_TALENT_IDS) {
      expect(coreTalentsPack.talents.some(talent => talent.id === id), id).toBe(true);
    }
    expect(registry.allTalentDefs).toHaveLength(168);
    expect(new Set(registry.allTalentDefs.map(talent => talent.id))).toHaveLength(168);
    expect(new Set(
      registry.allTalentDefs.map(talent => talent.name.trim().toLocaleLowerCase()),
    )).toHaveLength(168);

    expect(coreTalentsPack.talents.filter(talent => talent.id === 'tal.concoct')).toHaveLength(1);
    expect(registry.allTalentDefs.filter(talent => talent.id === 'tal.concoct')).toEqual([
      expect.objectContaining({
        id: 'tal.concoct',
        name: 'Concoct',
        maxChar: 'int',
        sourceBook: 'Winds of Magic',
        sourcePage: 161,
      }),
    ]);
  });

  it('carries usable source metadata and nonblank required fields', () => {
    const requiredText = ['name', 'lore', 'range', 'target', 'duration', 'description'] as const;

    for (const spell of pack.spells) {
      expect(spell.id, spell.name).toMatch(/^sp\.[a-z]+\.[a-z0-9-]+$/);
      expect(Number.isInteger(spell.cn), spell.name).toBe(true);
      expect(spell.cn, spell.name).toBeGreaterThanOrEqual(0);
      for (const field of requiredText) {
        expect(spell[field].trim(), `${spell.name}.${field}`).not.toBe('');
      }
      expect(spell.sourceBook, spell.name).toBe('Winds of Magic');
      expect(Number.isInteger(spell.sourcePage), spell.name).toBe(true);
      expect(spell.sourcePage, spell.name).toBeGreaterThanOrEqual(26);
      expect(spell.sourcePage, spell.name).toBeLessThanOrEqual(149);
      expect('rulesNote' in spell, spell.name).toBe(false);
    }
  });

  it('distinguishes inherited companion mechanics from bibliographic entries', () => {
    const approximate = pack.spells.filter(spell => spell.rulesStatus === 'approximate');
    const bibliographic = pack.spells.filter(spell => spell.rulesStatus === 'bibliographic');
    expect(approximate).toHaveLength(67);
    expect(bibliographic).toHaveLength(133);

    for (const spell of approximate) {
      const prior = corePack.spells.find(entry => entry.id === spell.id);
      expect(prior, spell.name).toBeDefined();
      expect(spell.range, spell.name).toBe(prior?.range);
      expect(spell.target, spell.name).toBe(prior?.target);
      expect(spell.duration, spell.name).toBe(prior?.duration);
      expect(spell.description, spell.name).toBe(prior?.description);
      expect([spell.range, spell.target, spell.duration], spell.name).not.toContain('See source');
      if (prior && 'damage' in prior) {
        expect(spell.damage, spell.name).toBe(prior.damage);
      } else {
        expect('damage' in spell, spell.name).toBe(false);
      }
    }

    for (const spell of bibliographic) {
      expect([spell.range, spell.target, spell.duration], spell.name).toEqual([
        'See source',
        'See source',
        'See source',
      ]);
      expect(spell.description, spell.name).toContain(`consult page ${spell.sourcePage}`);
      expect('damage' in spell, spell.name).toBe(false);
    }
  });

  it('merges with core to the reviewed 255-spell library', () => {
    expect(registry.allSpells).toHaveLength(255);
    for (const id of REMOVED_CORE_IDS) {
      expect(registry.getSpell(id), id).toBeUndefined();
    }
    for (const id of SEPARATELY_SOURCED_EXTRA_IDS) {
      expect(registry.getSpell(id), id).toBeDefined();
    }
  });

  it('keeps every seeded c2 spell playable after the overlay', () => {
    const knownSpells = registry.getCharacterTemplate('c2')?.knownSpells ?? [];
    expect(knownSpells).toHaveLength(10);
    for (const id of knownSpells) {
      expect(registry.getSpell(id), id).toBeDefined();
    }

    const fireSpells = knownSpells
      .filter(id => id.startsWith('sp.fire.'))
      .map(id => registry.getSpell(id));
    expect(fireSpells).toHaveLength(6);
    for (const spell of fireSpells) {
      expect(spell?.rulesStatus, spell?.id).toBe('approximate');
      expect(spell?.range, spell?.id).not.toBe('See source');
      expect(spell?.target, spell?.id).not.toBe('See source');
      expect(spell?.duration, spell?.id).not.toBe('See source');
    }
  });

  it.each([
    ['Vengeful Hood', 7, 149],
    ['Acceptance of Fate', 2, 122],
    ['Mistral from the Stratosphere', 5, 100],
    ['Withering Heat', 9, 136],
  ] as const)('uses the current CN and page for %s', (name, cn, sourcePage) => {
    const spell = pack.spells.find(entry => entry.name === name);
    expect(spell).toMatchObject({ name, cn, sourcePage, sourceBook: 'Winds of Magic' });
  });

  it('corrects Shemtek without breaking the legacy spell id', () => {
    expect(pack.spells.find(spell => spell.name === 'Storm of Shemtek')).toMatchObject({
      id: 'sp.heavens.storm-of-shentek',
      cn: 11,
      sourcePage: 101,
    });
  });
});
