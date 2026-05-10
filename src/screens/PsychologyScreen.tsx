import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { CHARACTER } from '@/data/character';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Bar } from '@/components/Bar';
import { colors, fontFamilies } from '@/theme';
import { tabular, layoutStyles } from '@/components/primitives';

export const PsychologyScreen: React.FC = () => {
  const c = CHARACTER;
  return (
    <ScreenContainer>
      <Hero
        title="Psychology"
        subRow={<Text style={styles.sub}>Motivation, ambitions, mutations, and the corruption of Chaos.</Text>}
      />

      <View style={styles.row}>
        <Card style={styles.cell}>
          <Text style={styles.label}>Motivation</Text>
          <Text style={styles.title}>{c.motivation}</Text>
          <Text style={styles.body}>Refreshes Resolve at the start of a scene</Text>
        </Card>
        <Card style={styles.cell}>
          <Text style={styles.label}>Psychological traits</Text>
          <View style={styles.chips}>
            {c.psychology.map((p, i) => (
              <Pill key={i} variant="warn" size={11}>{p}</Pill>
            ))}
          </View>
        </Card>
      </View>

      <View style={[styles.row, { marginTop: 12 }]}>
        <Card style={styles.cell}>
          <Text style={styles.label}>Short-term ambition</Text>
          <Text style={styles.title}>{c.ambitionsShort}</Text>
          <View style={styles.pillRow}>
            <Pill variant="brass" size={10}>complete = 100 XP</Pill>
          </View>
        </Card>
        <Card style={styles.cell}>
          <Text style={styles.label}>Long-term ambition</Text>
          <Text style={styles.title}>{c.ambitionsLong}</Text>
          <View style={styles.pillRow}>
            <Pill variant="brass" size={10}>complete = 200 XP</Pill>
          </View>
        </Card>
      </View>

      <Section title="Corruption & Mutation" />
      <View style={styles.row}>
        <Card style={styles.cell}>
          <View style={layoutStyles.rowBetween}>
            <Text style={styles.label}>Corruption points</Text>
            <Text style={styles.metaMono}>threshold 6</Text>
          </View>
          <Text style={[styles.bigCorr, tabular]}>
            {c.corruption}
            <Text style={[styles.muted, { fontSize: 18 }]}> / 6</Text>
          </Text>
          <Bar value={c.corruption / 6} variant="corr" style={{ marginTop: 10 }} />
          <Text style={styles.body}>At threshold: roll a mutation test.</Text>
        </Card>
        <Card style={styles.cell}>
          <Text style={styles.label}>Mutations</Text>
          {c.mutations.length === 0 ? (
            <Text style={[styles.body, { textAlign: 'center', paddingVertical: 20 }]}>— clean —</Text>
          ) : (
            c.mutations.map((m, i) => <Text key={i}>{m.name}</Text>)
          )}
        </Card>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 20 },
  cell: { flex: 1, minWidth: 280 },
  label: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: fontFamilies.display,
    fontSize: 18,
    color: colors.ink,
    marginTop: 6,
  },
  body: {
    color: colors.ink3,
    fontSize: 12,
    marginTop: 6,
    fontFamily: fontFamilies.body,
    lineHeight: 18,
  },
  muted: { color: colors.ink3 },
  pillRow: { flexDirection: 'row', marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  metaMono: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    color: colors.ink3,
  },
  bigCorr: {
    fontFamily: fontFamilies.display,
    fontSize: 42,
    color: colors.corruption,
    marginTop: 6,
    lineHeight: 42,
  },
});
