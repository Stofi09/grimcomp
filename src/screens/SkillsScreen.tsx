import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { CHARACTER, type Skill } from '@/data/character';
import { useStoredState } from '@/hooks/useStoredState';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Stepper } from '@/components/Stepper';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors, fontFamilies } from '@/theme';

const careerCost = (adv: number) =>
  adv < 5 ? 25 : adv < 10 ? 30 : adv < 15 ? 40 : 50;

const rollD100 = () => Math.floor(Math.random() * 100) + 1;

export const SkillsScreen: React.FC = () => {
  const c = CHARACTER;
  const charLabel = Object.fromEntries(c.characteristics.map(x => [x.key, x.short])) as Record<string, string>;
  // Per-skill advance state, initialised from the character data and persisted
  // across reloads. Edits make Adv./Total/Buy update live as the user taps the
  // steppers.
  const [advances, setAdvances] = useStoredState<Record<string, number>>(
    'gc.skills.adv',
    Object.fromEntries(c.skills.map(s => [s.name, s.adv]))
  );
  const setAdv = (name: string, next: number) =>
    setAdvances(prev => ({ ...prev, [name]: next }));
  const totalFor = (s: Skill, adv: number) => {
    const ch = c.characteristics.find(x => x.key === s.char)!;
    return ch.init + ch.adv + adv;
  };
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

      <Section title="Career skills" aside="8 / 8 · roadwarden" />
      <SkillTable
        skills={c.skills.filter(s => s.career)}
        advances={advances}
        setAdv={setAdv}
        totalFor={totalFor}
        charLabel={charLabel}
        career
      />

      <Section title="Other" aside="+5 xp surcharge" />
      <SkillTable
        skills={c.skills.filter(s => !s.career)}
        advances={advances}
        setAdv={setAdv}
        totalFor={totalFor}
        charLabel={charLabel}
      />
    </ScreenContainer>
  );
};

interface SkillTableProps {
  skills: Skill[];
  advances: Record<string, number>;
  setAdv: (name: string, next: number) => void;
  totalFor: (s: Skill, adv: number) => number;
  charLabel: Record<string, string>;
  career?: boolean;
}

const SkillTable: React.FC<SkillTableProps> = ({ skills, advances, setAdv, totalFor, charLabel, career }) => (
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
                  onChange={(next) => setAdv(s.name, next)}
                />
                <Text style={styles.cost}>
                  {career ? `${careerCost(adv)} XP` : '+5 surcharge'}
                </Text>
              </View>
            </Cell>
            <Cell flex={0.4} align="right">
              <Button
                variant="ghost"
                iconLeft={<Icon name="dice" size={13} color={colors.ink2} />}
                onPress={() => Alert.alert(`${s.name} test`, `d100 → ${rollD100()} (target ${tot})`)}
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
