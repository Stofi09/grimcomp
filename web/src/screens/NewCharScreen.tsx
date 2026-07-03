import { useMemo } from 'react';
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
import { Alert } from '@/ui/alert';
import { useStoredState } from '@/hooks/useStoredState';
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
  startingXp, statusTier, startingMoney, startingMoneyDice,
  inferCareerCapabilities, pickDistinct, type CareerMode,
} from '@/utils/creation';
import { charVars, evalFormula } from '@/utils/formula';
import { rollDice } from '@/utils/roll';
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
  /** How the career was settled: accept-first (+50), roll-three (+25), choose (+0). */
  careerMode: CareerMode;
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

// `count` d`sides` + `plus` (WFRP 4e starting characteristics: 2d10 + 20).
const rollStat = (count: number, sides: number, plus: number): number => {
  let total = plus;
  for (let i = 0; i < count; i += 1) total += Math.ceil(Math.random() * sides);
  return total;
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
 * class, and status. One of the four archetype careers additionally clones its
 * pregen `kitTpl` (weapons, armour, trappings, spells/prayers); any other career
 * gets a generic starting kit and its career skills from the advance scheme.
 */
const buildCharacter = (
  draft: Draft,
  newId: string,
  career: Career,
  race: Race | undefined,
  kitTpl: Character,
  hasRichKit: boolean,
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
  const caps = hasRichKit
    ? { isCaster: !!kitTpl.isCaster, isAnointed: !!kitTpl.isAnointed }
    : inferCareerCapabilities(career.id);
  const accent = hasRichKit ? kitTpl.accent : (CLASS_ACCENT[career.class] ?? '#8b2d2d');

  const characteristics = charDefs.map(d => ({
    key: d.key,
    name: d.name,
    short: d.short,
    init: (draft.inits[d.key] ?? creation.statRoll.plus) + (race?.charModifiers?.[d.key] ?? 0),
    adv: 0,
  }));

  const initials = draft.name.split(/\s+/).filter(Boolean).map(s => s[0]?.toUpperCase()).join('').slice(0, 2) || 'XX';

  const vars = charVars(characteristics.map(c => ({
    key: c.key,
    short: c.short,
    current: c.init,
    bonus: evalFormula(system.formulas.bonus, { value: c.init }),
  })));

  // Hardy (bonus-Wounds talent) may come from the species or a rich kit.
  const bonusTalent = wounds.bonusTalent;
  const hasHardy = (hasRichKit && kitTpl.talents.some(t => t.name === bonusTalent))
    || (race?.talents ?? []).some(id => talentDefs.find(d => d.id === id)?.name === bonusTalent);
  const small = race?.size !== undefined && wounds.smallSizes.includes(race.size);
  const wMax = evalFormula(system.formulas.maxWounds, {
    ...vars,
    small: small ? 1 : 0,
    bonusRanks: hasHardy ? 1 : 0,
  });

  // Career skills: a rich kit's own skills, or the career's advance-scheme skills
  // at +0. Then layer species-granted skills as non-career.
  const skills: Skill[] = [];
  if (hasRichKit) {
    for (const s of kitTpl.skills) skills.push({ ...s, adv: 0 });
  } else {
    for (const nm of career.advanceScheme?.skills ?? []) {
      const def = skillDefs.find(d => d.name === nm) ?? skillDefs.find(d => nm.startsWith(d.name));
      skills.push({ name: nm, char: def?.char ?? charDefs[0]?.key ?? 'ws', adv: 0, career: true, advanced: def?.advanced });
    }
  }
  const haveSkill = new Set(skills.map(s => s.name));
  for (const id of race?.skills ?? []) {
    const def = skillDefs.find(d => d.id === id);
    if (def && !haveSkill.has(def.name)) {
      skills.push({ name: def.name, char: def.char, adv: 0, career: false, advanced: def.advanced });
      haveSkill.add(def.name);
    }
  }

  // Talents: a rich kit's talents (single rank) plus species talents.
  const talents: Talent[] = [];
  if (hasRichKit) for (const t of kitTpl.talents) talents.push({ ...t, times: 1 });
  const haveTalent = new Set(talents.map(t => t.name));
  for (const id of race?.talents ?? []) {
    const def = talentDefs.find(d => d.id === id);
    if (def && !haveTalent.has(def.name)) {
      talents.push({ name: def.name, times: 1, desc: def.description, career: false });
      haveTalent.add(def.name);
    }
  }

  // Kit: rich pregen loadout, or a generic starting kit for any other career.
  let weapons: Weapon[];
  let armour: Armour[];
  let trappings: Trapping[];
  let knownSpells: string[];
  let knownPrayers: string[];
  let spellLore: string | undefined;
  let deity: string | undefined;
  if (hasRichKit) {
    weapons = kitTpl.weapons;
    armour = kitTpl.armour;
    trappings = kitTpl.trappings;
    knownSpells = (kitTpl.knownSpells ?? []).filter(id => spells.find(s => s.id === id)?.lore === creation.pettyLore);
    knownPrayers = (kitTpl.knownPrayers ?? []).filter(id => prayers.find(p => p.id === id)?.deity === creation.anyDeity);
    spellLore = kitTpl.spellLore;
    deity = kitTpl.deity;
  } else {
    weapons = [{ name: 'Hand Weapon', group: 'Basic', enc: 1, reach: 'Average', dmg: 'SB+4', qual: [] }];
    armour = [];
    trappings = [{ name: 'Clothing', enc: 0 }, { name: 'Dagger', enc: 0 }, { name: 'Backpack', enc: 0 }];
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

  return {
    ...kitTpl,
    id: newId,
    name: draft.name.trim() || `New ${career.name}`,
    species: draft.species,
    raceId: race?.id,
    class: career.class,
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
    movement: race?.movement ?? kitTpl.movement,
    fate,
    fortune: fate,
    resilience,
    resolve: resilience,
    xpCurrent: startingXp(draft.speciesRandom, draft.careerMode),
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
  const { add, nextId, get } = useRoster();
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
    careerMode: 'choose',
    careerId: '',
    careerChoices: [],
    inits: {},
    extraToFate: 3,
  };

  const [step, setStep] = useStoredState('gc.newchar.step', 0);
  const [draft, setDraft] = useStoredState<Draft>('gc.newchar.draft', emptyDraft);

  const race = races.find(r => r.name === draft.species);

  // Careers this species may take.
  const eligibleCareers = useMemo(
    () => careers.filter(cr => !race || cr.species.length === 0 || cr.species.includes(race.id)),
    [careers, race],
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

  const chosenCareer = careers.find(cr => cr.id === draft.careerId);
  const archForChosen = creation.archetypes.find(a => a.careerId === draft.careerId);
  const hasRichKit = !!archForChosen;
  const kitTpl = get(archForChosen?.templateId ?? '');

  const rolled = Object.keys(draft.inits).length > 0;
  const totalRolled = Object.values(draft.inits).reduce<number>((a, b) => a + (b ?? 0), 0);

  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));

  const pickSpecies = (r: Race, random: boolean) =>
    set({ species: r.name, speciesRandom: random, extraToFate: r.extra, careerId: '', careerChoices: [] });

  const rollSpecies = () => {
    if (races.length === 0) return;
    const r = races[Math.floor(Math.random() * races.length)];
    pickSpecies(r, true);
  };

  const rollOneCareer = () => {
    if (eligibleCareers.length === 0) return;
    const cr = eligibleCareers[Math.floor(Math.random() * eligibleCareers.length)];
    set({ careerId: cr.id, careerChoices: [] });
  };
  const rollThreeCareers = () => {
    const picks = pickDistinct(eligibleCareers, 3, [Math.random(), Math.random(), Math.random()]);
    set({ careerChoices: picks.map(c => c.id), careerId: '' });
  };

  // Preview the would-be character for the Review step (no money rolled yet).
  const zeroWealth = Object.fromEntries(system.currency.units.map(u => [u.key, 0]));
  const preview = chosenCareer
    ? buildCharacter(
        draft, 'preview', chosenCareer, race, kitTpl, hasRichKit, skillDefs, talentDefs,
        content.allSpells, content.allPrayers, charDefs, woundsRules, creation, system, zeroWealth,
      )
    : null;

  const canProceed = (() => {
    if (step === 0) return draft.name.trim().length > 0 && !!race;
    if (step === 1) return Object.keys(draft.inits).length === charKeys.length;
    if (step === 2) return !!chosenCareer && eligibleCareers.some(c => c.id === draft.careerId);
    return true;
  })();

  const finish = () => {
    if (!draft.name.trim()) { Alert.alert('Name required', 'Please give your character a name first.'); return; }
    if (Object.keys(draft.inits).length !== charKeys.length) { Alert.alert('Roll your stats', 'Roll characteristics on step 2 first.'); return; }
    if (!chosenCareer) { Alert.alert('Pick a career', 'Choose a career on step 3 first.'); return; }

    // Roll starting money by the career's rank-1 Status tier.
    const tier = statusTier(chosenCareer.ranks[0]?.status ?? '');
    const rolls = Array.from({ length: startingMoneyDice(tier) }, () => rollDice({ count: 1, sides: 10 }));
    const wealth: Record<string, number> = {
      ...Object.fromEntries(system.currency.units.map(u => [u.key, 0])),
      ...startingMoney(tier, rolls),
    };

    const id = nextId();
    const c = buildCharacter(
      draft, id, chosenCareer, race, kitTpl, hasRichKit, skillDefs, talentDefs,
      content.allSpells, content.allPrayers, charDefs, woundsRules, creation, system, wealth,
    );
    add(c);
    setActive(id);
    setDraft(emptyDraft);
    setStep(0);
    Alert.alert(
      'Character created',
      `${c.name} — ${c.species} ${c.career}. Starting XP ${c.xpCurrent}; ` +
        `money ${system.currency.units.map(u => `${wealth[u.key] ?? 0} ${u.label}`).join(', ')}.`,
      [{ text: 'Open Overview', onPress: () => onNav('overview') }],
    );
  };

  const xpFor = (mode: CareerMode) => startingXp(draft.speciesRandom, mode);

  return (
    <ScreenContainer>
      <Hero
        title="New character"
        subRow={<span className="nc-sub">The full WFRP 4e procedure — species, characteristics, career.</span>}
      />

      <div className="nc-steps">
        {STEPS.map((s, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <button key={s} type="button" className="btn-reset nc-step-cell" onClick={() => setStep(i)}>
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

          <span className="nc-field-label">Name</span>
          <input
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
            <Button variant="ghost" iconLeft={<Icon name="dice" size={12} color={colors.ink2} />} onPress={rollSpecies}>
              Roll random (+20 XP)
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
                <span className="nc-field-label">Extra points to Fate ({race.extra} to split)</span>
                <Stepper value={Math.min(draft.extraToFate, race.extra)} min={0} max={race.extra} onChange={(n) => set({ extraToFate: n })} />
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
            WFRP 4e starting stats are {creation.statRoll.count}d{creation.statRoll.sides} + your species base per
            characteristic. Reroll until you get a profile you can live with.
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

          <div className="nc-options-row" style={{ marginBottom: 4 }}>
            {([['choose', 'Choose freely'], ['three', 'Roll 3, pick one'], ['first', 'Roll & accept']] as [CareerMode, string][]).map(([m, label]) => {
              const on = draft.careerMode === m;
              return (
                <button
                  key={m}
                  type="button"
                  className={on ? 'btn-reset nc-option nc-option--on' : 'btn-reset nc-option'}
                  onClick={() => set({ careerMode: m, careerId: '', careerChoices: [] })}
                >
                  <span className={on ? 'nc-option-text nc-option-text--on' : 'nc-option-text'}>{label} · +{xpFor(m)} XP</span>
                </button>
              );
            })}
          </div>

          {draft.careerMode === 'first' ? (
            <div style={{ marginTop: 10 }}>
              <Button variant="primary" iconLeft={<Icon name="dice" size={13} color={colors.ivory} />} onPress={rollOneCareer}>
                {chosenCareer ? 'Reroll career' : 'Roll a career'}
              </Button>
              {chosenCareer ? (
                <Card tight style={{ marginTop: 10, borderColor: colors.brass }}>
                  <span className="nc-arch-title">{chosenCareer.name}</span>
                  <span className="nc-arch-sub">{chosenCareer.class} · starts as {chosenCareer.ranks[0]?.name} ({chosenCareer.ranks[0]?.status})</span>
                </Card>
              ) : null}
            </div>
          ) : null}

          {draft.careerMode === 'three' ? (
            <div style={{ marginTop: 10 }}>
              <Button variant="primary" iconLeft={<Icon name="dice" size={13} color={colors.ivory} />} onPress={rollThreeCareers}>
                {draft.careerChoices.length ? 'Reroll three' : 'Roll three careers'}
              </Button>
              <div className="nc-arch-grid" style={{ marginTop: 10 }}>
                {draft.careerChoices.map(cid => {
                  const cr = careers.find(c => c.id === cid);
                  if (!cr) return null;
                  const on = draft.careerId === cid;
                  return (
                    <button key={cid} type="button" className="btn-reset nc-arch-cell-wrap" onClick={() => set({ careerId: cid })}>
                      <Card tight style={{ flex: 1, ...(on ? { borderColor: colors.brass } : null) }}>
                        <div className="nc-arch-head">
                          <span className="nc-arch-title">{cr.name}</span>
                          {on ? <Pill variant="brass" size={10}>PICKED</Pill> : null}
                        </div>
                        <span className="nc-arch-sub">{cr.class}</span>
                        <span className="nc-arch-meta">Starts as {cr.ranks[0]?.name} ({cr.ranks[0]?.status})</span>
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
                          title={`${cr.ranks[0]?.name} (${cr.ranks[0]?.status})`}
                        >
                          <span className={on ? 'nc-option-text nc-option-text--on' : 'nc-option-text'}>{cr.name}</span>
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
                {!hasRichKit ? ' · generic starting kit' : ''}
              </span>
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
                <span className="nc-stat-num tabular">{c.init}</span>
                <span className="nc-stat-name">{c.name}</span>
              </div>
            ))}
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
          <Button variant="primary" onPress={finish} iconLeft={<Icon name="check" size={13} color={colors.ivory} />}>
            Finish &amp; switch
          </Button>
        )}
      </div>
    </ScreenContainer>
  );
};
