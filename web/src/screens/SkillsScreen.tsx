import type * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { ScreenContainer } from './ScreenContainer';
import { type Skill } from '@/data/character';
import { useStoredState } from '@/hooks/useStoredState';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useXp } from '@/hooks/useXp';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useConditions } from '@/hooks/useConditions';
import { useCareers, useXpRules, useSystemRules, useSkillDefs } from '@/content/useContent';
import { resolveTest, outcomeLabel, formatTestResult } from '@/utils/roll';
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
import type { XpRules } from '@/content/types';
import './SkillsScreen.css';

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
  const [extraSkills, setExtraSkills] = useStoredState<Skill[]>(characterKey(id, 'skills.extra'), []);
  const registryCareer = careers.find(candidate => candidate.name === c.career);
  const careerSkillNames = registryCareer?.advanceScheme?.skills;
  // Merge the current registry scheme into old character records as a
  // non-destructive live migration. This means characters created before the
  // fallback career data shipped gain their missing career skills at +0.
  const skills = useMemo(() => {
    const careerNames = new Set(careerSkillNames ?? []);
    const merged: Skill[] = c.skills.map(skill => careerNames.has(skill.name)
      ? { ...skill, career: true }
      : skill);
    const have = new Set(merged.map(skill => skill.name));
    for (const name of careerSkillNames ?? []) {
      if (have.has(name)) continue;
      const def = skillDefs.find(candidate => candidate.name === name)
        ?? skillDefs.find(candidate => name.startsWith(`${candidate.name} (`));
      merged.push({
        name,
        char: def?.char ?? c.characteristics[0]?.key ?? 'ws',
        adv: 0,
        career: true,
        advanced: def?.advanced,
      });
      have.add(name);
    }
    for (const skill of extraSkills) {
      if (!have.has(skill.name)) merged.push(skill);
    }
    return merged;
  }, [c.characteristics, c.skills, careerSkillNames, extraSkills, skillDefs]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<{
    name: string;
    char: string;
    type: 'basic' | 'advanced';
    pricing: 'career' | 'other';
  } | null>(null);

  const [advances, setAdvances] = useStoredState<Record<string, number>>(
    characterKey(id, 'skills.adv'),
    Object.fromEntries(skills.map(s => [s.name, s.adv])),
  );

  // Stepper change handler that runs through the XP economy. Each +5 click
  // costs the next bracket; each −5 refunds the bracket the user is leaving.
  const onAdvChange = useCallback((skill: Skill, current: number, next: number) => {
    const bracket = skill.career ? careerBracket : otherBracket;
    if (next > current) {
      const cost = bracket(rules, current);
      const reason = `${skill.name} +${current} → +${next}`;
      const r = xp.spend(cost, reason, 'skill');
      if (!r.ok) {
        Alert.alert('Not enough XP', r.message);
        return;
      }
      setAdvances(prev => ({ ...prev, [skill.name]: next }));
    } else if (next < current) {
      // Refund the bracket the user is leaving (the last +5 they bought). Only
      // step the advance down when the refund actually credited XP — otherwise
      // (e.g. stepping a template-granted skill below its starting level, which
      // was never purchased) we'd silently drop the rank for nothing.
      const refund = bracket(rules, next);
      const r = xp.refund(refund, `${skill.name} +${next} → +${current}`, 'skill');
      if (!r.ok) {
        Alert.alert("Can't refund", r.message);
        return;
      }
      setAdvances(prev => ({ ...prev, [skill.name]: next }));
    }
  }, [rules, xp, setAdvances]);

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
  const ownedNames = new Set(skills.map(s => s.name));
  const untrainedBasics = skillDefs.filter(
    d => !d.advanced
      && !d.grouped
      && !ownedNames.has(d.name)
      && (!normalizedQuery
        || d.name.toLocaleLowerCase().includes(normalizedQuery)
        || (charLabel[d.char] ?? d.char).toLocaleLowerCase().includes(normalizedQuery)),
  );

  const openNewSkill = () => {
    setDraft({
      name: '',
      char: chars[0]?.key ?? '',
      type: 'basic',
      pricing: 'other',
    });
  };

  const saveNewSkill = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return;
    if (skills.some(s => s.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      Alert.alert('Skill already exists', `${name} is already on this character sheet.`);
      return;
    }
    setExtraSkills(prev => [
      ...prev,
      {
        name,
        char: draft.char,
        adv: 0,
        career: draft.pricing === 'career',
        advanced: draft.type === 'advanced',
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
          onPress: () => setExtraSkills(prev => prev.filter(s => s.name !== skill.name)),
        },
      ],
    );
  };

  const rollUntrained = (name: string, char: string) => {
    const tot = charBase[char] ?? 0;
    const r = resolveTest({ target: tot, modifier: condMod.total, label: name }, system.test);
    const breakdown = condMod.parts.length
      ? '\n\nFrom conditions:\n' + condMod.parts.map(p => `  • ${p.name} ×${p.stacks} → ${p.modifier > 0 ? '+' : ''}${p.modifier}`).join('\n')
      : '';
    Alert.alert(`${name} — ${outcomeLabel(r.outcome)}`, formatTestResult(r) + breakdown);
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
      />

      {untrainedBasics.length > 0 ? (
        <>
          <Section title="Basic skills (untrained)" aside="any character may attempt these at the raw characteristic" />
          <Card flush>
            <Table>
              <TableRow header>
                <Cell header flex={2.4}>Name</Cell>
                <Cell header flex={0.5}>Char.</Cell>
                <Cell header num flex={0.6}>Total</Cell>
                <Cell header flex={0.4}> </Cell>
              </TableRow>
              {untrainedBasics.map((d, i) => (
                <TableRow key={d.id} last={i === untrainedBasics.length - 1}>
                  <Cell flex={2.4}><span className="skl-name">{d.name}</span></Cell>
                  <Cell flex={0.5} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>
                    {charLabel[d.char] ?? d.char}
                  </Cell>
                  <Cell num flex={0.6} textStyle={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13 }}>
                    {charBase[d.char] ?? 0}
                  </Cell>
                  <Cell flex={0.4} align="right">
                    <Button
                      variant="ghost"
                      ariaLabel={`Test ${d.name}`}
                      iconLeft={<Icon name="dice" size={13} color={colors.ink2} />}
                      onPress={() => rollUntrained(d.name, d.char)}
                    >{''}</Button>
                  </Cell>
                </TableRow>
              ))}
            </Table>
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
        saveDisabled={!draft?.name.trim() || !draft?.char}
      >
        {draft ? (
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
}) => {
  const system = useSystemRules();
  return (
  <Card flush>
    <Table>
      <TableRow header>
        <Cell header flex={2.4}>Name</Cell>
        <Cell header flex={0.5}>Char.</Cell>
        <Cell header num flex={0.5}>Adv.</Cell>
        <Cell header num flex={0.6}>Total</Cell>
        <Cell header flex={2}>Buy</Cell>
        <Cell header flex={0.4}> </Cell>
      </TableRow>
      {skills.map((s, i) => {
        const adv = advances[s.name] ?? s.adv;
        const tot = totalFor(s, adv);
        const nextCost = (career ? careerBracket : otherBracket)(rules, adv);
        return (
          <TableRow key={`${s.name}-${i}`} last={i === skills.length - 1}>
            <Cell flex={2.4}>
              <div className="skl-name-row">
                <span className="skl-name">{s.name}</span>
                {s.advanced ? <Pill variant="brass" size={9.5}>advanced</Pill> : null}
              </div>
            </Cell>
            <Cell flex={0.5} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>
              {charLabel[s.char]}
            </Cell>
            <Cell num flex={0.5} textStyle={{ color: colors.brass, fontFamily: 'var(--font-body)', fontWeight: 600 }}>
              +{adv}
            </Cell>
            <Cell num flex={0.6} textStyle={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13 }}>
              {tot}
            </Cell>
            <Cell flex={2}>
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
            <Cell flex={0.4} align="right">
              <div className="skl-row-actions">
                <Button
                  variant="ghost"
                  ariaLabel={`Test ${s.name}`}
                  iconLeft={<Icon name="dice" size={13} color={colors.ink2} />}
                  onPress={() => {
                    const r = resolveTest({ target: tot, modifier: condMod.total, label: s.name }, system.test);
                    const breakdown = condMod.parts.length
                      ? '\n\nFrom conditions:\n' + condMod.parts.map(p => `  • ${p.name} ×${p.stacks} → ${p.modifier > 0 ? '+' : ''}${p.modifier}`).join('\n')
                      : '';
                    Alert.alert(
                      `${s.name} — ${outcomeLabel(r.outcome)}`,
                      formatTestResult(r) + breakdown,
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
  </Card>
  );
};
