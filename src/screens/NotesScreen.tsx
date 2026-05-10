import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { colors, fontFamilies } from '@/theme';

interface Note {
  cat: string; title: string; src: 'official' | 'local'; body: string;
}

const NOTES: Note[] = [
  { cat: 'Sin', title: 'Sin thresholds and penalties', src: 'official', body: 'Sin 1 → −10 Faith. Sin 3 → harder spellcasting. Sin 5 → punitive event.' },
  { cat: 'Miscast', title: 'Minor Miscast table', src: 'official', body: 'Roll d100, apply the listed effect. The GM may flavour it.' },
  { cat: 'Miscast', title: 'Major Miscast table', src: 'official', body: 'Corruption point and additional consequences.' },
  { cat: 'Fear', title: 'Fear & Terror thresholds', src: 'official', body: 'WP test; on failure the Broken condition.' },
  { cat: 'House', title: 'Our group: 1 Fate per scene', src: 'local', body: 'A Fate refreshes at the start of every scene to keep things moving.' },
  { cat: 'GM', title: 'Eberfeld road encounters', src: 'local', body: 'Encounter table for the Eberfeld–Ubersreik road.' },
  { cat: 'Sin', title: 'Sigmund\'s personal Sin list', src: 'local', body: 'Specific deeds that count as Sin for a Sigmar follower.' },
];

const FILTERS = ['All', 'Sin', 'Miscast', 'Channelling', 'Fear', 'Corruption', 'Mutation', 'House', 'GM'];

export const NotesScreen: React.FC = () => {
  const [filter, setFilter] = useState('All');
  const visible = filter === 'All' ? NOTES : NOTES.filter(n => n.cat === filter);

  return (
    <ScreenContainer>
      <Hero
        title="Notes"
        subRow={<Text style={styles.sub}>Rulebook references and your own notes side-by-side.</Text>}
        actions={
          <>
            <Button
              variant="ghost"
              iconLeft={<Icon name="search" size={13} color={colors.ink2} />}
              onPress={() => Alert.alert('Search', 'Notes search not wired up.')}
            >
              Search
            </Button>
            <Button
              iconLeft={<Icon name="plus" size={13} color={colors.ink} />}
              onPress={() => Alert.alert('New note', 'Composing a new note is not wired up.')}
            >
              New note
            </Button>
          </>
        }
      />

      <Section title="Categories" />
      <View style={styles.chips}>
        {FILTERS.map(c => {
          const on = c === filter;
          return (
            <Pressable
              key={c}
              onPress={() => setFilter(c)}
              hitSlop={4}
              style={({ pressed }) => [
                styles.chip,
                on && styles.chipOn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.grid}>
        {visible.map((n, i) => (
          <Pressable key={i} style={styles.cellWrap} onPress={() => Alert.alert(n.title, n.body)}>
            <Card tight style={{ flex: 1 }}>
              <View style={styles.head}>
                <Text style={styles.cat}>{n.cat.toUpperCase()}</Text>
                <Pill variant={n.src === 'official' ? 'empire' : 'brass'} size={9}>
                  {n.src === 'official' ? 'OFFICIAL' : 'HOUSE'}
                </Pill>
              </View>
              <Text style={styles.title}>{n.title}</Text>
              <Text style={styles.body}>{n.body}</Text>
            </Card>
          </Pressable>
        ))}
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 4,
  },
  chipOn: {
    backgroundColor: colors.empire,
    borderColor: colors.empireDeep,
  },
  chipText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 11.5,
    color: colors.ink2,
  },
  chipTextOn: { color: colors.bone },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  cellWrap: { flexBasis: '48%', flexGrow: 1, minWidth: 280 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cat: {
    fontFamily: fontFamilies.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.ink3,
  },
  title: {
    fontFamily: fontFamilies.display,
    fontSize: 17,
    color: colors.ink,
    marginTop: 6,
  },
  body: {
    color: colors.ink3,
    fontSize: 12,
    marginTop: 6,
    lineHeight: 18,
    fontFamily: fontFamilies.body,
  },
});
