import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Stepper } from '@/components/Stepper';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { colors, fontFamilies } from '@/theme';

export const FaithScreen: React.FC = () => {
  const [sin, setSin] = useState(0);
  return (
    <ScreenContainer>
      <Hero
        title="Faith"
        subRow={<Text style={styles.sub}>Sigmund follows Sigmar but is not Anointed — devout, not a priest.</Text>}
      />

      <View style={styles.row}>
        <Card style={styles.cell}>
          <Text style={styles.label}>Sin</Text>
          <Text style={styles.bigCorr}>{sin}</Text>
          <Text style={styles.body}>
            Sin points accumulate when dogma is broken. Thresholds carry penalties.
          </Text>
          <View style={styles.controls}>
            <Stepper value={sin} min={0} max={10} onChange={setSin} />
            <Button
              variant="ghost"
              iconLeft={<Icon name="info" size={12} color={colors.ink2} />}
              onPress={() => Alert.alert('Sin table', 'Sin 1 → −10 to Faith. Sin 3 → harder spellcasting. Sin 5 → punitive event.')}
            >
              Sin table
            </Button>
          </View>
        </Card>

        <Card style={styles.cell}>
          <Text style={styles.label}>Deity</Text>
          <Text style={styles.deity}>Sigmar — Father of the Empire</Text>
          <Text style={styles.body}>
            Dogma: lead, defend, and sacrifice for the Empire. Hunt Chaos and the greenskins.
          </Text>
          <View style={styles.divider} />
          <View style={styles.pillRow}>
            <Pill>Devout</Pill>
            <Pill variant="ghost">Not Anointed</Pill>
          </View>
        </Card>
      </View>

      <Section title="Prayers" />
      <Card style={styles.empty}>
        <Text style={styles.emptyText}>
          No prayers learned. The Anointed career is required to chant prayers.
        </Text>
      </Card>
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
  bigCorr: {
    fontFamily: fontFamilies.display,
    fontSize: 48,
    color: colors.corruption,
    lineHeight: 48,
  },
  body: {
    color: colors.ink3,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 18,
    fontFamily: fontFamilies.body,
  },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  deity: {
    fontFamily: fontFamilies.display,
    fontSize: 22,
    color: colors.ink,
    marginTop: 6,
  },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 14 },
  pillRow: { flexDirection: 'row', gap: 6 },
  empty: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  emptyText: {
    color: colors.ink3,
    fontSize: 13,
    fontFamily: fontFamilies.body,
    textAlign: 'center',
  },
});
