import { describe, expect, it } from 'vitest';

import characterPack from '../../public/content/core-characters.json';
import talentPack from '../../public/content/core-talents.json';
import { ContentRegistry } from './registry';
import type { ContentPack, TalentDef } from './types';
import { validatePack } from './validate';
import { resolveStoredTalentRef, talentIdentityKey } from '../utils/talents';

const registry = new ContentRegistry([
  talentPack,
  characterPack,
] as unknown as ContentPack[]);

const EXPECTED_REFS = {
  c1: [
    ['Sure Shot', 'tal.sure-shot', null],
    ['Sharp', 'tal.sharp', null],
    ['Hardy', 'tal.hardy', null],
    ['Lightning Reflexes', 'tal.lightning-reflexes', null],
    ['Menacing', 'tal.menacing', null],
  ],
  c2: [
    ['Petty Magic', 'tal.petty-magic', null],
    ['Arcane Magic (Fire)', 'tal.arcane-magic', 'Fire'],
    ['Aethyric Attunement', 'tal.aethyric-attunement', null],
    ['Read/Write', 'tal.read-write', null],
  ],
  c3: [
    ['Hardy', 'tal.hardy', null],
    ['Second Sight', 'tal.second-sight', null],
    ['Read/Write', 'tal.read-write', null],
    ['Strong-minded', 'tal.strong-minded', null],
    ['Night Vision', 'tal.night-vision', null],
    ['Sturdy', 'tal.sturdy', null],
  ],
  c4: [
    ['Bless (Shallya)', 'tal.bless', 'Shallya'],
    ['Invoke (Shallya)', 'tal.invoke', 'Shallya'],
    ['Read/Write', 'tal.read-write', null],
    ['Cat-tongued', 'tal.cat-tongued', null],
  ],
} as const;

const GROUPED_DEFINITION_IDS = new Map([
  ['Arcane Magic', 'tal.arcane-magic'],
  ['Bless', 'tal.bless'],
  ['Invoke', 'tal.invoke'],
]);

function expectedDefinition(
  definitions: TalentDef[],
  name: string,
): { definition?: TalentDef; specialization?: string } {
  const exact = definitions.find(definition => definition.name === name);
  if (exact) return { definition: exact };

  const grouped = name.match(/^(.+) \(([^()]+)\)$/);
  const definitionId = grouped ? GROUPED_DEFINITION_IDS.get(grouped[1]) : undefined;
  return {
    definition: definitions.find(definition => definition.id === definitionId),
    specialization: definitionId ? grouped?.[2] : undefined,
  };
}

describe('core character Talent identities', () => {
  it('keeps the changed character and Talent packs valid', () => {
    expect(characterPack.version).toBe('2026.08.21');
    expect(validatePack(characterPack).errors).toEqual([]);
    expect(validatePack(characterPack).warnings).toEqual([]);
    expect(validatePack(talentPack).errors).toEqual([]);
    expect(validatePack(talentPack).warnings).toEqual([]);
  });

  it('pins every seeded Talent to its expected stable definition', () => {
    const actual = Object.fromEntries(Object.keys(EXPECTED_REFS).map(characterId => {
      const character = registry.getCharacterTemplate(characterId);
      expect(character, characterId).toBeDefined();
      return [
        characterId,
        character?.talents.map(talent => [
          talent.name,
          talent.definitionId,
          talent.specialization ?? null,
        ]),
      ];
    }));

    expect(actual).toEqual(EXPECTED_REFS);
  });

  it('resolves exact and bounded grouped forms without duplicate identities', () => {
    const definitions = registry.allTalentDefs;

    for (const characterId of Object.keys(EXPECTED_REFS)) {
      const character = registry.getCharacterTemplate(characterId);
      expect(character, characterId).toBeDefined();
      if (!character) continue;

      const identities = character.talents.map(talent => talentIdentityKey(talent));
      expect(new Set(identities).size, character.name).toBe(identities.length);

      for (const talent of character.talents) {
        const expected = expectedDefinition(definitions, talent.name);
        expect(expected.definition, `${character.name}: ${talent.name}`).toBeDefined();
        expect(talent.definitionId, `${character.name}: ${talent.name}`)
          .toBe(expected.definition?.id);
        expect(talent.specialization, `${character.name}: ${talent.name}`)
          .toBe(expected.specialization);

        const resolved = resolveStoredTalentRef(definitions, talent);
        expect(resolved.definition?.id, `${character.name}: ${talent.name}`)
          .toBe(expected.definition?.id);
        expect(resolved.name, `${character.name}: ${talent.name}`).toBe(talent.name);
      }
    }
  });
});
