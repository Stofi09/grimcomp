import { useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { Pill } from '@/components/Pill';
import { Stepper } from '@/components/Stepper';
import { Alert } from '@/ui/alertStore';
import { runStoredTransaction, useStoredState } from '@/hooks/useStoredState';
import { useRoster } from '@/hooks/useRoster';
import { useCharacter } from '@/hooks/useCharacter';
import {
  type Character, type CharacteristicKey, type Skill, type Talent,
  type Weapon, type Armour, type Trapping,
} from '@/data/character';
import {
  useRaces, useSkillDefs, useTalentDefs, useCareers, useContent,
  useCreation, useCharacteristicDefs, useWoundsRules, useSystemRules,
} from '@/content/useContent';
import type {
  Race, SkillDef, TalentDef, Spell, Prayer, Career,
  CharacteristicDef, WoundsRules, CreationConfig, SystemRules,
} from '@/content/types';
import {
  startingXp, careerChoiceXp, statusTier, startingMoney, startingMoneyDice,
  distributeStartingAdvances, inferCareerCapabilities, pickDistinct, rollStat, type CareerMode,
} from '@/utils/creation';
import { charVars, evalFormula } from '@/utils/formula';
import { rollDice } from '@/utils/roll';
import { resolveStoredTalentRef, talentDefForName } from '@/utils/talents';
import { colors } from '@/theme';
import './NewCharScreen.css';

interface Props {
  onNav: (id: string) => void;
}

const STEPS = ['Name & Species', 'Characteristics', 'Career', 'Review'];

interface Draft {
  name: string;
  species: string;
  /** Whether the species was randomly determined (+20 XP, CRB p.36). */
  speciesRandom: boolean;
  /** A random-species result may only be generated once per draft. */
  speciesRollLocked: boolean;
  /** How the career was settled: accept-first (+50), roll-three (+25), choose (+0). */
  careerMode: CareerMode;
  /** Prevents rerolling after seeing a rewarded career result. */
  careerRollLocked: boolean;
  /** The chosen career id. */
  careerId: string;
  /** The three ids rolled for the roll-three option (mode === 'three'). */
  careerChoices: string[];
  /** Per-characteristic rolled initial value (replaces the flat base). */
  inits: Partial<Record<CharacteristicKey, number>>;
  /** How many of the species' Extra points go to Fate (the rest to Resilience). */
  extraToFate: number;
}

// Fallback creation config, used only while the content packs are still loading.
const FALLBACK_CREATION: CreationConfig = {
  statRoll: { count: 2, sides: 10, plus: 20 },
  archetypes: [],
  defaults: { species: 'Human', archetype: 'warrior' },
  pettyLore: 'Petty',
  anyDeity: 'Any',
};

const CLASS_ACCENT: Record<string, string> = {
  Academic: '#9a7d1f', Burgher: '#5a6b8c', Courtier: '#8c5a7a', Peasant: '#6a7a4a',
  Ranger: '#8b5a2d', Riverfolk: '#3d6b6b', Rogue: '#5a5a6a', Warrior: '#8b2d2d',
};

const rerollInits = (
  charKeys: CharacteristicKey[],
  roll: CreationConfig['statRoll'],
): Draft['inits'] => {
  const out: Draft['inits'] = {};
  for (const k of charKeys) out[k] = rollStat(roll.count, roll.sides, roll.plus);
  return out;
};

/**
 * Build a character from the WFRP 4e creation choices. Species supplies
 * characteristic modifiers, Fate/Resilience (+ the allocated Extra), Movement,
 * and granted skills/talents; the chosen career supplies identity, ranks,
 * class, status, free advances, and one starting Talent. Archetypes only supply
 * novice spell/prayer identity; experienced demo-character advances and gear
 * are deliberately excluded. Every new character receives a basic starter kit.
 */
const buildCharacter = (
  draft: Draft,
  newId: string,
  career: Career,
  race: Race | undefined,
  kitTpl: Character | undefined,
  hasArchetypeTemplate: boolean,
  skillDefs: SkillDef[],
  talentDefs: TalentDef[],
  spells: Spell[],
  prayers: Prayer[],
  charDefs: CharacteristicDef[],
  wounds: WoundsRules,
  creation: CreationConfig,
  system: SystemRules,
  wealth: Record<string, number>,
): Character => {
  const rank1 = career.ranks[0];
  const caps = hasArchetypeTemplate && kitTpl
    ? { isCaster: !!kitTpl.isCaster, isAnointed: !!kitTpl.isAnointed }
    : inferCareerCapabilities(career);
  const accent = hasArchetypeTemplate && kitTpl ? kitTpl.accent : (CLASS_ACCENT[career.class] ?? '#8b2d2d');

  // The rulebook grants five free advances split between the three rank-one
  // career Characteristics. Until the wizard offers a manual allocator, use a
  // balanced 2/2/1 split instead of silently discarding them.
  const characteristicAdvances = distributeStartingAdvances(
    (career.advanceScheme?.characteristics ?? []).slice(0, 3),
    5,
  );

  const characteristics = charDefs.map(d => ({
    key: d.key,
    name: d.name,
    short: d.short,
    init: (draft.inits[d.key] ?? creation.statRoll.plus) + (race?.charModifiers?.[d.key] ?? 0),
    adv: characteristicAdvances[d.key] ?? 0,
  }));

  const initials = draft.name.split(/\s+/).filter(Boolean).map(s => s[0]?.toUpperCase()).join('').slice(0, 2) || 'XX';

  const vars = charVars(characteristics.map(c => ({
    key: c.key,
    short: c.short,
    current: c.init + c.adv,
    bonus: evalFormula(system.formulas.bonus, { value: c.init + c.adv }),
  })));

  // The first-tier career grants 40 advances across up to eight skills, capped
  // at 10 each. Use an even legal distribution until manual allocation exists.
  const careerSkillNames = (career.advanceScheme?.skills ?? []).slice(0, 8);
  const careerSkillAdvances = distributeStartingAdvances(careerSkillNames, 40, 10);

  // Career skills come from the rank-one scheme, never an experienced demo
  // character. Then layer the simplified species-granted skill advances.
  const skills: Skill[] = [];
  for (const nm of careerSkillNames) {
    // Exact match first; then a grouped-skill specialisation ("Lore (Theology)"
    // → base "Lore"). The " (" boundary keeps "Ride" from matching
    // "Ride (Horse)" by bare prefix and mis-assigning its characteristic.
    const def = skillDefs.find(d => d.name === nm) ?? skillDefs.find(d => nm.startsWith(`${d.name} (`));
    skills.push({
      name: nm,
      char: def?.char ?? charDefs[0]?.key ?? 'ws',
      adv: careerSkillAdvances[nm] ?? 0,
      career: true,
      advanced: def?.advanced,
    });
  }
  const haveSkill = new Set(skills.map(s => s.name));
  for (const id of race?.skills ?? []) {
    const def = skillDefs.find(d => d.id === id);
    if (!def) continue;
    const existing = skills.find(s => s.name === def.name);
    if (existing) {
      existing.adv += 5;
    } else if (!haveSkill.has(def.name)) {
      skills.push({ name: def.name, char: def.char, adv: 5, career: false, advanced: def.advanced });
      haveSkill.add(def.name);
    }
  }

  // Choose the first available rank-one career talent as a deterministic
  // default, then add the species talents. Experienced template talents are
  // deliberately not copied into a new rank-one character.
  const talents: Talent[] = [];
  const careerTalent = (career.advanceScheme?.talents ?? [])
    .map(name => ({ name, definition: talentDefForName(talentDefs, name) }))
    // A parameterised Talent needs an explicit player choice. Creation does
    // not collect that choice yet, so skip generalized headings instead of
    // persisting an invalid unspecialised Talent; it remains available from
    // the Talent manager after creation.
    .find(candidate => candidate.definition && !candidate.definition.specializations?.length);
  if (careerTalent) {
    const resolved = resolveStoredTalentRef(talentDefs, { name: careerTalent.name });
    talents.push({
      name: resolved.name,
      definitionId: careerTalent.definition?.id,
      specialization: resolved.specialization,
      times: 1,
      desc: careerTalent.definition?.description ?? '',
      career: true,
    });
  }
  const haveTalent = new Set(talents.map(t => t.name));
  for (const id of race?.talents ?? []) {
    const def = talentDefs.find(d => d.id === id);
    if (def && !def.specializations?.length && !haveTalent.has(def.name)) {
      talents.push({
        definitionId: def.id,
        name: def.name,
        times: 1,
        desc: def.description,
        career: false,
      });
      haveTalent.add(def.name);
    }
  }

  const bonusTalent = wounds.bonusTalent;
  const bonusRanks = talents
    .filter(t => t.name === bonusTalent)
    .reduce((sum, talent) => sum + talent.times, 0);
  const small = race?.size !== undefined && wounds.smallSizes.includes(race.size);
  const wMax = evalFormula(system.formulas.maxWounds, {
    ...vars,
    small: small ? 1 : 0,
    bonusRanks,
  });

  // Fresh-character kit plus optional novice spell/prayer identity.
  let weapons: Weapon[];
  let armour: Armour[];
  let trappings: Trapping[];
  let knownSpells: string[];
  let knownPrayers: string[];
  let spellLore: string | undefined;
  let deity: string | undefined;
  if (hasArchetypeTemplate && kitTpl) {
    // Archetypes contribute only their novice spell/prayer identity. Their
    // equipment belongs to higher-rank demo characters and is not a safe
    // starting loadout, so every fresh character receives the same basic kit.
    weapons = [
      { name: 'Hand Weapon', group: 'Basic', enc: 1, reach: 'Average', dmg: 'SB+4', qual: [] },
      { name: 'Dagger', group: 'Basic', enc: 0, reach: 'Short', dmg: 'SB+2', qual: [] },
    ];
    armour = [];
    trappings = [{ name: 'Clothing', enc: 0 }, { name: 'Backpack', enc: 0 }];
    knownSpells = (kitTpl.knownSpells ?? []).filter(id => spells.find(s => s.id === id)?.lore === creation.pettyLore);
    knownPrayers = (kitTpl.knownPrayers ?? []).filter(id => prayers.find(p => p.id === id)?.deity === creation.anyDeity);
    spellLore = caps.isCaster ? creation.pettyLore : undefined;
    deity = kitTpl.deity;
  } else {
    weapons = [
      { name: 'Hand Weapon', group: 'Basic', enc: 1, reach: 'Average', dmg: 'SB+4', qual: [] },
      { name: 'Dagger', group: 'Basic', enc: 0, reach: 'Short', dmg: 'SB+2', qual: [] },
    ];
    armour = [];
    trappings = [{ name: 'Clothing', enc: 0 }, { name: 'Backpack', enc: 0 }];
    // Casters start with the Petty spells; the Anointed with deity-agnostic Blessings.
    knownSpells = caps.isCaster ? spells.filter(s => s.lore === creation.pettyLore).map(s => s.id) : [];
    knownPrayers = caps.isAnointed ? prayers.filter(p => p.deity === creation.anyDeity).map(p => p.id) : [];
    spellLore = caps.isCaster ? creation.pettyLore : undefined;
    deity = undefined;
  }

  // Fate / Resilience: species base + the allocated Extra points.
  const extra = race?.extra ?? 0;
  const toFate = Math.max(0, Math.min(extra, draft.extraToFate));
  const fate = (race?.fate ?? 0) + toFate;
  const resilience = (race?.resilience ?? 0) + (extra - toFate);

  const careerRanks = career.ranks.map(r => ({ level: r.level, name: r.name, status: r.status }));
  const speciesRewardEarned = draft.speciesRandom && draft.speciesRollLocked !== false;
  const careerRewardEarned = draft.careerRollLocked !== false
    && (
      (draft.careerMode === 'first' && draft.careerId === career.id)
      || (draft.careerMode === 'three' && draft.careerChoices.includes(career.id))
    );

  return {
    id: newId,
    name: draft.name.trim() || `New ${career.name}`,
    species: draft.species,
    raceId: race?.id,
    class: career.class,
    careerId: career.id,
    career: career.name,
    careerLevel: 1,
    careerLevelName: rank1?.name ?? '',
    careerRanks,
    status: rank1?.status ?? '',
    initials,
    accent,
    characteristics,
    skills,
    talents,
    weapons,
    armour,
    trappings,
    knownSpells,
    knownPrayers,
    spellLore,
    deity,
    isCaster: caps.isCaster,
    isAnointed: caps.isAnointed,
    movement: race?.movement ?? kitTpl?.movement ?? 0,
    fate,
    fortune: fate,
    resilience,
    resolve: resilience,
    xpCurrent: startingXp(
      speciesRewardEarned,
      careerRewardEarned ? draft.careerMode : 'choose',
    ),
    xpSpent: 0,
    wounds: { current: wMax, max: wMax },
    corruption: 0,
    sin: 0,
    ap: { head: 0, arm_l: 0, arm_r: 0, body: 0, leg_l: 0, leg_r: 0, shield: 0 },
    conditions: [],
    criticals: [],
    wealth,
    age: 0,
    height: '',
    hair: '',
    eyes: '',
    motivation: '',
    ambitionsShort: '',
    ambitionsLong: '',
    psychology: [],
    mutations: [],
    party: { name: 'No party yet', short: 'Not yet part of an adventuring party.', members: [] },
  };
};

export const NewCharScreen: React.FC<Props> = ({ onNav }) => {
  const { add, nextId } = useRoster();
  const { setActive } = useCharacter();
  const races = useRaces();
  const careers = useCareers();
  const skillDefs = useSkillDefs();
  const talentDefs = useTalentDefs();
  const content = useContent();
  const charDefs = useCharacteristicDefs();
  const woundsRules = useWoundsRules();
  const system = useSystemRules();
  const creation = useCreation() ?? FALLBACK_CREATION;

  const charKeys = charDefs.map(c => c.key);

  const emptyDraft: Draft = {
    name: '',
    species: creation.defaults.species,
    speciesRandom: false,
    speciesRollLocked: false,
    careerMode: 'choose',
    careerRollLocked: false,
    careerId: '',
    careerChoices: [],
    inits: {},
    extraToFate: 3,
  };

  const [step, setStep] = useStoredState('gc.newchar.step', 0);
  const [draft, setDraft] = useStoredState<Draft>('gc.newchar.draft', emptyDraft);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  const race = races.find(r => r.name === draft.species);

  // Careers this species may take.
  const eligibleCareers = useMemo(
    () => careers.filter(cr => (
      cr.creationAvailable !== false
      && (!race || cr.species.length === 0 || cr.species.includes(race.id))
    )),
    [careers, race],
  );
  const randomCareers = useMemo(
    () => eligibleCareers.filter(cr => cr.randomEligible !== false),
    [eligibleCareers],
  );
  const careersByClass = useMemo(() => {
    const map = new Map<string, Career[]>();
    for (const cr of eligibleCareers) {
      const arr = map.get(cr.class) ?? [];
      arr.push(cr);
      map.set(cr.class, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [eligibleCareers]);

  const hasStartingCareerSkills = (career: Career): boolean =>
    (career.advanceScheme?.skills?.length ?? 0) > 0;
  const basicStartCount = eligibleCareers.filter(cr => !hasStartingCareerSkills(cr)).length;
  const approximateCount = eligibleCareers.filter(cr => cr.approximate).length;

  const chosenCareer = careers.find(cr => cr.id === draft.careerId);
  const archForChosen = creation.archetypes.find(a => a.careerId === draft.careerId);
  const kitTpl = archForChosen
    ? content.allCharacterTemplates.find(c => c.id === archForChosen.templateId)
    : undefined;
  const hasArchetypeTemplate = !!archForChosen && !!kitTpl;

  const rolled = Object.keys(draft.inits).length > 0;
  const totalRolled = charDefs.reduce(
    (sum, def) => sum + (draft.inits[def.key] ?? 0) + (race?.charModifiers?.[def.key] ?? 0),
    0,
  );
  // Treat rewarded results in an older persisted draft as already locked.
  const speciesRollLocked = draft.speciesRollLocked ?? draft.speciesRandom;
  const careerRollLocked = draft.careerRollLocked ?? (
    (draft.careerMode === 'first' && !!draft.careerId)
    || (draft.careerMode === 'three' && draft.careerChoices.length > 0)
  );

  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));

  const pickSpecies = (r: Race, random: boolean) => setDraft(current => {
    const priorCareerRollLocked = current.careerRollLocked ?? (
      (current.careerMode === 'first' && !!current.careerId)
      || (current.careerMode === 'three' && current.careerChoices.length > 0)
    );
    return {
      ...current,
      species: r.name,
      speciesRandom: random,
      speciesRollLocked: (current.speciesRollLocked ?? current.speciesRandom) || random,
      extraToFate: r.extra,
      careerMode: priorCareerRollLocked ? 'choose' : current.careerMode,
      careerRollLocked: priorCareerRollLocked,
      careerId: '',
      careerChoices: [],
    };
  });

  const rollSpecies = () => {
    if (races.length === 0 || speciesRollLocked) return;
    const r = races[Math.floor(Math.random() * races.length)];
    pickSpecies(r, true);
  };

  const rollOneCareer = () => {
    if (randomCareers.length === 0 || careerRollLocked) return;
    const cr = randomCareers[Math.floor(Math.random() * randomCareers.length)];
    set({ careerId: cr.id, careerChoices: [], careerRollLocked: true });
  };
  const rollThreeCareers = () => {
    if (randomCareers.length === 0 || careerRollLocked) return;
    const picks = pickDistinct(randomCareers, 3, [Math.random(), Math.random(), Math.random()]);
    set({ careerChoices: picks.map(c => c.id), careerId: '', careerRollLocked: true });
  };

  // Preview the would-be character for the Review step (no money rolled yet).
  const zeroWealth = Object.fromEntries(system.currency.units.map(u => [u.key, 0]));
  const preview = chosenCareer
    ? buildCharacter(
        draft, 'preview', chosenCareer, race, kitTpl, hasArchetypeTemplate, skillDefs, talentDefs,
        content.allSpells, content.allPrayers, charDefs, woundsRules, creation, system, zeroWealth,
      )
    : null;

  const identityReady = draft.name.trim().length > 0 && !!race;
  const characteristicsReady = charKeys.length > 0
    && charKeys.every(key => Number.isFinite(draft.inits[key]));
  const careerReady = !!chosenCareer && eligibleCareers.some(c => c.id === draft.careerId);
  const stepUnlocked = [
    true,
    identityReady,
    identityReady && characteristicsReady,
    identityReady && characteristicsReady && careerReady,
  ];
  const furthestUnlockedStep = stepUnlocked.reduce(
    (furthest, unlocked, index) => unlocked ? index : furthest,
    0,
  );

  // Older saved drafts may point at a future step without its prerequisites.
  // Pull them back to the furthest usable screen instead of rendering a blank
  // review panel with an invalid Finish action.
  useEffect(() => {
    if (step > furthestUnlockedStep) setStep(furthestUnlockedStep);
  }, [step, furthestUnlockedStep, setStep]);

  const canProceed = (() => {
    if (step === 0) return identityReady;
    if (step === 1) return characteristicsReady;
    if (step === 2) return careerReady;
    return true;
  })();

  const finish = async () => {
    if (savingRef.current) return;
    if (!draft.name.trim()) { Alert.alert('Name required', 'Please give your character a name first.'); return; }
    if (!race) { Alert.alert('Pick a species', 'Choose an available species first.'); return; }
    if (!characteristicsReady) { Alert.alert('Roll your stats', 'Roll characteristics on step 2 first.'); return; }
    if (!chosenCareer || !careerReady) { Alert.alert('Pick a career', 'Choose an eligible career on step 3 first.'); return; }

    // Roll starting money by the career's rank-1 Status tier.
    const tier = statusTier(chosenCareer.ranks[0]?.status ?? '');
    const rolls = Array.from({ length: startingMoneyDice(tier) }, () => rollDice({ count: 1, sides: 10 }));
    const wealth: Record<string, number> = {
      ...Object.fromEntries(system.currency.units.map(u => [u.key, 0])),
      ...startingMoney(tier, rolls),
    };

    const id = nextId();
    const c = buildCharacter(
      draft, id, chosenCareer, race, kitTpl, hasArchetypeTemplate, skillDefs, talentDefs,
      content.allSpells, content.allPrayers, charDefs, woundsRules, creation, system, wealth,
    );
    savingRef.current = true;
    setSaving(true);
    const result = await (async () => {
      try {
        const ticket = runStoredTransaction(() => {
          add(c);
          setActive(id);
          setDraft(emptyDraft);
          setStep(0);
        });
        return await ticket.completion;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    })();
    if (!result.ok) {
      Alert.alert(
        'Character not created',
        `Nothing was changed because the character could not be saved. ${result.error.message}`,
      );
      return;
    }
    // The button promises to finish AND switch. Navigate before showing the
    // confirmation so Escape/backdrop dismissal cannot strand the user in a
    // freshly reset wizard. Both happen only after the four-key transaction is
    // durably verified.
    onNav('overview');
    Alert.alert(
      'Character created',
      `${c.name} — ${c.species} ${c.career}. Starting XP ${c.xpCurrent}; ` +
        `money ${system.currency.units.map(u => `${wealth[u.key] ?? 0} ${u.label}`).join(', ')}.`,
      [{ text: 'Done' }],
    );
  };

  const xpFor = (mode: CareerMode) => careerChoiceXp(mode);

  return (
    <ScreenContainer>
      <Hero
        title="New character"
        subRow={<span className="nc-sub">A streamlined rank-one build with legal starting advances.</span>}
      />

      <div className="nc-steps">
        {STEPS.map((s, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <button
              key={s}
              type="button"
              className="btn-reset nc-step-cell"
              onClick={() => setStep(i)}
              disabled={!stepUnlocked[i]}
              aria-current={current ? 'step' : undefined}
              aria-label={`Step ${i + 1}: ${s}`}
            >
              <span
                className="nc-line"
                style={{
                  backgroundColor: done ? colors.brass : colors.divider,
                  left: i === 0 ? '50%' : 0,
                  right: i === STEPS.length - 1 ? '50%' : 0,
                }}
              />
              <span
                className="nc-dot"
                style={{
                  backgroundColor: done ? colors.brass : current ? colors.empire : colors.surface,
                  borderColor: done ? colors.brass : current ? colors.empireDeep : colors.border,
                  borderWidth: current ? 2 : 1,
                }}
              >
                <span className="nc-dot-text" style={{ color: done || current ? '#fff' : colors.ink3 }}>{i + 1}</span>
              </span>
              <span className={current ? 'nc-step-label nc-step-label--current' : 'nc-step-label'}>{s}</span>
            </button>
          );
        })}
      </div>

      {step === 0 ? (
        <Card>
          <span className="nc-label">Step 1</span>
          <span className="nc-heading">Name &amp; species</span>
          <span className="nc-body">What does your character call themselves, and what people are they?</span>

          <label className="nc-field-label" htmlFor="nc-character-name">Name</label>
          <input
            id="nc-character-name"
            className="nc-input"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. Magnus Brenner"
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
          />

          <div className="nc-row-between" style={{ marginTop: 8 }}>
            <span className="nc-field-label">Species</span>
            <Button
              variant="ghost"
              iconLeft={<Icon name="dice" size={12} color={colors.ink2} />}
              onPress={rollSpecies}
              disabled={speciesRollLocked}
            >
              {speciesRollLocked ? 'First species roll used' : 'Roll once (+20 XP)'}
            </Button>
          </div>
          <div className="nc-options-row">
            {races.map(r => {
              const on = draft.species === r.name;
              return (
                <button
                  key={r.id}
                  type="button"
                  className={on ? 'btn-reset nc-option nc-option--on' : 'btn-reset nc-option'}
                  onClick={() => pickSpecies(r, false)}
                  aria-pressed={on}
                >
                  <span className={on ? 'nc-option-text nc-option-text--on' : 'nc-option-text'}>{r.name}</span>
                </button>
              );
            })}
          </div>
          {draft.speciesRandom ? (
            <span className="nc-arch-meta" style={{ marginTop: 6 }}>Randomly determined — +20 starting XP.</span>
          ) : null}

          {race ? (
            <>
              <div className="nc-row-between" style={{ marginTop: 14 }}>
                <span className="nc-field-label">Extra points assigned to Fate ({race.extra} available)</span>
                <Stepper
                  value={Math.min(draft.extraToFate, race.extra)}
                  min={0}
                  max={race.extra}
                  decreaseLabel="Assign fewer extra points to Fate"
                  increaseLabel="Assign more extra points to Fate"
                  onChange={(n) => set({ extraToFate: n })}
                />
              </div>
              <span className="nc-arch-meta">
                Fate {race.fate + Math.min(draft.extraToFate, race.extra)} · Resilience {race.resilience + (race.extra - Math.min(draft.extraToFate, race.extra))}
              </span>
            </>
          ) : null}
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <span className="nc-label">Step 2</span>
          <span className="nc-heading">Roll characteristics</span>
          <span className="nc-body">
            Starting stats are {creation.statRoll.count}d{creation.statRoll.sides} + your species base per characteristic.
            This streamlined flow allows free rerolls and awards no characteristic-roll XP.
          </span>

          <div className="nc-roll-row">
            <Button
              variant="primary"
              iconLeft={<Icon name="dice" size={13} color={colors.ivory} />}
              onPress={() => set({ inits: rerollInits(charKeys, creation.statRoll) })}
            >
              {rolled ? 'Reroll' : 'Roll stats'}
            </Button>
            {rolled ? <span className="nc-total-line">Total: <span className="nc-total-num tabular">{totalRolled}</span></span> : null}
          </div>

          {rolled ? (
            <div className="nc-stats-grid">
              {charDefs.map(c => (
                <div key={c.key} className="nc-stat-cell">
                  <span className="nc-stat-key">{c.short}</span>
                  <span className="nc-stat-num tabular">{(draft.inits[c.key] ?? 0) + (race?.charModifiers?.[c.key] ?? 0)}</span>
                  <span className="nc-stat-name">{c.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <span className="nc-body nc-body--empty">Press "Roll stats" to generate your character's profile.</span>
          )}
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <span className="nc-label">Step 3</span>
          <span className="nc-heading">Career</span>
          <span className="nc-body">
            Let the dice decide for more starting XP, or choose freely. {eligibleCareers.length} careers open to {draft.species}.
          </span>
          {basicStartCount > 0 ? (
            <span className="nc-combo-warn">
              {basicStartCount} career choices currently use a basic starting kit and do not include career skills. They are marked BASIC below.
            </span>
          ) : null}
          {approximateCount > 0 ? (
            <span className="nc-combo-warn">
              {approximateCount} career choices use playable, approximate skill, talent, and advancement details where exact data was missing.
            </span>
          ) : null}

          <div className="nc-options-row" style={{ marginBottom: 4 }}>
            {([['choose', 'Choose freely'], ['three', 'Roll 3, pick one'], ['first', 'Roll & accept']] as [CareerMode, string][]).map(([m, label]) => {
              const on = draft.careerMode === m;
              return (
                <button
                  key={m}
                  type="button"
                  className={on ? 'btn-reset nc-option nc-option--on' : 'btn-reset nc-option'}
                  onClick={() => set({ careerMode: m, careerId: '', careerChoices: [] })}
                  disabled={careerRollLocked && m !== 'choose'}
                  aria-pressed={on}
                >
                  <span className={on ? 'nc-option-text nc-option-text--on' : 'nc-option-text'}>{label} · +{xpFor(m)} XP</span>
                </button>
              );
            })}
          </div>

          {draft.careerMode === 'first' ? (
            <div style={{ marginTop: 10 }}>
              <Button
                variant="primary"
                iconLeft={<Icon name="dice" size={13} color={colors.ivory} />}
                onPress={rollOneCareer}
                disabled={careerRollLocked || randomCareers.length === 0}
              >
                {chosenCareer ? 'First career roll accepted' : 'Roll one career'}
              </Button>
              {chosenCareer ? (
                <Card tight style={{ marginTop: 10, borderColor: colors.brass }}>
                  <span className="nc-arch-title">{chosenCareer.name}</span>
                  <span className="nc-arch-sub">{chosenCareer.class} · starts as {chosenCareer.ranks[0]?.name} ({chosenCareer.ranks[0]?.status})</span>
                  {!hasStartingCareerSkills(chosenCareer) ? (
                    <span className="nc-arch-warn">BASIC · career skills unavailable</span>
                  ) : null}
                  {chosenCareer.approximate ? (
                    <span className="nc-arch-warn">APPROX · generated career details</span>
                  ) : null}
                </Card>
              ) : null}
            </div>
          ) : null}

          {draft.careerMode === 'three' ? (
            <div style={{ marginTop: 10 }}>
              <Button
                variant="primary"
                iconLeft={<Icon name="dice" size={13} color={colors.ivory} />}
                onPress={rollThreeCareers}
                disabled={careerRollLocked || randomCareers.length === 0}
              >
                {draft.careerChoices.length ? 'Three careers rolled' : 'Roll three careers'}
              </Button>
              <div className="nc-arch-grid" style={{ marginTop: 10 }}>
                {draft.careerChoices.map(cid => {
                  const cr = careers.find(c => c.id === cid);
                  if (!cr) return null;
                  const on = draft.careerId === cid;
                  return (
                    <button
                      key={cid}
                      type="button"
                      className="btn-reset nc-arch-cell-wrap"
                      onClick={() => set({ careerId: cid })}
                      aria-pressed={on}
                    >
                      <Card tight style={{ flex: 1, ...(on ? { borderColor: colors.brass } : null) }}>
                        <div className="nc-arch-head">
                          <span className="nc-arch-title">{cr.name}</span>
                          {on ? <Pill variant="brass" size={10}>PICKED</Pill> : null}
                        </div>
                        <span className="nc-arch-sub">{cr.class}</span>
                        <span className="nc-arch-meta">Starts as {cr.ranks[0]?.name} ({cr.ranks[0]?.status})</span>
                        {!hasStartingCareerSkills(cr) ? (
                          <span className="nc-arch-warn">BASIC · career skills unavailable</span>
                        ) : null}
                        {cr.approximate ? (
                          <span className="nc-arch-warn">APPROX · generated career details</span>
                        ) : null}
                      </Card>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {draft.careerMode === 'choose' ? (
            <div style={{ marginTop: 10 }}>
              {careersByClass.map(([cls, list]) => (
                <div key={cls} style={{ marginBottom: 10 }}>
                  <span className="nc-field-label">{cls}</span>
                  <div className="nc-options-row">
                    {list.map(cr => {
                      const on = draft.careerId === cr.id;
                      return (
                        <button
                          key={cr.id}
                          type="button"
                          className={on ? 'btn-reset nc-option nc-option--on' : 'btn-reset nc-option'}
                          onClick={() => set({ careerId: cr.id })}
                          aria-pressed={on}
                          title={`${cr.ranks[0]?.name} (${cr.ranks[0]?.status})${
                            hasStartingCareerSkills(cr) ? '' : ' — basic start; career skills unavailable'
                          }${cr.approximate ? ' — approximate career details' : ''}`}
                        >
                          <span className={on ? 'nc-option-text nc-option-text--on' : 'nc-option-text'}>
                            {cr.name}{hasStartingCareerSkills(cr) ? '' : ' · BASIC'}{cr.approximate ? ' · APPROX' : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {step === 3 && preview ? (
        <Card>
          <span className="nc-label">Step 4</span>
          <span className="nc-heading">Review</span>

          <div className="nc-review-head">
            <Avatar initials={preview.initials} accent={preview.accent} size={64} fontSize={24} />
            <div className="nc-review-main">
              <span className="nc-preview-name">{preview.name}</span>
              <span className="nc-preview-meta">
                {preview.species} · {preview.career} · rank {preview.careerLevel} · {preview.status}
              </span>
              <span className="nc-preview-meta">
                Wounds {preview.wounds.max} · Fate {preview.fate} · Resilience {preview.resilience} · {preview.xpCurrent} starting XP
              </span>
              <span className="nc-preview-meta">
                {preview.skills.filter(s => s.career).length} career skills · {preview.talents.length} talents
                {' · basic starting kit'}
              </span>
              {preview.skills.filter(s => s.career).length === 0 ? (
                <span className="nc-preview-meta" style={{ color: colors.brass }}>
                  No starting career-skill list shipped for {preview.career} yet — add its skills on the Skills &amp; XP screens after creation.
                </span>
              ) : null}
              {chosenCareer?.approximate ? (
                <span className="nc-preview-meta" style={{ color: colors.brass }}>
                  Career skills, talents, and rank requirements use an approximate fallback profile.
                </span>
              ) : null}
              {preview.isCaster || preview.isAnointed ? (
                <span className="nc-preview-meta nc-preview-meta--brass">
                  {preview.isCaster ? 'Spellcaster — Magic screen will activate' : 'Anointed — Faith screen will activate'}
                </span>
              ) : null}
            </div>
          </div>

          <div className="nc-stats-grid">
            {preview.characteristics.map(c => (
              <div key={c.key} className="nc-stat-cell">
                <span className="nc-stat-key">{c.short}</span>
                <span className="nc-stat-num tabular">{c.init + c.adv}</span>
                <span className="nc-stat-name">{c.name}</span>
              </div>
            ))}
          </div>
          <div className="nc-review-package">
            <section aria-label="Starting skills">
              <h3>Starting skills</h3>
              <ul>{preview.skills.map(skill => {
                const characteristic = preview.characteristics.find(c => c.key === skill.char);
                const total = (characteristic ? characteristic.init + characteristic.adv : 0) + skill.adv;
                return <li key={skill.name}><strong>{skill.name}</strong> · +{skill.adv} advances · total {total}{skill.career ? ' · career' : ' · species'}</li>;
              })}</ul>
            </section>
            <section aria-label="Starting talents">
              <h3>Starting talents</h3>
              <ul>{preview.talents.map(talent => <li key={`${talent.name}-${talent.specialization ?? ''}`}>
                <strong>{talent.name}{talent.specialization ? ` (${talent.specialization})` : ''} ×{talent.times}</strong>
                <p>{talent.desc}</p>
              </li>)}</ul>
            </section>
            <section aria-label="Starting equipment">
              <h3>Starting equipment</h3>
              <ul>
                {preview.weapons.map(w => <li key={w.name}><strong>{w.name}</strong> · {w.group} · damage {w.dmg} · {w.reach ?? w.range} · enc. {w.enc}</li>)}
                {preview.armour.map(a => <li key={a.name}>{a.name} · AP {a.ap} · {a.locs.join(', ')} · enc. {a.enc}</li>)}
                {preview.trappings.map((item, i) => <li key={`${item.name}-${i}`}>{item.name} · enc. {item.enc}</li>)}
              </ul>
              {preview.armour.length === 0 && <p>No armour.</p>}
              <p>Starting money is rolled when you finish, based on {preview.status} status.</p>
            </section>
          </div>
        </Card>
      ) : null}

      <Section title=" " />
      <div className="nc-nav-row">
        <Button variant="ghost" onPress={() => setStep(a => Math.max(0, a - 1))} disabled={step === 0}>
          ← {STEPS[Math.max(0, step - 1)]}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button variant="primary" disabled={!canProceed} onPress={() => setStep(a => a + 1)}>
            {STEPS[step + 1]} →
          </Button>
        ) : (
          <Button
            variant="primary"
            onPress={() => { void finish(); }}
            disabled={saving}
            iconLeft={<Icon name="check" size={13} color={colors.ivory} />}
          >
            {saving ? 'Saving…' : 'Finish & switch'}
          </Button>
        )}
      </div>
    </ScreenContainer>
  );
};
