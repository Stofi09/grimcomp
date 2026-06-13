import type * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { Pill } from '@/components/Pill';
import { Alert } from '@/ui/alert';
import { useStoredState } from '@/hooks/useStoredState';
import { useRoster } from '@/hooks/useRoster';
import { useCharacter } from '@/hooks/useCharacter';
import { type Character, type CharacteristicKey } from '@/data/character';
import {
  useRaces, useSkillDefs, useTalentDefs, useCareers, useContent,
  useCreation, useCharacteristicDefs, useWoundsRules, useSystemRules,
} from '@/content/useContent';
import type {
  Race, SkillDef, TalentDef, Spell, Prayer, ArchetypeDef,
  CharacteristicDef, WoundsRules, CreationConfig, SystemRules,
} from '@/content/types';
import { charVars, evalFormula } from '@/utils/formula';
import type { ScreenId } from '@/data/nav';
import { colors } from '@/theme';
import './NewCharScreen.css';

interface Props {
  onNav: (id: ScreenId) => void;
}

const STEPS = ['Name', 'Archetype', 'Stats', 'Review'];

interface Draft {
  name: string;
  species: string;
  archetypeKey: string;
  /** Per-characteristic initial value override (replaces template's `init`). */
  inits: Partial<Record<CharacteristicKey, number>>;
}

