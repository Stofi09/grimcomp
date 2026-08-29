import { describe, expect, it } from 'vitest';
import type { SkillDef } from '@/content/types';
import {
  skillDefForName,
  skillRulesStatusLabel,
  skillRulesStatusMeta,
  skillSourceLabel,
} from './skills';

const skills: SkillDef[] = [{
  id: 'sk.augury',
  name: 'Augury',
  char: 'int',
  advanced: true,
  grouped: false,
  description: 'Interpret omens.',
  sourceBook: 'Winds of Magic',
  sourcePage: 44,
  rulesStatus: 'bibliographic',
}, {
  id: 'sk.trade',
  name: 'Trade',
  char: 'dex',
  advanced: true,
  grouped: true,
  description: 'Ply a trade.',
}];

describe('skill definition helpers', () => {
  it('resolves exact and grouped character-level names', () => {
    expect(skillDefForName(skills, 'Augury')?.id).toBe('sk.augury');
    expect(skillDefForName(skills, 'Trade (Alchemist)')?.id).toBe('sk.trade');
    expect(skillDefForName(skills, 'Trader (Alchemist)')).toBeUndefined();
  });

  it('formats source and bibliographic status disclosures', () => {
    expect(skillSourceLabel(skills[0])).toBe('Winds of Magic · p. 44');
    expect(skillRulesStatusMeta(skills[0])).toBe('Index only');
    expect(skillRulesStatusLabel(skills[0])).toBe(
      'Index only — resolve its special procedure from the source',
    );
  });
});
