import type * as React from 'react';
import { useCallback } from 'react';
import { ScreenContainer } from './ScreenContainer';
import { type Skill } from '@/data/character';
import { useStoredState } from '@/hooks/useStoredState';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useXp } from '@/hooks/useXp';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useConditions } from '@/hooks/useConditions';
import { useXpRules, useSystemRules } from '@/content/useContent';
import { resolveTest, outcomeLabel, formatTestResult } from '@/utils/roll';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Stepper } from '@/components/Stepper';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { Alert } from '@/ui/alert';
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

// A +5 purchase is five advances within one band, so it costs five times the
// per-advance rate. Non-career advances cost double the listed rate (core p.48).
const careerBracket = (rules: XpRules, adv: number) => rules.buyStep * perSkillAdvance(rules, adv);
const otherBracket = (rules: XpRules, adv: number) => rules.nonCareerSkillMultiplier * careerBracket(rules, adv);

export const SkillsScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const { list: chars } = useCharacteristics();
  const xp = useXp();
  const { modifier: condMod } = useConditions();
  const rules = useXpRules();
  const charLabel = Object.fromEntries(c.characteristics.map(x => [x.key, x.short])) as Record<string, string>;
  const charBase = Object.fromEntries(chars.map(x => [x.key, x.current])) as Record<string, number>;

  const [advances, setAdvances] = useStoredState<Record<string, number>>(
    characterKey(id, 'skills.adv'),
    Object.fromEntries(c.skills.map(s => [s.name, s.adv])),
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
      // Refund the bracket the user is leaving (the last +5 they bought).
      const refund = bracket(rules, next);
      const reason = `${skill.name} +${current} → +${next}`;
      xp.refund(refund, `${skill.name} +${next} → +${current}`, 'skill');
      setAdvances(prev => ({ ...prev, [skill.name]: next }));
      // Best-effort feedback for the refund.
      // (Skip an alert to keep stepper feel snappy.)
      void reason;
    }
  }, [rules, xp, setAdvances]);

  const totalFor = (s: Skill, adv: number) => (charBase[s.char] ?? 0) + adv;

  const careerSkills = c.skills.filter(s => s.career);
  const otherSkills = c.skills.filter(s => !s.career);

  return (
    <ScreenContainer>
      <Hero
        eyebrow="Sheet 3 — Skills"
        title="Skills"
        subRow={
          <>
            <span className="skl-sub">{c.skills.length} skills</span>
            <span className="skl-sep">·</span>
            <span className="skl-sub">{careerSkills.length} in career (discounted)</span>
            <span className="skl-sep">·</span>
            <span className="skl-sub">{xp.current} XP available</span>
          </>
        }
        actions={
          <>
            <Button variant="ghost" iconLeft={<Icon name="search" size={13} color={colors.ink2} />}
              onPress={() => Alert.alert('Filter', 'Filter UI not wired up in this prototype.')}>
              Filter
            </Button>
            <Button iconLeft={<Icon name="plus" size={13} color={colors.ink} />}
              onPress={() => Alert.alert('New Skill', 'Adding new skills is not wired up.')}>
              New skill
            </Button>
          </>
        }
      />

      <Section
        title="Career skills"
        aside={`${careerSkills.length} · ${c.career.toLowerCase()}`}
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
      />
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
}

const SkillTable: React.FC<SkillTableProps> = ({ skills, advances, onChange, totalFor, charLabel, condMod, rules, career }) => {
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
                  onChange={(next) => onChange(s, adv, next)}
                />
                <span className="skl-cost">{nextCost} XP next</span>
              </div>
            </Cell>
            <Cell flex={0.4} align="right">
              <Button
                variant="ghost"
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
            </Cell>
          </TableRow>
        );
      })}
    </Table>
  </Card>
  );
};
