import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { type Skill } from '@/data/character';
import { useStoredState } from '@/hooks/useStoredState';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useXp } from '@/hooks/useXp';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useConditions } from '@/hooks/useConditions';
import { resolveTest, outcomeLabel, formatTestResult } from '@/utils/roll';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Stepper } from '@/components/Stepper';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors, fontFamilies } from '@/theme';

// Per-advance (+1) Skill XP cost (WFRP 4e core p.48). Skills are CHEAPER than
// characteristics and follow their own curve, keyed to advances already bought.
const perSkillAdvance = (adv: number) =>
  adv < 5 ? 10 : adv < 10 ? 15 : adv < 15 ? 20 : adv < 20 ? 30 : adv < 25 ? 40 : adv < 30 ? 60 : adv < 35 ? 80 : adv < 40 ? 110 : adv < 45 ? 140 : 180;

// A +5 purchase is five advances within one band, so it costs five times the
// per-advance rate. Non-career advances cost double the listed rate (core p.48).
const careerBracket = (adv: number) => 5 * perSkillAdvance(adv);
const otherBracket = (adv: number) => 2 * careerBracket(adv);

export const SkillsScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const { list: chars } = useCharacteristics();
  const xp = useXp();
  const { modifier: condMod } = useConditions();
  const charLabel = Object.fromEntries(c.characteristics.map(x => [x.key, x.short])) as Record<string, string>;
  const charBase = Object.fromEntries(chars.map(x => [x.key, x.current])) as Record<string, number>;

  const [advances, setAdvances] = useStoredState<Record<string, number>>(
    characterKey(id, 'skills.adv'),
    Object.fromEntries(c.skills.map(s => [s.name, s.adv]))
  );

  // Stepper change handler that runs through the XP economy. Each +5 click
  // costs the next bracket; each −5 refunds the bracket the user is leaving.
  const onAdvChange = (skill: Skill, current: number, next: number) => {
    const bracket = skill.career ? careerBracket : otherBracket;
    if (next > current) {
      const cost = bracket(current);
      const reason = `${skill.name} +${current} → +${next}`;
      const r = xp.spend(cost, reason, 'skill');
      if (!r.ok) {
        Alert.alert('Not enough XP', r.message);
        return;
      }
      setAdvances(prev => ({ ...prev, [skill.name]: next }));
    } else if (next < current) {
      // Refund the bracket the user is leaving (the last +5 they bought).
      const refund = bracket(next);
      const reason = `${skill.name} +${current} → +${next}`;
      xp.refund(refund, `${skill.name} +${next} → +${current}`, 'skill');
      setAdvances(prev => ({ ...prev, [skill.name]: next }));
      // Best-effort feedback for the refund.
      // (Skip an alert to keep stepper feel snappy.)
      void reason;
    }
  };

  const totalFor = (s: Skill, adv: number) => (charBase[s.char] ?? 0) + adv;

  return (
    <ScreenContainer>
      <Hero
        eyebrow="Sheet 3 — Skills"
        title="Skills"
        subRow={
          <>
            <Text style={styles.sub}>{c.skills.length} skills</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>{c.skills.filter(s => s.career).length} in career (discounted)</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>{xp.current} XP available</Text>
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
        aside={`${c.skills.filter(s => s.career).length} · ${c.career.toLowerCase()}`}
      />
      <SkillTable
        skills={c.skills.filter(s => s.career)}
        advances={advances}
        onChange={onAdvChange}
        totalFor={totalFor}
        charLabel={charLabel}
        condMod={condMod}
        career
      />

      <Section title="Other" aside="2× cost · non-career" />
      <SkillTable
        skills={c.skills.filter(s => !s.career)}
        advances={advances}
        onChange={onAdvChange}
        totalFor={totalFor}
        charLabel={charLabel}
        condMod={condMod}
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
  career?: boolean;
}

const SkillTable: React.FC<SkillTableProps> = ({ skills, advances, onChange, totalFor, charLabel, condMod, career }) => (
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
        const nextCost = (career ? careerBracket : otherBracket)(adv);
        return (
          <TableRow key={`${s.name}-${i}`} last={i === skills.length - 1}>
            <Cell flex={2.4}>
              <View style={styles.nameRow}>
                <Text style={styles.skillName}>{s.name}</Text>
                {s.advanced ? <Pill variant="brass" size={9.5}>advanced</Pill> : null}
              </View>
            </Cell>
            <Cell flex={0.5} textStyle={styles.charCol}>
              {charLabel[s.char]}
            </Cell>
            <Cell num flex={0.5} textStyle={{ color: colors.brass, fontFamily: fontFamilies.bodySemibold }}>
              +{adv}
            </Cell>
            <Cell num flex={0.6} textStyle={{ fontFamily: fontFamilies.bodySemibold, fontSize: 13 }}>
              {tot}
            </Cell>
            <Cell flex={2}>
              <View style={styles.purchaseCell}>
                <Stepper
                  value={adv}
                  step={5}
                  min={0}
                  max={40}
                  onChange={(next) => onChange(s, adv, next)}
                />
                <Text style={styles.cost}>{nextCost} XP next</Text>
              </View>
            </Cell>
            <Cell flex={0.4} align="right">
              <Button
                variant="ghost"
                iconLeft={<Icon name="dice" size={13} color={colors.ink2} />}
                onPress={() => {
                  const r = resolveTest({ target: tot, modifier: condMod.total, label: s.name });
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

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink2, fontFamily: fontFamilies.body },
  sep: { color: colors.ink4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  skillName: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 12,
    color: colors.ink,
  },
  charCol: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    color: colors.ink3,
  },
  purchaseCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  cost: {
    fontFamily: fontFamilies.mono,
    fontSize: 10,
    color: colors.ink3,
  },
});
