// Content lint: loads the real bundled packs the way the app does (manifest
// order, validation, registry merge including the core-career fallback
// profiles) and checks them against WFRP 4e Core Rulebook fixtures plus the
// cross-references that otherwise fail silently at runtime — a career skill
// with no weapon to use it on, a critical that stacks a condition past its
// cap, or a demo character whose stored numbers disagree with the live rules.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readBundledPacks } from '../../../scripts/content-coverage.mjs';
import type { Character } from '@/data/character';
import { talentMaxRank } from '@/utils/advancement';
import { apByLocation, AP_LOCATIONS, skillNameKey } from '@/utils/combat';
import { deriveStats } from '@/utils/derived';
import { charVars, evalFormula } from '@/utils/formula';
import { testSafeRegex } from '@/utils/safeRegex';
import { skillDefForName } from '@/utils/skills';
import { talentDefForTalent } from '@/utils/talents';
import { ContentRegistry } from './registry';
import type { ArmourDef, ContentPack, Race, SkillDef, TalentDef, WeaponDef } from './types';
import { validatePack } from './validate';

const packs: ContentPack[] = readBundledPacks(fileURLToPath(new URL('../../public/content', import.meta.url)))
  .map((raw: unknown) => {
    const { pack, errors } = validatePack(raw);
    if (!pack) throw new Error(`Bundled pack failed validation: ${errors.join('; ')}`);
    return pack;
  });
const registry = new ContentRegistry(packs);
const { combat, formulas } = registry.system;

const weapon = (id: string): WeaponDef | undefined => registry.allWeapons.find(entry => entry.id === id);
const armour = (id: string): ArmourDef | undefined => registry.allArmour.find(entry => entry.id === id);
const talent = (name: string): TalentDef | undefined => registry.allTalentDefs.find(entry => entry.name === name);
const skill = (name: string): SkillDef | undefined => registry.allSkillDefs.find(entry => entry.name === name);
const isRangedGroup = (group: string): boolean => testSafeRegex(combat.rangedGroupPattern, group);
const skillForGroup = (group: string): string =>
  (isRangedGroup(group) ? combat.rangedSkillPattern : combat.meleeSkillPattern).replace('{group}', group);

/** Live characteristic list for a template, as useCharacteristics builds it. */
function liveCharacteristics(character: Character) {
  return character.characteristics.map(characteristic => {
    const current = characteristic.init + characteristic.adv;
    return { ...characteristic, current, bonus: evalFormula(formulas.bonus, { value: current }) };
  });
}

describe('WFRP 4e armour', () => {
  it.each([
    ['arm.leather-jack', ['Body', 'Arms'], 1],
    ['arm.leather-leggings', ['Legs'], 1],
    ['arm.mail-shirt', ['Body'], 2],
    ['arm.mail-coat', ['Body', 'Arms'], 2],
    ['arm.plate-breastplate', ['Body'], 2],
    ['arm.plate-vambraces', ['Arms'], 2],
    ['arm.plate-leggings', ['Legs'], 2],
    ['arm.open-helm', ['Head'], 2],
  ] as const)('%s covers %j at %i AP', (id, locs, ap) => {
    expect(armour(id)).toMatchObject({ locs: [...locs], ap });
  });

  it('keeps the plate and open-helm qualities', () => {
    for (const id of ['arm.plate-breastplate', 'arm.plate-vambraces', 'arm.plate-leggings']) {
      expect(armour(id)?.qual, id).toEqual(['Impenetrable', 'Weakpoints']);
    }
    expect(armour('arm.open-helm')?.qual).toEqual(['Partial']);
  });
});

