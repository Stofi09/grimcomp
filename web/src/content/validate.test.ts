import { describe, it, expect } from 'vitest';
import { validatePack } from './validate';

// Eagerly import every shipped content pack as parsed JSON. Vite resolves these
// at transform time, so the test needs no node:fs and no @types/node.
const modules = import.meta.glob('../../public/content/*.json', { eager: true });

const readPack = (file: string): unknown => {
  const entry = Object.entries(modules).find(([path]) => path.endsWith(`/${file}`));
  if (!entry) throw new Error(`content pack not found: ${file}`);
  return (entry[1] as { default: unknown }).default;
};

const validTalent = (overrides: Record<string, unknown> = {}) => ({
  name: 'Read/Write',
  definitionId: 'tal.read-write',
  specialization: 'Reikspiel',
  times: 1,
  desc: 'Can read and write.',
  career: true,
  ...overrides,
});

const validCharacter = (overrides: Record<string, unknown> = {}) => ({
  id: 'char.test',
  name: 'Test Character',
  species: 'Human',
  raceId: 'race.human',
  class: 'Academic',
  careerId: 'car.wizard',
  career: 'Wizard',
  careerLevel: 1,
  careerLevelName: 'Wizard\'s Apprentice',
  careerRanks: [{ level: 1, name: 'Wizard\'s Apprentice', status: 'Brass 3' }],
  status: 'Brass 3',
  age: 24,
  height: '175 cm',
  hair: 'Brown',
  eyes: 'Grey',
  motivation: 'Learn the arcane arts.',
  fate: 2,
  fortune: 2,
  resilience: 1,
  resolve: 1,
  xpCurrent: 100,
  xpSpent: 0,
  wounds: { current: 10, max: 10 },
  corruption: 0,
  sin: 0,
  movement: 4,
  wealth: { gc: 1, ss: 2, d: 3 },
  characteristics: [{ key: 'int', name: 'Intelligence', short: 'Int', init: 30, adv: 5 }],
  skills: [{
    definitionId: 'sk.lore-magick', name: 'Lore (Magick)', char: 'int', adv: 5,
    career: true, advanced: true, grouped: 'Magick',
  }],
  talents: [validTalent()],
  weapons: [{ name: 'Dagger', group: 'Basic', enc: 0, reach: 'Short', dmg: 'SB+2', qual: [] }],
  armour: [{ name: 'Robes', locs: ['Body'], enc: 0, ap: 0, qual: [] }],
  ap: { head: 0, arm_l: 0, arm_r: 0, body: 0, leg_l: 0, leg_r: 0, shield: 0 },
  conditions: [{ type: 'Bleeding', stacks: 0 }],
  criticals: [{ loc: 'Arm', roll: 1, name: 'Bruise', effect: 'It hurts.', days: 0 }],
  trappings: [{ name: 'Spellbook', enc: 1 }],
  party: { name: 'Test Party', short: 'A test party.', members: [{ name: 'Ally', role: 'Scout' }] },
  psychology: ['Animosity (Enemies)'],
  mutations: [{ name: 'Odd Eyes' }],
  ambitionsShort: 'Learn a spell.',
  ambitionsLong: 'Become a master wizard.',
  initials: 'TC',
  accent: '#123456',
  ...overrides,
});

