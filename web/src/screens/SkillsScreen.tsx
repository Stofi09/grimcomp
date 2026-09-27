import { useRecordTest } from '@/hooks/useRecordTest';
import { normalizeExtraSkills, mergeCharacterSkills } from '@/utils/characterSkills';
import type * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { ScreenContainer } from './ScreenContainer';
import { type Skill } from '@/data/character';
import { runStoredTransaction, useStoredState } from '@/hooks/useStoredState';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useXp } from '@/hooks/useXp';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useConditions } from '@/hooks/useConditions';
import { useCareers, useXpRules, useSystemRules, useSkillDefs } from '@/content/useContent';
import { resolveTest, formatTestResult, resultLabel } from '@/utils/roll';
import {
  skillDefForName,
  skillRulesStatusLabel,
  skillRulesStatusMeta,
  skillSourceLabel,
} from '@/utils/skills';
import { careerDefForCharacter } from '@/utils/careers';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Stepper } from '@/components/Stepper';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { EditSheet } from '@/components/EditSheet';
import { PickerField, TextField } from '@/components/Fields';
import { Alert } from '@/ui/alertStore';
import { colors } from '@/theme';
import type { SkillDef, XpRules } from '@/content/types';
import { useProgressionActionGuard } from './useProgressionActionGuard';
import './SkillsScreen.css';

interface SkillDraft {
  mode: 'custom' | 'loaded';
  selectedDefId: string;
  name: string;
  char: string;
  type: 'basic' | 'advanced';
  pricing: 'career' | 'other';
}

const skillRulesLookup = (skill: SkillDef | undefined): string => {
  if (!skill) return '';
  const status = skillRulesStatusLabel(skill);
  const source = skillSourceLabel(skill);
  const lines = [
    status ? `Rules status: ${status}` : '',
    skill.restriction?.trim() ? `Restriction: ${skill.restriction.trim()}` : '',
    skill.rulesNote?.trim() ? `Rules note: ${skill.rulesNote.trim()}` : '',
    source ? `Source: ${source}` : '',
  ].filter(Boolean);
  return lines.length > 0 ? `\n\n${lines.join('\n')}` : '';
};

// Per-advance (+1) Skill XP cost (WFRP 4e core p.48). Skills are CHEAPER than
// characteristics and follow their own curve, keyed to advances already bought.
// The ladder now comes from the content registry (xpRules.skillAdvances): the
// cost is the band whose [min, max] range contains the advances already bought.
const perSkillAdvance = (rules: XpRules, adv: number): number => {
  const band = rules.skillAdvances.find(b => adv >= b.min && adv <= b.max);
  // Past the last band's upper bound, fall back to the highest band's cost.
  return band?.cost ?? rules.skillAdvances[rules.skillAdvances.length - 1]?.cost ?? 0;
};

// Sum each individual advance in the purchase. Cost bands are keyed to the
// number of advances already bought, so a +5 step starting at +5 crosses from
// the 0–5 band into the 6–10 band instead of pricing all five at the old rate.
const careerBracket = (rules: XpRules, adv: number) => {
  let total = 0;
  for (let offset = 0; offset < rules.buyStep; offset += 1) {
    total += perSkillAdvance(rules, adv + offset);
  }
  return total;
};
// Non-career advances apply their multiplier to the correctly banded total.
const otherBracket = (rules: XpRules, adv: number) => rules.nonCareerSkillMultiplier * careerBracket(rules, adv);