// Fallback creation config, used only while the content packs are still loading
// (useCreation() returns undefined until then). Mirrors core-creation.json so
// the wizard renders sensibly during that brief phase; nothing is persisted.
const FALLBACK_CREATION: CreationConfig = {
  statRoll: { count: 2, sides: 10, plus: 20 },
  archetypes: [],
  defaults: { species: 'Human', archetype: 'warrior' },
  pettyLore: 'Petty',
  anyDeity: 'Any',
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

/** Build a fresh character from an archetype + the draft (name, species,
    rolled stats). The archetype contributes its career, gear, and caster /
    anointed capabilities (cloned from a content-registry template); species
    contributes characteristic modifiers, movement, Fate/Resilience, and granted
    skills + talents. Identity and history are generated blank. */
const buildCharacter = (
  draft: Draft,
  newId: string,
  arch: ArchetypeDef | undefined,
  src: Character,
  race: Race | undefined,
  skillDefs: SkillDef[],
  talentDefs: TalentDef[],
  spells: Spell[],
  prayers: Prayer[],
  charDefs: CharacteristicDef[],
  wounds: WoundsRules,
  creation: CreationConfig,
  system: SystemRules,
): Character => {
  const label = arch?.label ?? 'Adventurer';
  const accent = arch?.accent ?? src.accent;

  const characteristics = src.characteristics.map(c => ({
    ...c,
    init: (draft.inits[c.key] ?? c.init) + (race?.charModifiers?.[c.key] ?? 0),
    adv: 0,
  }));

  const initials = draft.name.split(/\s+/).filter(Boolean).map(s => s[0]?.toUpperCase()).join('').slice(0, 2) || 'XX';

  // Formula vars over the freshly rolled characteristics (value + bonus, by
  // key and short name), using the system's bonus formula.
  const vars = charVars(characteristics.map(c => ({
    key: c.key,
    short: c.short,
    current: c.init,
    bonus: evalFormula(system.formulas.bonus, { value: c.init }),
  })));

  // The bonus-wounds talent (Hardy), granted by the archetype and/or species,
  // feeds the maxWounds formula as bonusRanks; a fresh character holds one rank.
  const bonusTalent = wounds.bonusTalent;
  const hasHardy = src.talents.some(t => t.name === bonusTalent)
    || (race?.talents ?? []).some(id => talentDefs.find(d => d.id === id)?.name === bonusTalent);
  const small = race?.size !== undefined && wounds.smallSizes.includes(race.size);
  const wMax = evalFormula(system.formulas.maxWounds, {
    ...vars,
    small: small ? 1 : 0,
    bonusRanks: hasHardy ? 1 : 0,
  });

  // Career skills come from the archetype, reset to +0 advances (fresh). Then
  // layer on the species' granted skills (as non-career) if not already present.
  const skills = src.skills.map(s => ({ ...s, adv: 0 }));
  const haveSkill = new Set(skills.map(s => s.name));
  for (const id of race?.skills ?? []) {
    const def = skillDefs.find(d => d.id === id);
    if (def && !haveSkill.has(def.name)) {
      skills.push({ name: def.name, char: def.char, adv: 0, career: false, advanced: def.advanced });
      haveSkill.add(def.name);
    }
  }

  // Talents from the archetype (reset to a single rank) plus species talents.
  const talents = src.talents.map(t => ({ ...t, times: 1 }));
  const haveTalent = new Set(talents.map(t => t.name));
  for (const id of race?.talents ?? []) {
    const def = talentDefs.find(d => d.id === id);
    if (def && !haveTalent.has(def.name)) {
      talents.push({ name: def.name, times: 1, desc: def.description, career: false });
      haveTalent.add(def.name);
    }
  }

  // Fate & Resilience from species. The free Extra points are allocated to Fate
  // by default. On a fresh PC, Fortune = Fate, Resolve = Resilience.
  const fate = (race?.fate ?? src.fate) + (race?.extra ?? 0);
  const resilience = race?.resilience ?? src.resilience;

  // Fresh casters keep only their Petty spells; fresh priests keep only
  // deity-agnostic Blessings, learning the rest later via XP.
  const knownSpells = (src.knownSpells ?? []).filter(id => spells.find(s => s.id === id)?.lore === creation.pettyLore);
  const knownPrayers = (src.knownPrayers ?? []).filter(id => prayers.find(p => p.id === id)?.deity === creation.anyDeity);

  // Characteristic order follows the canonical roster from the registry; the
  // template's own list already matches, but we keep this for the rolled-stats
  // and review grids which iterate over charDefs.
  void charDefs;

  return {
    ...src,
    id: newId,
    name: draft.name.trim() || `New ${label}`,
    species: draft.species,
    initials,
    accent,
    characteristics,
    skills,
    talents,
    knownSpells,
    knownPrayers,
    movement: race?.movement ?? src.movement,
    fate,
    fortune: fate,
    resilience,
    resolve: resilience,
    // Fresh-character defaults — clear out the sample PC's history & identity.
    xpCurrent: 0,
    xpSpent: 0,
    wounds: { current: wMax, max: wMax },
    corruption: 0,
    sin: 0,
    careerLevel: 1,
    careerLevelName: src.careerRanks[0]?.name ?? src.careerLevelName,
    status: src.careerRanks[0]?.status ?? src.status,
    conditions: [],
    criticals: [],
    wealth: Object.fromEntries(system.currency.units.map(u => [u.key, 0])),
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

  const archetypes = creation.archetypes;
  const charKeys = charDefs.map(c => c.key);

  const emptyDraft: Draft = {
    name: '',
    species: creation.defaults.species,
    archetypeKey: creation.defaults.archetype,
    inits: {},
  };

  // Wizard step + draft are persisted so the user can come back to their
  // half-finished character.
  const [step, setStep] = useStoredState('gc.newchar.step', 0);
  const [draft, setDraft] = useStoredState<Draft>('gc.newchar.draft', emptyDraft);

  const arch = archetypes.find(a => a.key === draft.archetypeKey) ?? archetypes[0];
  const srcTpl = get(arch?.templateId ?? '');
  const race = races.find(r => r.name === draft.species);

  // Species eligibility: each archetype maps to a career whose `species` list
  // says who may take it. Halflings can't be Wizards, Runesmith is Dwarf-only.
  const raceName = (id: string) => races.find(r => r.id === id)?.name ?? id;
  const allowedRaceIds = careers.find(c => c.id === arch?.careerId)?.species ?? [];
  const comboOk = !race || allowedRaceIds.length === 0 || allowedRaceIds.includes(race.id);

  // Preview the would-be character so the Review step shows live values.
  const preview = buildCharacter(
    draft, 'preview', arch, srcTpl, race, skillDefs, talentDefs,
    content.allSpells, content.allPrayers, charDefs, woundsRules, creation, system,
  );

  const totalRolled = Object.values(draft.inits).reduce<number>((a, b) => a + (b ?? 0), 0);
  const rolled = Object.keys(draft.inits).length > 0;

  const canProceed = (() => {
    if (step === 0) return draft.name.trim().length > 0;
    if (step === 1) return comboOk;
    if (step === 2) return Object.keys(draft.inits).length === charKeys.length;
    return true;
  })();

  const finish = () => {
    if (!draft.name.trim()) {
      Alert.alert('Name required', 'Please give your character a name first.');
      return;
    }
    if (Object.keys(draft.inits).length !== charKeys.length) {
      Alert.alert('Roll your stats', 'Tap "Reroll" on the Stats step before finishing.');
      return;
    }
    if (!comboOk) {
      Alert.alert(
        'Invalid combination',
        `${arch?.label ?? 'This archetype'} (${srcTpl.career}) isn't available to ${draft.species}. ` +
        `Pick a different archetype, or change species in step 1.`,
      );
      return;
    }
    const id = nextId();
    const c = buildCharacter(
      draft, id, arch, srcTpl, race, skillDefs, talentDefs,
      content.allSpells, content.allPrayers, charDefs, woundsRules, creation, system,
    );
    add(c);
    setActive(id);
    // Reset draft so the wizard is fresh next time.
    setDraft(emptyDraft);
    setStep(0);
    Alert.alert(
      'Character created',
      `${c.name} is ready. Switched to them as the active character.`,
      [{ text: 'Open Overview', onPress: () => onNav('overview') }],
    );
  };

  return (
    <ScreenContainer>
      <Hero
        title="New character"
        subRow={<span className="nc-sub">Step by step — you can go back at any point.</span>}
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
                <span className="nc-dot-text" style={{ color: done || current ? '#fff' : colors.ink3 }}>
                  {i + 1}
                </span>
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
            onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))}
            placeholder="e.g. Magnus Brenner"
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
          />

          <span className="nc-field-label">Species</span>
          <div className="nc-options-row">
            {races.map(r => {
              const on = draft.species === r.name;
              return (
                <button
                  key={r.id}
                  type="button"
                  className={on ? 'btn-reset nc-option nc-option--on' : 'btn-reset nc-option'}
                  onClick={() => setDraft(d => ({ ...d, species: r.name }))}
                >
                  <span className={on ? 'nc-option-text nc-option-text--on' : 'nc-option-text'}>{r.name}</span>
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <span className="nc-label">Step 2</span>
          <span className="nc-heading">Archetype</span>
          <span className="nc-body">
            Pick the kind of adventurer they are. Skills, weapons, and starting talents come from this choice.
          </span>

          {!comboOk ? (
            <span className="nc-combo-warn">
              {arch?.label ?? 'This archetype'} isn't available to {draft.species}. Pick another archetype below, or go back to step 1 to change species.
            </span>
          ) : null}

          <div className="nc-arch-grid">
            {archetypes.map(a => {
              const on = draft.archetypeKey === a.key;
              const allowed = careers.find(c => c.id === a.careerId)?.species ?? [];
              const fits = !race || allowed.length === 0 || allowed.includes(race.id);
              const aTpl = get(a.templateId);
              return (
                <button
                  key={a.key}
                  type="button"
                  className="btn-reset nc-arch-cell-wrap"
                  onClick={() => setDraft(d => ({ ...d, archetypeKey: a.key }))}
                >
                  <Card
                    tight
                    style={{
                      flex: 1,
                      ...(on ? { borderColor: colors.brass } : null),
                      ...(!fits ? { opacity: 0.5 } : null),
                    }}
                  >
                    <div className="nc-arch-head">
                      <Icon name={a.icon as IconName} size={20} color={on ? colors.brass : colors.ink2} />
                      {on ? <Pill variant="brass" size={10}>PICKED</Pill> : null}
                    </div>
                    <span className="nc-arch-title">{a.label}</span>
                    <span className="nc-arch-sub">{a.blurb}</span>
                    <span className="nc-arch-meta">Starts as {aTpl.career}</span>
                    <span className="nc-arch-species">{allowed.map(raceName).join(' · ') || 'Any species'}</span>
                    {!fits ? <span className="nc-arch-warn">Not available to {draft.species}</span> : null}
                  </Card>
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <span className="nc-label">Step 3</span>
          <span className="nc-heading">Roll characteristics</span>
          <span className="nc-body">
            WFRP 4e starting stats are {creation.statRoll.count}d{creation.statRoll.sides} + {creation.statRoll.plus} per
            characteristic. Tap reroll until you get something you can live with — or stick with what the dice gave you
            the first time.
          </span>

          <div className="nc-roll-row">
            <Button
              variant="primary"
              iconLeft={<Icon name="dice" size={13} color={colors.ivory} />}
              onPress={() => setDraft(d => ({ ...d, inits: rerollInits(charKeys, creation.statRoll) }))}
            >
              {rolled ? 'Reroll' : 'Roll stats'}
            </Button>
            {rolled ? (
              <span className="nc-total-line">
                Total: <span className="nc-total-num tabular">{totalRolled}</span>
              </span>
            ) : null}
          </div>

          {rolled ? (
            <div className="nc-stats-grid">
              {srcTpl.characteristics.map(c => (
                <div key={c.key} className="nc-stat-cell">
                  <span className="nc-stat-key">{c.short}</span>
                  <span className="nc-stat-num tabular">{draft.inits[c.key]}</span>
                  <span className="nc-stat-name">{c.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <span className="nc-body nc-body--empty">
              Press "Roll stats" to generate your character's profile.
            </span>
          )}
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <span className="nc-label">Step 4</span>
          <span className="nc-heading">Review</span>

          <div className="nc-review-head">
            <Avatar initials={preview.initials} accent={arch?.accent ?? preview.accent} size={64} fontSize={24} />
            <div className="nc-review-main">
              <span className="nc-preview-name">{preview.name}</span>
              <span className="nc-preview-meta">
                {preview.species} · {preview.career} · rank {preview.careerLevel} · {preview.status}
              </span>
              <span className="nc-preview-meta">
                Wounds {preview.wounds.max} · {preview.skills.filter(s => s.career).length} career skills · {preview.talents.length} talents
              </span>
              {arch?.key === 'wizard' || arch?.key === 'priest' ? (
                <span className="nc-preview-meta nc-preview-meta--brass">
                  {arch?.key === 'wizard' ? 'Spellcaster — Magic screen will activate' : 'Anointed — Faith screen will activate'}
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
        <Button
          variant="ghost"
          onPress={() => setStep(a => Math.max(0, a - 1))}
          disabled={step === 0}
        >
          ← {STEPS[Math.max(0, step - 1)]}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            variant="primary"
            disabled={!canProceed}
            onPress={() => setStep(a => a + 1)}
          >
            {STEPS[step + 1]} →
          </Button>
        ) : (
          <Button
            variant="primary"
            onPress={finish}
            iconLeft={<Icon name="check" size={13} color={colors.ivory} />}
          >
            Finish &amp; switch
          </Button>
        )}
      </div>
    </ScreenContainer>
  );
};