describe('validatePack — unit', () => {
  it('accepts a minimal v2 pack', () => {
    const { pack, errors, warnings } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
    });
    expect(errors).toEqual([]);
    expect(pack).toBeTruthy();
    expect(warnings).toEqual([]);
  });

  it('reports missing required fields', () => {
    const { pack, errors } = validatePack({ $schema: 'grimcomp.content.v2' });
    expect(pack).toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-object', () => {
    expect(validatePack(42).errors.length).toBeGreaterThan(0);
  });

  it('warns (but does not fail) on an unknown / typo section', () => {
    const { pack, errors, warnings } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      spels: [], // typo for "spells"
    });
    expect(errors).toEqual([]);
    expect(pack).toBeTruthy();
    expect(warnings.some(w => w.includes('spels'))).toBe(true);
  });

  it('flags a duplicate id within a section', () => {
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      spells: [
        { id: 'm.x', name: 'X' },
        { id: 'm.x', name: 'Y' },
      ],
    });
    expect(errors.some(e => /duplicate/i.test(e))).toBe(true);
  });

  it('rejects blank ids for id-keyed pack entries', () => {
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      talents: [{ id: '   ', name: 'Blank Id', description: 'Invalid identity.' }],
    });

    expect(errors).toContain('talents[0] field "id" must not be blank.');
  });

  it('accepts a stable Career id on a character and rejects a blank one', () => {
    const character = validCharacter();
    const envelope = {
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      characters: [character],
    };

    expect(validatePack(envelope).errors).toEqual([]);
    expect(validatePack({
      ...envelope,
      characters: [{ ...character, careerId: '   ' }],
    }).errors).toContain('characters[0] "careerId" must be a nonblank string when provided.');
  });

  it('accepts a structurally complete character template', () => {
    const { pack, errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      characters: [validCharacter({
        isCaster: true,
        spellLore: 'Fire',
        knownSpells: ['sp.fire.cauterise'],
        criticals: [{ loc: '', roll: 1, name: 'Bruise', effect: 'It hurts.', days: 0 }],
      })],
    });

    expect(errors).toEqual([]);
    expect(pack?.characters).toHaveLength(1);
  });

  it('rejects missing, null, string, zero, fractional, and infinite character talent times', () => {
    const { times: _times, ...withoutTimes } = validTalent();
    const invalidTalents = [
      withoutTimes,
      validTalent({ times: null }),
      validTalent({ times: '1' }),
      validTalent({ times: 0 }),
      validTalent({ times: 1.5 }),
      validTalent({ times: Number.POSITIVE_INFINITY }),
    ];
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      characters: [validCharacter({ talents: invalidTalents })],
    });

    const timesErrors = errors.filter(error =>
      error.includes('"times" must be a finite integer greater than or equal to 1.'));
    expect(timesErrors).toHaveLength(invalidTalents.length);
    invalidTalents.forEach((_, index) => {
      expect(timesErrors.some(error => error.startsWith(`characters[0].talents[${index}]`))).toBe(true);
    });
  });

  it('strictly validates the other character talent fields', () => {
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      characters: [validCharacter({
        talents: [
          validTalent({ name: ' ' }),
          validTalent({ desc: '' }),
          validTalent({ career: 'yes' }),
          validTalent({ definitionId: ' ' }),
          validTalent({ specialization: null }),
        ],
      })],
    });

    expect(errors).toContain('characters[0].talents[0] "name" must be a nonblank string.');
    expect(errors).toContain('characters[0].talents[1] "desc" must be a nonblank string.');
    expect(errors).toContain('characters[0].talents[2] "career" must be a boolean.');
    expect(errors).toContain('characters[0].talents[3] "definitionId" must be a nonblank string when provided.');
    expect(errors).toContain('characters[0].talents[4] "specialization" must be a nonblank string when provided.');
  });

  it('rejects duplicate stable and legacy character talent identities', () => {
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      characters: [validCharacter({
        talents: [
          validTalent(),
          validTalent({
            name: 'Historical Read/Write label',
            definitionId: ' TAL.READ-WRITE ',
            specialization: ' REIKSPIEL ',
          }),
          validTalent({ name: ' Hardy ', definitionId: undefined, specialization: undefined }),
          validTalent({ name: 'hardy', definitionId: undefined, specialization: undefined }),
        ],
      })],
    });

    expect(errors).toContain(
      'characters[0].talents[1] duplicates talent identity "definition:tal.read-write|specialization:reikspiel".',
    );
    expect(errors).toContain(
      'characters[0].talents[3] duplicates talent identity "name:hardy".',
    );
  });

  it('rejects character skills that reference missing characteristic keys', () => {
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      characters: [validCharacter({
        skills: [
          { name: 'Valid Lore', char: 'int', adv: 1, career: true },
          { name: 'Broken Lore', char: 'wp', adv: 1, career: false },
        ],
      })],
    });

    expect(errors).toEqual([
      'characters[0].skills[1] "char" references unknown characteristic "wp".',
    ]);
  });

  it('rejects malformed load-bearing character collections and nested objects', () => {
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      characters: [validCharacter({
        characteristics: [null],
        skills: [{ name: 'Lore', char: 'int', adv: 1, career: 'yes' }],
        careerRanks: [{ level: 1, name: 'Rank', status: 'Brass 1' }, { level: 1, name: 'Duplicate', status: 'Brass 2' }],
        wounds: { current: Number.POSITIVE_INFINITY, max: 10 },
        wealth: { gc: 'many' },
        weapons: [{ name: 'Dagger', group: 'Basic', enc: 0, dmg: 'SB+2', qual: 'None' }],
        armour: [{ name: 'Mail', locs: [null], enc: 1, ap: 1, qual: [] }],
        ap: { head: Number.POSITIVE_INFINITY, arm_l: 0, arm_r: 0, body: 0, leg_l: 0, leg_r: 0, shield: 0 },
        conditions: [{ type: 'Bleeding', stacks: -1 }],
        criticals: [null],
        trappings: [{ name: ' ', enc: 0 }],
        party: { name: 'Party', short: '', members: [null] },
        psychology: [null],
        mutations: [null],
      })],
    });

    expect(errors).toContain('characters[0].characteristics[0] must be an object.');
    expect(errors).toContain('characters[0].skills[0] "career" must be a boolean.');
    expect(errors.some(error => error.includes('duplicates career level 1'))).toBe(true);
    expect(errors).toContain('characters[0].wounds "current" must be a finite number.');
    expect(errors).toContain('characters[0].wealth["gc"] must be a finite number.');
    expect(errors).toContain('characters[0].weapons[0] "qual" must be an array.');
    expect(errors).toContain('characters[0].armour[0].locs[0] must be a nonblank string.');
    expect(errors).toContain('characters[0].conditions[0] "stacks" must be a finite integer greater than or equal to 0.');
    expect(errors).toContain('characters[0].party.members[0] must be an object.');
  });

  it('accepts Career provenance, availability, and magic-access metadata', () => {
    const { pack, errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      careers: [{
        id: 'car.hierophant',
        name: 'Hierophant',
        class: 'Academic',
        species: ['race.human'],
        ranks: [{ level: 1, name: 'Acolyte of the Light Order', status: 'Brass 3' }],
        sourceBook: 'Winds of Magic',
        sourcePage: 56,
        rulesNote: 'Resolve the full advance scheme from the source.',
        rulesStatus: 'bibliographic',
        creationAvailable: true,
        randomEligible: false,
        magicAccess: 'starting',
      }],
    });

    expect(errors).toEqual([]);
    expect(pack?.careers?.[0]).toMatchObject({
      sourceBook: 'Winds of Magic',
      sourcePage: 56,
      rulesNote: 'Resolve the full advance scheme from the source.',
      rulesStatus: 'bibliographic',
      creationAvailable: true,
      randomEligible: false,
      magicAccess: 'starting',
    });
  });

  it('rejects malformed Career provenance, availability, and magic-access metadata', () => {
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      careers: [{
        id: 'car.bad',
        name: 'Bad Career',
        class: 'Academic',
        species: [],
        ranks: [],
        sourceBook: 4,
        sourcePage: -1,
        rulesNote: false,
        rulesStatus: 'draft',
        creationAvailable: 'yes',
        randomEligible: 1,
        magicAccess: 'sometimes',
      }],
    });

    expect(errors.some(error => error.includes('"sourceBook" must be a string'))).toBe(true);
    expect(errors.some(error => error.includes('"sourcePage" must be a finite integer'))).toBe(true);
    expect(errors.some(error => error.includes('"rulesNote" must be a string'))).toBe(true);
    expect(errors.some(error => error.includes('"rulesStatus" must be "bibliographic" or "approximate"'))).toBe(true);
    expect(errors.some(error => error.includes('"creationAvailable" must be a boolean'))).toBe(true);
    expect(errors.some(error => error.includes('"randomEligible" must be a boolean'))).toBe(true);
    expect(errors.some(error => error.includes('"magicAccess" must be "none", "starting", or "later"'))).toBe(true);
  });

  it('accepts optional spell source metadata and a rules note', () => {
    const { pack, errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      spells: [{
        id: 'spell.test',
        name: 'Test Spell',
        lore: 'Arcane',
        cn: 4,
        range: 'Willpower yards',
        target: '1',
        duration: 'Instant',
        description: 'A test effect.',
        sourceBook: 'Winds of Magic',
        sourcePage: 42,
        rulesNote: 'Use the revised overcasting option.',
        rulesStatus: 'bibliographic',
      }],
    });

    expect(errors).toEqual([]);
    expect(pack?.spells?.[0]).toMatchObject({
      sourceBook: 'Winds of Magic',
      sourcePage: 42,
      rulesNote: 'Use the revised overcasting option.',
      rulesStatus: 'bibliographic',
    });
  });

  it('rejects malformed spell metadata, invalid CN, and blank required text', () => {
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      spells: [{
        id: 'spell.test',
        name: '   ',
        lore: 'Arcane',
        cn: Number.POSITIVE_INFINITY,
        range: 'Touch',
        target: '1',
        duration: 'Instant',
        description: 'A test effect.',
        sourceBook: 4,
        sourcePage: 2.5,
        rulesNote: false,
        rulesStatus: 'draft',
      }],
    });

    expect(errors.some(error => error.includes('"name" must not be blank'))).toBe(true);
    expect(errors.some(error => error.includes('"cn" must be a finite integer'))).toBe(true);
    expect(errors.some(error => error.includes('"sourceBook" must be a string'))).toBe(true);
    expect(errors.some(error => error.includes('"sourcePage" must be a finite integer'))).toBe(true);
    expect(errors.some(error => error.includes('"rulesNote" must be a string'))).toBe(true);
    expect(errors.some(error => error.includes('"rulesStatus" must be "bibliographic" or "approximate"'))).toBe(true);
  });

  it('accepts the approximate spell rules status', () => {
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      spells: [{
        id: 'spell.test', name: 'Test Spell', lore: 'Arcane', cn: 0,
        range: 'Touch', target: '1', duration: 'Instant', description: 'An effect.',
        rulesStatus: 'approximate',
      }],
    });
    expect(errors).toEqual([]);
  });

  it('accepts skill provenance, eligibility, exclusion, and rules-status metadata', () => {
    const { pack, errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      skills: [{
        id: 'sk.augury',
        name: 'Augury',
        char: 'int',
        advanced: true,
        grouped: false,
        description: 'Interpret omens.',
        sourceBook: 'Winds of Magic',
        sourcePage: 44,
        rulesNote: 'Resolve the source procedure manually.',
        restriction: 'Humans and Elves only.',
        exclusiveWith: ['sk.psychometry'],
        rulesStatus: 'bibliographic',
      }],
    });

    expect(errors).toEqual([]);
    expect(pack?.skills?.[0]).toMatchObject({
      sourceBook: 'Winds of Magic',
      sourcePage: 44,
      rulesNote: 'Resolve the source procedure manually.',
      restriction: 'Humans and Elves only.',
      exclusiveWith: ['sk.psychometry'],
      rulesStatus: 'bibliographic',
    });
  });

  it('rejects malformed skill metadata and blank required text', () => {
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      skills: [{
        id: 'sk.bad',
        name: '   ',
        char: '',
        advanced: true,
        grouped: false,
        description: ' ',
        sourceBook: 4,
        sourcePage: -1,
        rulesNote: false,
        restriction: ' ',
        exclusiveWith: 'sk.other',
        rulesStatus: 'draft',
      }],
    });

    expect(errors.some(error => error.includes('"name" must not be blank'))).toBe(true);
    expect(errors.some(error => error.includes('"char" must not be blank'))).toBe(true);
    expect(errors.some(error => error.includes('"description" must not be blank'))).toBe(true);
    expect(errors.some(error => error.includes('"sourceBook" must be a string'))).toBe(true);
    expect(errors.some(error => error.includes('"sourcePage" must be a finite integer'))).toBe(true);
    expect(errors.some(error => error.includes('"rulesNote" must be a string'))).toBe(true);
    expect(errors.some(error => error.includes('"restriction" must be a nonblank string'))).toBe(true);
    expect(errors.some(error => error.includes('"exclusiveWith" must be an array of nonblank skill ids'))).toBe(true);
    expect(errors.some(error => error.includes('"rulesStatus" must be "bibliographic" or "approximate"'))).toBe(true);
  });

  it('rejects blank and duplicate exclusive skill ids', () => {
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      skills: [{
        id: 'sk.blank-exclusion',
        name: 'Blank exclusion',
        char: 'int',
        advanced: true,
        grouped: false,
        description: 'Has a blank exclusion id.',
        exclusiveWith: [' '],
      }, {
        id: 'sk.duplicate-exclusion',
        name: 'Duplicate exclusion',
        char: 'int',
        advanced: true,
        grouped: false,
        description: 'Lists one exclusion twice.',
        exclusiveWith: ['sk.other', ' sk.other '],
      }],
    });

    expect(errors.some(error => error.includes('"exclusiveWith" must be an array of nonblank skill ids'))).toBe(true);
    expect(errors.some(error => error.includes('"exclusiveWith" must not contain duplicate skill ids'))).toBe(true);
  });

  it('accepts talent source, procedure, restriction, Tests, and specialization metadata', () => {
    const { pack, errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      talents: [{
        id: 'tal.suffuse-with-wind',
        name: 'Suffuse with (Wind)',
        description: 'A familiar is attuned to one Wind of Magic.',
        max: 1,
        tests: 'See text',
        specializations: ['Aqshy', 'Azyr'],
        sourceBook: 'Winds of Magic',
        sourcePage: 186,
        rulesNote: 'Resolve the Wind-specific benefit manually.',
        restriction: 'Familiars only.',
        rulesStatus: 'bibliographic',
      }],
    });

    expect(errors).toEqual([]);
    expect(pack?.talents?.[0]).toMatchObject({
      max: 1,
      tests: 'See text',
      specializations: ['Aqshy', 'Azyr'],
      sourceBook: 'Winds of Magic',
      sourcePage: 186,
      rulesNote: 'Resolve the Wind-specific benefit manually.',
      restriction: 'Familiars only.',
      rulesStatus: 'bibliographic',
    });
  });

  it('rejects nonfinite, fractional, and nonpositive talent maxima', () => {
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      talents: [
        { id: 'tal.infinite', name: 'Infinite', description: 'Invalid maximum.', max: Number.POSITIVE_INFINITY },
        { id: 'tal.fractional', name: 'Fractional', description: 'Invalid maximum.', max: 1.5 },
        { id: 'tal.nonpositive', name: 'Nonpositive', description: 'Invalid maximum.', max: 0 },
      ],
    });

    expect(errors.filter(error => error.includes('"max" must be a finite integer greater than or equal to 1')))
      .toHaveLength(3);
  });

  it('rejects malformed talent metadata, blank required text, and invalid specializations', () => {
    const { errors } = validatePack({
      $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1',
      talents: [{
        id: 'tal.bad',
        name: '   ',
        description: ' ',
        tests: ' ',
        specializations: ['Aqshy', ' '],
        sourceBook: 4,
        sourcePage: -1,
        rulesNote: false,
        restriction: 7,
        rulesStatus: 'draft',
      }, {
        id: 'tal.duplicate-specializations',
        name: 'Duplicate Specializations',
        description: 'Contains the same choice twice.',
        specializations: ['Aqshy', ' aqshy '],
      }, {
        id: 'tal.empty-specializations',
        name: 'Empty Specializations',
        description: 'Contains no choices.',
        specializations: [],
      }],
    });

    expect(errors.some(error => error.includes('"name" must not be blank'))).toBe(true);
    expect(errors.some(error => error.includes('"description" must not be blank'))).toBe(true);
    expect(errors.some(error => error.includes('"tests" must be a nonblank string'))).toBe(true);
    expect(errors.filter(error => error.includes('"specializations" must be a nonempty array of nonblank strings')))
      .toHaveLength(2);
    expect(errors.some(error => error.includes('"specializations" must not contain duplicate values'))).toBe(true);
    expect(errors.some(error => error.includes('"sourceBook" must be a string'))).toBe(true);
    expect(errors.some(error => error.includes('"sourcePage" must be a finite integer'))).toBe(true);
    expect(errors.some(error => error.includes('"rulesNote" must be a string'))).toBe(true);
    expect(errors.some(error => error.includes('"restriction" must be a nonblank string'))).toBe(true);
    expect(errors.some(error => error.includes('"rulesStatus" must be "bibliographic" or "approximate"'))).toBe(true);
  });
});

// Regression lock: every pack the app actually ships must validate cleanly.
// This is the net that makes future schema changes safe — break a core pack and
// CI goes red instead of the app white-screening on load.
describe('validatePack — shipped content regression lock', () => {
  const manifest = readPack('manifest.json') as { packs: string[] };

  it('manifest lists at least one pack', () => {
    expect(Array.isArray(manifest.packs)).toBe(true);
    expect(manifest.packs.length).toBeGreaterThan(0);
  });

  for (const file of manifest.packs) {
    it(`${file} validates with no errors`, () => {
      const { pack, errors } = validatePack(readPack(file));
      expect(errors).toEqual([]);
      expect(pack).toBeTruthy();
    });
  }
});