describe('WFRP 4e weapons', () => {
  it.each([
    ['wp.hand-weapon-sword', { group: 'Basic', reach: 'Average', dmg: 'SB+4', qual: [] }],
    ['wp.dagger', { group: 'Basic', reach: 'Very Short', dmg: 'SB+2', qual: [] }],
    ['wp.warhammer', { group: 'Two-Handed', enc: 3, reach: 'Average', dmg: 'SB+6', qual: ['Damaging', 'Pummel', 'Slow'] }],
    ['wp.quarterstaff', { group: 'Polearm', reach: 'Long', dmg: 'SB+4', qual: ['Defensive', 'Pummel'] }],
    ['wp.halberd', { group: 'Polearm', reach: 'Long', dmg: 'SB+4', qual: ['Defensive', 'Hack', 'Impale'] }],
    ['wp.spear', { group: 'Polearm', reach: 'Very Long', dmg: 'SB+4', qual: ['Impale'] }],
    ['wp.unarmed', { group: 'Brawling', reach: 'Personal', dmg: 'SB+0', qual: ['Undamaging'] }],
    ['wp.knuckledusters', { group: 'Brawling', reach: 'Personal', dmg: 'SB+2', qual: [] }],
    ['wp.cavalry-hammer', { group: 'Cavalry', reach: 'Long', dmg: 'SB+5', qual: ['Pummel'] }],
    ['wp.lance', { group: 'Cavalry', reach: 'Very Long', dmg: 'SB+6', qual: ['Impact', 'Impale'] }],
    ['wp.rapier', { group: 'Fencing', reach: 'Long', dmg: 'SB+4', qual: ['Fast', 'Impale'] }],
    ['wp.grain-flail', { group: 'Flail', reach: 'Average', dmg: 'SB+3', qual: ['Distract', 'Imprecise', 'Wrap'] }],
    ['wp.flail', { group: 'Flail', reach: 'Average', dmg: 'SB+5', qual: ['Distract', 'Wrap'] }],
    ['wp.longbow', { group: 'Bow', range: '100', dmg: 'SB+4', qual: ['Damaging'] }],
    ['wp.crossbow', { group: 'Crossbow', range: '60', dmg: '9', qual: ['Reload 1'] }],
    ['wp.sling', { group: 'Sling', range: '60', dmg: '6', qual: [] }],
    ['wp.throwing-axe', { group: 'Throwing', range: 'SBx2', dmg: 'SB+3', qual: ['Hack'] }],
    ['wp.pistol', { group: 'Blackpowder', range: '20', dmg: '8', qual: ['Blackpowder', 'Pistol', 'Reload 1'] }],
    ['wp.handgun', { group: 'Blackpowder', range: '50', dmg: '9', qual: ['Blackpowder', 'Dangerous', 'Reload 3'] }],
  ] as const)('%s has its Core profile', (id, profile) => {
    expect(weapon(id)).toMatchObject(profile);
  });

  it('gives ranged groups a range and melee groups a reach, with a computable Damage', () => {
    const sample = liveCharacteristics(registry.getCharacterTemplate('c1')!);
    const vars = charVars(sample);
    for (const entry of registry.allWeapons) {
      const ranged = isRangedGroup(entry.group);
      expect(ranged ? entry.range : entry.reach, `${entry.id} distance`).toBeTruthy();
      expect(ranged ? entry.reach : entry.range, `${entry.id} stray distance`).toBeUndefined();
      expect(() => evalFormula(entry.dmg, vars), `${entry.id} damage "${entry.dmg}"`).not.toThrow();
    }
  });

  it.each(['Blackpowder', 'Bow', 'Crossbow', 'Engineering', 'Entangling', 'Explosives', 'Sling', 'Throwing'])(
    '%s is a Ranged specialisation', group => expect(isRangedGroup(group)).toBe(true),
  );

  it.each(['Basic', 'Brawling', 'Cavalry', 'Fencing', 'Flail', 'Parry', 'Polearm', 'Two-Handed'])(
    '%s is a Melee specialisation', group => expect(isRangedGroup(group)).toBe(false),
  );
});

