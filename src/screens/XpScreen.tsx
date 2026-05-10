import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { CHARACTER, XP_LOG, type XpKind } from '@/data/character';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Counter } from '@/components/Counter';
import { Card } from '@/components/Card';
import { Pill, type PillVariant } from '@/components/Pill';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors, fontFamilies } from '@/theme';
import { tabular } from '@/components/primitives';

const KIND_VARIANT: Record<XpKind, PillVariant> = {
  gain: 'success',
  career: 'empire',
  talent: 'brass',
  skill: 'ghost',
  char: 'ghost',
};

const KIND_LABEL: Record<XpKind, string> = {
  gain: 'Gain',
  skill: 'Skill',
  char: 'Char.',
  talent: 'Talent',
  career: 'Career',
};

export const XpScreen: React.FC = () => {
  const c = CHARACTER;
  return (
    <ScreenContainer>
      <Hero
        title="XP Log"
        subRow={<Text style={styles.sub}>Every XP gain and spend is recorded here.</Text>}
      />

      <View style={styles.row}>
        <Counter label="Spendable" sub="now" value={c.xpCurrent} variant="fate" style={{ flex: 1 }} />
        <Counter label="Spent" sub="lifetime" value={c.xpSpent} style={{ flex: 1 }} />
        <Counter label="Total earned" sub="play time" value={c.xpCurrent + c.xpSpent} style={{ flex: 1 }} />
      </View>

      <Section title="Log" aside="newest first" />
      <Card flush>
        <Table>
          <TableRow header>
            <Cell header flex={1}>Date</Cell>
            <Cell header flex={3}>Reason</Cell>
            <Cell header flex={1.2}>Kind</Cell>
            <Cell header num flex={0.8}>XP</Cell>
          </TableRow>
          {XP_LOG.map((e, i) => (
            <TableRow key={i} last={i === XP_LOG.length - 1}>
              <Cell flex={1} textStyle={{ fontFamily: fontFamilies.mono, fontSize: 11, color: colors.ink3 }}>
                {e.date}
              </Cell>
              <Cell flex={3}>{e.reason}</Cell>
              <Cell flex={1.2}>
                <Pill variant={KIND_VARIANT[e.kind]} size={10}>{KIND_LABEL[e.kind]}</Pill>
              </Cell>
              <Cell
                num
                flex={0.8}
                textStyle={[
                  { fontFamily: fontFamilies.monoMedium, color: e.amount > 0 ? colors.success : colors.ink },
                  tabular,
                ]}
              >
                {e.amount > 0 ? `+${e.amount}` : `${e.amount}`}
              </Cell>
            </TableRow>
          ))}
        </Table>
      </Card>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
});
