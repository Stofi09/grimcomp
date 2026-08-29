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

  it('accepts a stable Career id on a character and rejects a blank one', () => {
    const character = {
      id: 'char.test',
      name: 'Test Character',
      species: 'Human',
      class: 'Academic',
      career: 'Wizard',
      careerId: 'car.wizard',
      characteristics: [],
      skills: [],
      talents: [],
      careerRanks: [],
      wounds: { current: 1, max: 1 },
    };
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