describe('career weapon skills', () => {
  // A player picks the concrete specialisation, so no single weapon group applies.
  const ALLOWED_WITHOUT_WEAPON: Record<string, string> = {
    [skillNameKey('Ranged (Any)')]: '"(Any)" is chosen by the player when the skill is taken',
    [skillNameKey('Melee (Any)')]: '"(Any)" is chosen by the player when the skill is taken',
  };
  const combatSkill = new RegExp(`^(?:${[combat.meleeSkillPattern, combat.rangedSkillPattern]
    .map(pattern => pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{group\\}', '.+'))
    .join('|')})$`, 'i');

  it('offers at least one bundled weapon for every Melee/Ranged specialisation a career trains', () => {
    const weaponSkills = new Set(registry.allWeapons.map(entry => skillNameKey(skillForGroup(entry.group))));
    const missing: string[] = [];
    for (const career of registry.allCareers) {
      for (const name of career.advanceScheme?.skills ?? []) {
        if (!combatSkill.test(name)) continue;
        const key = skillNameKey(name);
        if (!weaponSkills.has(key) && !(key in ALLOWED_WITHOUT_WEAPON)) missing.push(`${career.id}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('matches specialisations that differ from the weapon group only in case', () => {
    const trained = registry.allCareers.flatMap(career => career.advanceScheme?.skills ?? []);
    expect(trained).toContain('Melee (Two-handed)');
    expect(registry.allWeapons.some(entry => skillNameKey(skillForGroup(entry.group))
      === skillNameKey('Melee (Two-handed)'))).toBe(true);
  });
});

describe('WFRP 4e talents', () => {
  it.each([
    ['Warrior Born', 'Weapon Skill'], ['Marksman', 'Ballistic Skill'], ['Very Strong', 'Strength'],
    ['Very Resilient', 'Toughness'], ['Sharp', 'Initiative'], ['Lightning Reflexes', 'Agility'],
    ['Nimble Fingered', 'Dexterity'], ['Savvy', 'Intelligence'], ['Coolheaded', 'Willpower'], ['Suave', 'Fellowship'],
  ])('%s is Max 1 and grants +5 %s', (name, characteristic) => {
    const definition = talent(name);
    expect(definition?.max).toBe(1);
    expect(definition?.maxChar).toBeUndefined();
    expect(definition?.description).toContain(`+5 to your ${characteristic}`);
  });

  it.each([
    'Fleet Footed', 'Arcane Magic', 'Petty Magic', 'Bless', 'Invoke', 'Frenzy', 'Slayer', 'Battle Rage',
    'Deadeye Shot', 'Sharpshooter', 'War Wizard', 'Jump Up', 'Doomed', 'Noble Blood', 'Read/Write', 'Small',
  ])('%s is Max 1', name => {
    expect(talent(name)?.max).toBe(1);
  });

  it.each([
    ['Accurate Shot', 'bs'], ['Strong-minded', 'wp'], ['Night Vision', 'i'], ['Hardy', 't'], ['Acute Sense', 'i'],
  ] as const)('%s is capped by the %s Bonus', (name, key) => {
    expect(talent(name)).toMatchObject({ maxChar: key });
    expect(talent(name)?.max).toBeUndefined();
  });

  it('describes Fleet Footed, Accurate Shot and Strong-minded by their 4e effect', () => {
    expect(talent('Fleet Footed')?.description).toMatch(/\+1 to your Movement/);
    expect(talent('Accurate Shot')?.description).toMatch(/Damage/);
    expect(talent('Strong-minded')?.description).toMatch(/maximum Resolve/);
  });
});

describe('WFRP 4e skills', () => {
  it.each([
    ['Art', 'dex', false, true], ['Melee', 'ws', false, true], ['Ranged', 'bs', true, true],
    ['Swim', 's', true, false], ['Animal Care', 'int', true, false], ['Animal Training', 'int', true, true],
    ['Evaluate', 'int', true, false], ['Heal', 'int', true, false], ['Pray', 'fel', true, false],
    ['Perform', 'ag', true, true], ['Play', 'dex', true, true], ['Entertain', 'fel', false, true],
  ] as const)('%s tests %s (advanced %s, grouped %s)', (name, char, advanced, grouped) => {
    expect(skill(name)).toMatchObject({ char, advanced, grouped });
  });
});

describe('WFRP 4e magic', () => {
  it('casts every Petty spell at CN 0', () => {
    const pettyLore = registry.creation?.pettyLore;
    expect(pettyLore).toBeTruthy();
    const petty = registry.allSpells.filter(spell => spell.lore === pettyLore);
    expect(petty.length).toBeGreaterThan(0);
    expect(petty.filter(spell => spell.cn !== 0).map(spell => `${spell.id}=${spell.cn}`)).toEqual([]);
  });
});

describe('WFRP 4e species', () => {
  it.each([
    ['race.human', {}, 2, 1, 3, 4],
    ['race.dwarf', { ws: 10, t: 10, ag: -10, dex: 10, wp: 20, fel: -10 }, 0, 2, 2, 3],
    ['race.halfling', { ws: -10, bs: 10, s: -10, dex: 10, wp: 10, fel: 10 }, 0, 2, 3, 3],
    ['race.high-elf', { ws: 10, bs: 10, i: 20, ag: 10, dex: 10, int: 10, wp: 10 }, 0, 0, 2, 5],
    ['race.wood-elf', { ws: 10, bs: 10, i: 20, ag: 10, dex: 10, int: 10, wp: 10, fel: -10 }, 0, 0, 2, 5],
  ] as const)('%s', (id, charModifiers, fate, resilience, extra, movement) => {
    const race: Race | undefined = registry.getRace(id);
    expect(race?.charModifiers).toEqual(charModifiers);
    expect(race).toMatchObject({ fate, resilience, extra, movement });
  });
});

describe('conditions and critical wounds', () => {
  it('lets stacking conditions stack and keeps the non-stacking ones binary', () => {
    const cap = (name: string) => registry.conditions.find(condition => condition.name === name)?.maxStacks;
    for (const name of ['Prone', 'Surprised', 'Unconscious']) expect(cap(name), name).toBe(1);
    for (const name of ['Ablaze', 'Bleeding', 'Blinded', 'Broken', 'Deafened', 'Entangled', 'Fatigued', 'Poisoned', 'Stunned']) {
      expect(cap(name), name).toBeGreaterThanOrEqual(4);
    }
  });

  it('applies only the per-character test penalties 4e gives', () => {
    const penalties = Object.fromEntries(registry.conditions
      .filter(condition => condition.penalty !== undefined)
      .map(condition => [condition.name, condition.penalty]));
    expect(penalties).toEqual({ Fatigued: -10, Poisoned: -10, Stunned: -10 });
  });

  it('keeps every critical wound condition known and within its maxStacks', () => {
    const caps = new Map(registry.conditions.map(condition => [condition.name, condition.maxStacks ?? 2]));
    const rows = [
      ...registry.criticals.map(critical => ({ where: `criticals: ${critical.name}`, conditions: critical.conditions })),
      ...registry.criticalTables.flatMap(table => table.rows.map(row => ({
        where: `${table.locations.join('/')}: ${row.name}`, conditions: row.conditions,
      }))),
    ];
    const problems: string[] = [];
    for (const row of rows) {
      for (const [name, stacks] of Object.entries(row.conditions ?? {})) {
        const cap = caps.get(name);
        if (cap === undefined) problems.push(`${row.where}: unknown condition ${name}`);
        else if (stacks > cap) problems.push(`${row.where}: ${name} ${stacks} > maxStacks ${cap}`);
      }
    }
    expect(rows.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});

describe('demo character templates', () => {
  const templates = registry.allCharacterTemplates;
  // Roster and summary tests pin Sigmund's rank-3 label, so his authored
  // ladder is kept until those fixtures move with it.
  const RANK_LADDER_EXCEPTIONS: Record<string, string> = {
    c1: 'RosterScreen/useCharacterSummary tests pin "Mounted Sergeant · Silver 4" at rank 3',
  };

  it('ships the four demo characters', () => {
    expect(templates.map(template => template.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it.each(templates.map(template => [template.id, template] as const))(
    '%s stores the Max Wounds the live formula derives', (_id, template) => {
      const derived = deriveStats(
        template,
        liveCharacteristics(template),
        template.talents,
        registry.allRaces,
        registry.woundsRules,
        formulas,
      );
      expect(template.wounds.max).toBe(derived.maxWounds);
      expect(template.wounds.current).toBeLessThanOrEqual(template.wounds.max);
    },
  );

  it('keeps skills on their definitions\' characteristic and Advanced flag', () => {
    const problems: string[] = [];
    for (const template of templates) {
      for (const entry of template.skills) {
        const definition = skillDefForName(registry.allSkillDefs, entry.name);
        if (!definition) problems.push(`${template.id}: ${entry.name} has no definition`);
        else if (entry.char !== definition.char || (entry.advanced ?? false) !== definition.advanced) {
          problems.push(`${template.id}: ${entry.name} ${entry.char}/${entry.advanced} vs ${definition.char}/${definition.advanced}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps talent ranks within each talent\'s Max', () => {
    const problems: string[] = [];
    for (const template of templates) {
      const bonus = Object.fromEntries(liveCharacteristics(template).map(entry => [entry.key, entry.bonus]));
      for (const entry of template.talents) {
        const cap = talentMaxRank(talentDefForTalent(registry.allTalentDefs, entry), key => bonus[key] ?? 0);
        if (cap !== undefined && entry.times > cap) problems.push(`${template.id}: ${entry.name} ×${entry.times} > Max ${cap}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('copies catalogue gear exactly and stores the AP its armour gives', () => {
    for (const template of templates) {
      for (const entry of template.weapons) {
        const catalogue = registry.allWeapons.find(candidate => candidate.name === entry.name);
        if (!catalogue) continue;
        const { id: _id, ...profile } = catalogue;
        expect(entry, `${template.id}: ${entry.name}`).toEqual(profile);
      }
      for (const entry of template.armour) {
        const catalogue = registry.allArmour.find(candidate => candidate.name === entry.name);
        if (!catalogue) continue;
        const { id: _id, ...profile } = catalogue;
        expect(entry, `${template.id}: ${entry.name}`).toEqual(profile);
      }
      const ap = apByLocation(template.armour);
      for (const location of AP_LOCATIONS) expect(template.ap[location], `${template.id} AP ${location}`).toBe(ap[location]);
    }
  });

  it('names career ranks, level and Status that exist in the character\'s career', () => {
    const problems: string[] = [];
    for (const template of templates) {
      const current = template.careerRanks.find(rank => rank.level === template.careerLevel);
      if (current?.name !== template.careerLevelName || current?.status !== template.status) {
        problems.push(`${template.id}: level ${template.careerLevel} is "${template.careerLevelName}" ${template.status}`);
      }
      const career = template.careerId ? registry.getCareer(template.careerId) : undefined;
      if (!career) {
        problems.push(`${template.id}: unknown career ${template.careerId}`);
        continue;
      }
      const ladder = (ranks: Array<{ level: number; name: string; status: string }>) =>
        ranks.map(rank => `${rank.level}:${rank.name}/${rank.status}`).join(' | ');
      const matches = ladder(template.careerRanks) === ladder(career.ranks);
      if (template.id in RANK_LADDER_EXCEPTIONS) {
        expect(matches, `${template.id} exception is stale: ${RANK_LADDER_EXCEPTIONS[template.id]}`).toBe(false);
      } else if (!matches) {
        problems.push(`${template.id}: [${ladder(template.careerRanks)}] vs ${career.id} [${ladder(career.ranks)}]`);
      }
    }
    expect(problems).toEqual([]);
  });
});