export const SkillsScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const { list: chars } = useCharacteristics();
  const xp = useXp();
  const { modifier: condMod } = useConditions();
  const rules = useXpRules();
  const careers = useCareers();
  const skillDefs = useSkillDefs();
  const charLabel = Object.fromEntries(c.characteristics.map(x => [x.key, x.short])) as Record<string, string>;
  const charBase = Object.fromEntries(chars.map(x => [x.key, x.current])) as Record<string, number>;
  const [storedExtraSkills, setStoredExtraSkills] = useStoredState<unknown>(characterKey(id, 'skills.extra'), []);
  const extraSkills = useMemo(() => normalizeExtraSkills(storedExtraSkills), [storedExtraSkills]);
  const updateExtraSkills = useCallback((update: (current: Skill[]) => Skill[]) => {
    setStoredExtraSkills((current: unknown) => update(normalizeExtraSkills(current)));
  }, [setStoredExtraSkills]);
  const registryCareer = careerDefForCharacter(careers, c);
  const careerSkillNames = registryCareer?.advanceScheme?.skills;
  // Merge the current registry scheme into old character records as a
  // non-destructive live migration. This means characters created before the
  // fallback career data shipped gain their missing career skills at +0.
  const skills = useMemo(() => mergeCharacterSkills(c, careerSkillNames, extraSkills, skillDefs),
    [c, careerSkillNames, extraSkills, skillDefs]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const beginProgressionAction = useProgressionActionGuard();

  const [advances, setAdvances] = useStoredState<Record<string, number>>(
    characterKey(id, 'skills.adv'),
    Object.fromEntries(skills.map(s => [s.name, s.adv])),
  );

  // Stepper change handler that runs through the XP economy. Each +5 click
  // costs the next bracket; each −5 refunds the bracket the user is leaving.
  const onAdvChange = useCallback((skill: Skill, current: number, next: number) => {
    if (next === current) return;
    const action = beginProgressionAction(`skill:${skill.definitionId ?? skill.name}`);
    if (!action) return;

    const bracket = skill.career ? careerBracket : otherBracket;
    if (next > current) {
      const cost = bracket(rules, current);
      const reason = `${skill.name} +${current} → +${next}`;
      const transaction = runStoredTransaction(() => {
        const result = xp.spend(cost, reason, 'skill');
        if (result.ok) setAdvances(prev => ({ ...prev, [skill.name]: next }));
        return result;
      });
      void transaction.completion.then(
        (durability) => {
          action.release();
          if (!durability.ok) Alert.alert('Could not save purchase', durability.error.message);
        },
        () => action.release(),
      );
      if (!transaction.value?.ok) {
        if (transaction.value) Alert.alert('Not enough XP', transaction.value.message);
        return;
      }
    } else if (next < current) {
      // Refund the bracket the user is leaving (the last +5 they bought). Only
      // step the advance down when the refund actually credited XP — otherwise
      // (e.g. stepping a template-granted skill below its starting level, which
      // was never purchased) we'd silently drop the rank for nothing.
      const refund = bracket(rules, next);
      const transaction = runStoredTransaction(() => {
        const result = xp.refund(refund, `${skill.name} +${next} → +${current}`, 'skill');
        if (result.ok) setAdvances(prev => ({ ...prev, [skill.name]: next }));
        return result;
      });
      void transaction.completion.then(
        (durability) => {
          action.release();
          if (!durability.ok) Alert.alert('Could not save refund', durability.error.message);
        },
        () => action.release(),
      );
      if (!transaction.value?.ok) {
        if (transaction.value) Alert.alert("Can't refund", transaction.value.message);
        return;
      }
    }
  }, [beginProgressionAction, rules, xp, setAdvances]);

  const totalFor = (s: Skill, adv: number) => (charBase[s.char] ?? 0) + adv;

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery = (skill: Skill) =>
    !normalizedQuery
    || skill.name.toLocaleLowerCase().includes(normalizedQuery)
    || (charLabel[skill.char] ?? skill.char).toLocaleLowerCase().includes(normalizedQuery);
  const careerSkills = skills.filter(s => s.career && matchesQuery(s));
  const otherSkills = skills.filter(s => !s.career && matchesQuery(s));

  // WFRP 4e: any character may attempt a Basic skill untrained, at their raw
  // characteristic (CRB p.117). List the Basic, non-grouped skills the character
  // doesn't already have as rollable references — grouped skills need a chosen
  // specialisation, so they're left out.
  const system = useSystemRules();
  const recordTest = useRecordTest();
  const ownedNames = useMemo(() => new Set(skills.map(s => s.name)), [skills]);
  const ownedDefinitionIds = useMemo(
    () => new Set(skills.flatMap(skill => skill.definitionId ? [skill.definitionId] : [])),
    [skills],
  );
  const untrainedBasics = skillDefs.filter(
    d => !d.advanced
      && !d.grouped
      && !ownedNames.has(d.name)
      && (!normalizedQuery
        || d.name.toLocaleLowerCase().includes(normalizedQuery)
        || (charLabel[d.char] ?? d.char).toLocaleLowerCase().includes(normalizedQuery)),
  );

  const definitionForSkill = useCallback(
    (skill: Skill): SkillDef | undefined => (
      skill.definitionId ? skillDefs.find(definition => definition.id === skill.definitionId) : undefined
    ) ?? skillDefForName(skillDefs, skill.name),
    [skillDefs],
  );

  const selectedDefinition = draft?.mode === 'loaded'
    ? skillDefs.find(skill => skill.id === draft.selectedDefId)
    : undefined;
  const selectedExclusionConflict = useMemo(() => {
    if (!selectedDefinition) return undefined;
    return skills.find(ownedSkill => {
      if (!ownedSkill.definitionId) return false;
      const selectedExcludesOwned = selectedDefinition.exclusiveWith
        ?.some(id => id.trim() === ownedSkill.definitionId);
      const ownedDefinition = skillDefs.find(definition => definition.id === ownedSkill.definitionId);
      const ownedExcludesSelected = ownedDefinition?.exclusiveWith
        ?.some(id => id.trim() === selectedDefinition.id);
      return selectedExcludesOwned || ownedExcludesSelected;
    });
  }, [selectedDefinition, skillDefs, skills]);

  // Only build and sort the registry picker while its loaded-content mode is
  // visible. The ordinary character screen and custom form stay lightweight.
  const pickerResults = useMemo(() => {
    if (draft?.mode !== 'loaded') return [];
    const normalized = pickerQuery.trim().toLocaleLowerCase();
    return skillDefs
      // A bare grouped definition is not a legal character skill. Until the
      // registry models concrete specialisations, those stay in Custom mode.
      .filter(skill => !skill.grouped)
      .filter(skill => !ownedNames.has(skill.name) && !ownedDefinitionIds.has(skill.id))
      .filter(skill => {
        if (!normalized) return true;
        return [
          skill.name,
          skill.description,
          skill.sourceBook,
          skill.restriction,
          skill.rulesNote,
          skillRulesStatusLabel(skill),
          charLabel[skill.char] ?? skill.char,
          skill.advanced ? 'advanced' : 'basic',
        ].some(value => value?.toLocaleLowerCase().includes(normalized));
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 40);
  }, [charLabel, draft?.mode, ownedDefinitionIds, ownedNames, pickerQuery, skillDefs]);

  const openNewSkill = () => {
    setPickerQuery('');
    setDraft({
      mode: 'custom',
      selectedDefId: '',
      name: '',
      char: chars[0]?.key ?? '',
      type: 'basic',
      pricing: 'other',
    });
  };

  const saveNewSkill = () => {
    if (!draft) return;
    const definition = draft.mode === 'loaded'
      ? skillDefs.find(skill => skill.id === draft.selectedDefId)
      : undefined;
    if (draft.mode === 'loaded' && !definition) {
      Alert.alert('Skill unavailable', 'That loaded definition is no longer active. Select a skill again.');
      return;
    }
    if (draft.mode === 'loaded' && selectedExclusionConflict) {
      Alert.alert(
        'Skill excluded',
        `${definition?.name ?? draft.name} cannot be added while ${selectedExclusionConflict.name} is owned.`,
      );
      return;
    }
    const name = definition?.name ?? draft.name.trim();
    if (!name) return;
    if (skills.some(s => s.name.toLocaleLowerCase() === name.toLocaleLowerCase()
      || (definition && s.definitionId === definition.id))) {
      Alert.alert('Skill already exists', `${name} is already on this character sheet.`);
      return;
    }
    updateExtraSkills(prev => [
      ...prev,
      {
        name,
        char: definition?.char ?? draft.char,
        adv: 0,
        career: draft.pricing === 'career',
        advanced: definition?.advanced ?? draft.type === 'advanced',
        definitionId: definition?.id,
      },
    ]);
    setDraft(null);
  };

  const removeExtraSkill = (skill: Skill) => {
    const adv = advances[skill.name] ?? skill.adv;
    if (adv > 0) {
      Alert.alert('Refund advances first', `Reduce ${skill.name} to +0 before removing it.`);
      return;
    }
    Alert.alert(
      'Remove skill?',
      `${skill.name} will be removed from this character.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => updateExtraSkills(prev => prev.filter(s => s.name !== skill.name)),
        },
      ],
    );
  };

  const rollUntrained = (skill: SkillDef) => {
    const tot = charBase[skill.char] ?? 0;
    const r = resolveTest({ target: tot, modifier: condMod.total, label: skill.name }, system.test);
    const breakdown = condMod.parts.length
      ? '\n\nFrom conditions:\n' + condMod.parts.map(p => `  • ${p.name} ×${p.stacks} → ${p.modifier > 0 ? '+' : ''}${p.modifier}`).join('\n')
      : '';
    recordTest(r, breakdown + skillRulesLookup(skill));
    Alert.alert(
      `${skill.name} — ${resultLabel(r)}`,
      formatTestResult(r) + breakdown + skillRulesLookup(skill),
    );
  };

  return (
    <ScreenContainer>
      <Hero
        eyebrow="Sheet 3 — Skills"
        title="Skills"
        subRow={
          <>
            <span className="skl-sub">{skills.length} skills</span>
            <span className="skl-sep">·</span>
            <span className="skl-sub">{skills.filter(s => s.career).length} in career (discounted)</span>
            <span className="skl-sep">·</span>
            <span className="skl-sub">{xp.current} XP available</span>
          </>
        }
        actions={
          <>
            <Button variant="ghost" iconLeft={<Icon name="search" size={13} color={colors.ink2} />}
              onPress={() => setFilterOpen(open => !open)}>
              {filterOpen ? 'Close filter' : 'Filter'}
            </Button>
            <Button iconLeft={<Icon name="plus" size={13} color={colors.ink} />}
              onPress={openNewSkill}>
              New skill
            </Button>
          </>
        }
      />

      {filterOpen ? (
        <div className="skl-search-row">
          <TextField
            label="Filter skills"
            value={query}
            onChangeText={setQuery}
            placeholder="name or characteristic"
            autoCapitalize="none"
            style={{ flex: 1 }}
          />
        </div>
      ) : null}

      <Section
        title="Career skills"
        aside={`${careerSkills.length} shown · ${c.career.toLowerCase()}`}
      />
      <SkillTable
        skills={careerSkills}
        advances={advances}
        onChange={onAdvChange}
        totalFor={totalFor}
        charLabel={charLabel}
        condMod={condMod}
        rules={rules}
        career
        extraNames={new Set(extraSkills.map(s => s.name))}
        onRemove={removeExtraSkill}
        definitionForSkill={definitionForSkill}
      />

      <Section title="Other" aside="2× cost · non-career" />
      <SkillTable
        skills={otherSkills}
        advances={advances}
        onChange={onAdvChange}
        totalFor={totalFor}
        charLabel={charLabel}
        condMod={condMod}
        rules={rules}
        extraNames={new Set(extraSkills.map(s => s.name))}
        onRemove={removeExtraSkill}
        definitionForSkill={definitionForSkill}
      />

      {untrainedBasics.length > 0 ? (
        <>
          <Section title="Basic skills (untrained)" aside="any character may attempt these at the raw characteristic" />
          <Card flush>
            <div className="skl-table">
            <Table>
              <TableRow header>
                <Cell header flex={2.4}>Name</Cell>
                <Cell header flex={0.5} className="skl-col-char">Char.</Cell>
                <Cell header num flex={0.6}>Total</Cell>
                <Cell header flex={0.4} className="skl-col-actions"> </Cell>
              </TableRow>
              {untrainedBasics.map((d, i) => (
                <TableRow key={d.id} last={i === untrainedBasics.length - 1}>
                  <Cell flex={2.4}>
                    <div className="skl-name-row">
                      <span className="skl-name">{d.name}</span>
                      <span className="skl-name-char">{charLabel[d.char] ?? d.char}</span>
                    </div>
                  </Cell>
                  <Cell flex={0.5} className="skl-col-char" textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>
                    {charLabel[d.char] ?? d.char}
                  </Cell>
                  <Cell num flex={0.6} textStyle={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13 }}>
                    {charBase[d.char] ?? 0}
                  </Cell>
                  <Cell flex={0.4} align="right" className="skl-col-actions">
                    <Button
                      variant="ghost"
                      ariaLabel={`Test ${d.name}`}
                      iconLeft={<Icon name="dice" size={13} color={colors.ink2} />}
                      onPress={() => rollUntrained(d)}
                    >{''}</Button>
                  </Cell>
                </TableRow>
              ))}
            </Table>
            </div>
          </Card>
        </>
      ) : null}

      {careerSkills.length === 0 && otherSkills.length === 0 && untrainedBasics.length === 0 ? (
        <Card>
          <span className="skl-empty">No skills match “{query.trim()}”.</span>
        </Card>
      ) : null}

      <EditSheet
        visible={draft !== null}
        title="New skill"
        subtitle="Add a skill or specialisation to this character. Advances are bought after saving."
        onClose={() => setDraft(null)}
        onSave={saveNewSkill}
        saveDisabled={!draft?.name.trim()
          || !draft?.char
          || (draft.mode === 'loaded' && (!draft.selectedDefId || !!selectedExclusionConflict))}
      >
        {draft ? (
          <>
            <PickerField
              label="Entry"
              value={draft.mode}
              onChange={mode => setDraft(current => current && ({
                ...current,
                mode,
                selectedDefId: mode === 'custom' ? '' : current.selectedDefId,
              }))}
              options={[
                { value: 'custom', label: 'Custom skill' },
                { value: 'loaded', label: 'Loaded definition' },
              ]}
              hint="Loaded definitions fill the rules fields for you. Use Custom skill for grouped specialisations such as Trade (Alchemist)."
            />
            {draft.mode === 'loaded' ? (
              <>
                <TextField
                  label="Search loaded skills"
                  value={pickerQuery}
                  onChangeText={setPickerQuery}
                  placeholder="name, description, source, restriction, or characteristic"
                  autoCapitalize="none"
                />
                <div className="skl-picker-list" role="listbox" aria-label="Loaded skills">
                  {pickerResults.map(skill => {
                    const selected = draft.selectedDefId === skill.id;
                    const source = skillSourceLabel(skill);
                    const status = skillRulesStatusLabel(skill);
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        className={`btn-reset skl-picker-option${selected ? ' skl-picker-option--selected' : ''}`}
                        role="option"
                        aria-selected={selected}
                        onClick={() => setDraft(current => current && ({
                          ...current,
                          selectedDefId: skill.id,
                          name: skill.name,
                          char: skill.char,
                          type: skill.advanced ? 'advanced' : 'basic',
                        }))}
                      >
                        <span className="skl-picker-heading">
                          <span className="skl-picker-name">{skill.name}</span>
                          <span className="skl-picker-kind">
                            {charLabel[skill.char] ?? skill.char} · {skill.advanced ? 'Advanced' : 'Basic'}
                            {skill.grouped ? ' · Grouped' : ''}
                          </span>
                        </span>
                        <span className="skl-picker-description">
                          {skill.description || 'No description available.'}
                        </span>
                        {source ? <span className="skl-picker-source">Source: {source}</span> : null}
                        {status ? <span className="skl-picker-status">{status}</span> : null}
                        {skill.restriction?.trim() ? (
                          <span className="skl-picker-restriction">
                            Restriction: {skill.restriction.trim()}
                          </span>
                        ) : null}
                        {skill.rulesNote?.trim() ? (
                          <span className="skl-picker-note">Rules note: {skill.rulesNote.trim()}</span>
                        ) : null}
                      </button>
                    );
                  })}
                  {pickerResults.length === 0 ? (
                    <span className="skl-picker-empty">No available loaded skills match this search.</span>
                  ) : null}
                </div>
              </>
            ) : null}
            {draft.mode === 'custom' ? (
              <>
                <TextField
                  label="Name"
                  value={draft.name}
                  onChangeText={name => setDraft(current => current && ({ ...current, name }))}
                  placeholder="e.g. Lore (Reikland)"
                />
                <PickerField
                  label="Characteristic"
                  value={draft.char}
                  onChange={char => setDraft(current => current && ({ ...current, char }))}
                  options={chars.map(char => ({ value: char.key, label: char.short }))}
                />
                <PickerField
                  label="Type"
                  value={draft.type}
                  onChange={type => setDraft(current => current && ({ ...current, type }))}
                  options={[
                    { value: 'basic', label: 'Basic' },
                    { value: 'advanced', label: 'Advanced' },
                  ]}
                />
              </>
            ) : draft.selectedDefId ? (
              <div className="skl-loaded-selection" aria-label="Selected loaded skill">
                <span className="skl-loaded-selection-label">Selected skill</span>
                <span className="skl-loaded-selection-name">{draft.name}</span>
                <span className="skl-loaded-selection-meta">
                  {charLabel[draft.char] ?? draft.char} · {draft.type === 'advanced' ? 'Advanced' : 'Basic'}
                </span>
                {selectedDefinition?.restriction?.trim() ? (
                  <span className="skl-loaded-selection-detail">
                    Restriction: {selectedDefinition.restriction.trim()}
                  </span>
                ) : null}
                {selectedExclusionConflict ? (
                  <span className="skl-loaded-selection-conflict" role="alert">
                    Cannot add while {selectedExclusionConflict.name} is owned.
                  </span>
                ) : null}
              </div>
            ) : null}
            <PickerField
              label="Pricing"
              value={draft.pricing}
              onChange={pricing => setDraft(current => current && ({ ...current, pricing }))}
              options={[
                { value: 'career', label: 'Career cost' },
                { value: 'other', label: 'Non-career (×2)' },
              ]}
              hint="Use career cost only when the GM confirms the skill is in your current career."
            />
          </>
        ) : null}
      </EditSheet>
    </ScreenContainer>
  );
};

interface SkillTableProps {
  skills: Skill[];
  advances: Record<string, number>;
  onChange: (skill: Skill, current: number, next: number) => void;
  totalFor: (s: Skill, adv: number) => number;
  charLabel: Record<string, string>;
  condMod: { total: number; parts: Array<{ name: string; stacks: number; modifier: number }> };
  rules: XpRules;
  career?: boolean;
  extraNames: Set<string>;
  onRemove: (skill: Skill) => void;
  definitionForSkill: (skill: Skill) => SkillDef | undefined;
}

const SkillTable: React.FC<SkillTableProps> = ({
  skills,
  advances,
  onChange,
  totalFor,
  charLabel,
  condMod,
  rules,
  career,
  extraNames,
  onRemove,
  definitionForSkill,
}) => {
  const system = useSystemRules();
  const recordTest = useRecordTest();
  return (
  <Card flush>
    <div className="skl-table">
    <Table>
      <TableRow header>
        <Cell header flex={2.4}>Name</Cell>
        <Cell header flex={0.5} className="skl-col-char">Char.</Cell>
        <Cell header num flex={0.5} className="skl-col-adv">Adv.</Cell>
        <Cell header num flex={0.6}>Total</Cell>
        <Cell header flex={2} className="skl-col-buy">Buy</Cell>
        <Cell header flex={0.4} className="skl-col-actions"> </Cell>
      </TableRow>
      {skills.map((s, i) => {
        const adv = advances[s.name] ?? s.adv;
        const tot = totalFor(s, adv);
        const nextCost = (career ? careerBracket : otherBracket)(rules, adv);
        const definition = definitionForSkill(s);
        const referenceMeta = [
          definition ? skillSourceLabel(definition) : '',
          definition ? skillRulesStatusMeta(definition) : '',
        ].filter(Boolean).join(' · ');
        const restriction = definition?.restriction?.trim();
        return (
          <TableRow key={`${s.name}-${i}`} last={i === skills.length - 1}>
            <Cell flex={2.4}>
              <div className="skl-name-stack">
                <div className="skl-name-row">
                  <span className="skl-name">{s.name}</span>
                  <span className="skl-name-char">{charLabel[s.char]}</span>
                  {s.advanced ? <Pill variant="brass" size={9.5}>advanced</Pill> : null}
                </div>
                {referenceMeta ? <span className="skl-row-reference">{referenceMeta}</span> : null}
                {restriction ? (
                  <span className="skl-row-restriction">Restriction: {restriction}</span>
                ) : null}
              </div>
            </Cell>
            <Cell flex={0.5} className="skl-col-char" textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>
              {charLabel[s.char]}
            </Cell>
            <Cell num flex={0.5} className="skl-col-adv" textStyle={{ color: colors.brass, fontFamily: 'var(--font-body)', fontWeight: 600 }}>
              +{adv}
            </Cell>
            <Cell num flex={0.6} textStyle={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13 }}>
              {tot}
            </Cell>
            <Cell flex={2} className="skl-col-buy">
              <div className="skl-purchase-cell">
                <Stepper
                  value={adv}
                  step={rules.buyStep}
                  min={0}
                  max={40}
                  decreaseLabel={`Decrease ${s.name}`}
                  increaseLabel={`Increase ${s.name}`}
                  onChange={(next) => onChange(s, adv, next)}
                />
                <span className="skl-cost">{nextCost} XP next</span>
              </div>
            </Cell>
            <Cell flex={0.4} align="right" className="skl-col-actions">
              <div className="skl-row-actions">
                <Button
                  variant="ghost"
                  ariaLabel={`Test ${s.name}`}
                  iconLeft={<Icon name="dice" size={13} color={colors.ink2} />}
                  onPress={() => {
                    if (s.advanced && adv === 0) {
                      Alert.alert(
                        'Train advanced skill first',
                        `${s.name} is an Advanced skill and cannot be tested at +0. Buy at least one advance first.`,
                      );
                      return;
                    }
                    const r = resolveTest({ target: tot, modifier: condMod.total, label: s.name }, system.test);
                    const breakdown = condMod.parts.length
                      ? '\n\nFrom conditions:\n' + condMod.parts.map(p => `  • ${p.name} ×${p.stacks} → ${p.modifier > 0 ? '+' : ''}${p.modifier}`).join('\n')
                      : '';
                    recordTest(r, breakdown + skillRulesLookup(definition));
                    Alert.alert(
                      `${s.name} — ${resultLabel(r)}`,
                      formatTestResult(r) + breakdown + skillRulesLookup(definition),
                    );
                  }}
                >{''}</Button>
                {extraNames.has(s.name) ? (
                  <Button
                    variant="ghost"
                    ariaLabel={`Remove ${s.name}`}
                    iconLeft={<Icon name="minus" size={13} color={colors.empire} />}
                    onPress={() => onRemove(s)}
                  >{''}</Button>
                ) : null}
              </div>
            </Cell>
          </TableRow>
        );
      })}
    </Table>
    </div>
  </Card>
  );
};
