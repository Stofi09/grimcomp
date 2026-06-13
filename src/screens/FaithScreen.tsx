import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { useStoredState } from '@/hooks/useStoredState';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useConditions } from '@/hooks/useConditions';
import { resolveTest, outcomeLabel, formatTestResult } from '@/utils/roll';
import { useResolvePrayers, useTable } from '@/content/useContent';
import { rollOnTable } from '@/content/tables';
import type { Prayer } from '@/content/types';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Stepper } from '@/components/Stepper';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors, fontFamilies } from '@/theme';
import { layoutStyles } from '@/components/primitives';

const rollD100 = () => Math.floor(Math.random() * 100) + 1;

export const FaithScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const { list: chars } = useCharacteristics();
  const { modifier: condMod } = useConditions();
  const [sin, setSin] = useStoredState(characterKey(id, 'sin'), 0);

  const prayers = useResolvePrayers(c.knownPrayers ?? []);
  const wrathTable = useTable('wrath');
  const fel = chars.find(x => x.key === 'fel')!;
  const praySkill = c.skills.find(s => s.name === 'Pray');
  const prayTarget = fel.current + (praySkill?.adv ?? 0);

  const pray = (prayer: Prayer) => {
    const r = resolveTest({ target: prayTarget, modifier: condMod.total, label: `Pray ${prayer.name}` });
    // Wrath of the Gods: on ANY Pray test whose units die ≤ current Sin Points
    // (WFRP 4e), regardless of pass/fail. Add +10 per Sin to the roll, then
    // remove 1 Sin after resolving.
    const units = r.roll % 10;
    const wrathTriggered = sin > 0 && units <= sin;

    if (wrathTriggered) {
      const wRoll = Math.min(100, rollD100() + 10 * sin);
      const wrath = rollOnTable(wrathTable, wRoll);
      setSin(s => Math.max(0, s - 1));
      const effectLine = r.success
        ? `\n\nThe prayer is still answered: ${prayer.description}`
        : `\n\nThe prayer falters.`;
      Alert.alert(
        `${prayer.name} — Wrath of the Gods`,
        `${formatTestResult(r)}${effectLine}\n\nWrath (${wRoll}):\n${wrath}\n\n−1 Sin (now ${Math.max(0, sin - 1)}).`,
      );
      return;
    }

    if (r.success) {
      Alert.alert(
        `${prayer.name} — ${outcomeLabel(r.outcome)}`,
        `${formatTestResult(r)}\n\n→ ${prayer.description}`,
      );
    } else {
      Alert.alert(
        `${prayer.name} — ${outcomeLabel(r.outcome)}`,
        `${formatTestResult(r)}\n\nThe deity does not answer.`,
      );
    }
  };

  // Non-Anointed view: keeps the Sin counter + dogma card but no prayer list.
  if (!c.isAnointed) {
    return (
      <ScreenContainer>
        <Hero
          title="Faith"
          subRow={<Text style={styles.sub}>{c.name} is devout but not Anointed — a follower, not a priest.</Text>}
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
                onPress={() => Alert.alert('Sin & Wrath', 'Sin accrues from breaking your cult\'s strictures. For the Anointed, any Pray test whose units die ≤ your Sin Points triggers Wrath of the Gods.')}
              >
                Sin table
              </Button>
            </View>
          </Card>

          <Card style={styles.cell}>
            <Text style={styles.label}>Deity</Text>
            <Text style={styles.deity}>{c.deity ?? 'Sigmar — Father of the Empire'}</Text>
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
  }

  // Anointed view: full deity card + prayer list with cast buttons.
  return (
    <ScreenContainer>
      <Hero
        title="Faith"
        subRow={
          <>
            <Text style={styles.sub}>Anointed of {c.deity ?? 'Shallya'}</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>{prayers.length} prayers</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>Pray {praySkill ? `+${praySkill.adv}` : '—'}</Text>
          </>
        }
      />

      <View style={styles.row}>
        <Card style={styles.cell}>
          <Text style={styles.label}>Sin</Text>
          <Text style={[styles.bigCorr, sin >= 3 ? { color: colors.empire } : null]}>{sin}</Text>
          <Text style={styles.body}>
            Sin from broken dogma. Each Pray test risks Wrath when the units die ≤ your Sin ({sin}).
          </Text>
          <View style={styles.controls}>
            <Stepper value={sin} min={0} max={10} onChange={setSin} />
            <Button
              variant="ghost"
              iconLeft={<Icon name="info" size={12} color={colors.ink2} />}
              onPress={() => Alert.alert('Sin & Wrath', 'On any Pray test, if the units die of the roll is ≤ your Sin Points, you suffer Wrath of the Gods (+10 to the Wrath roll per Sin Point). One Sin is removed after Wrath resolves. Gain Sin by breaking your cult\'s strictures.')}
            >
              Penalties
            </Button>
          </View>
        </Card>

        <Card style={styles.cell}>
          <Text style={styles.label}>Deity</Text>
          <Text style={styles.deity}>{c.deity ?? 'Shallya'} — Goddess of Mercy</Text>
          <Text style={styles.body}>
            Dogma: tend the dying, forgive the repentant, never deal a killing blow except against Chaos.
          </Text>
          <View style={styles.divider} />
          <View style={styles.pillRow}>
            <Pill variant="brass">Anointed</Pill>
            <Pill variant="success">Bless granted</Pill>
          </View>
        </Card>
      </View>

      <Section title="Known prayers" aside={`Fel ${fel.current} · target ${prayTarget}`} />
      <Card flush>
        <CardHead title="Prayers" meta={(c.deity ?? '').toLowerCase()} />
        <Table>
          <TableRow header>
            <Cell header flex={2}>Name</Cell>
            <Cell header flex={1.1}>Deity</Cell>
            <Cell header flex={1.2}>Range</Cell>
            <Cell header flex={1.1}>Duration</Cell>
            <Cell header flex={0.5}> </Cell>
          </TableRow>
          {prayers.map((p, i) => (
            <TableRow key={p.id} last={i === prayers.length - 1}>
              <Cell flex={2}>
                <View>
                  <Text style={styles.prayerName}>{p.name}</Text>
                  <Text style={styles.prayerDesc} numberOfLines={2}>{p.description}</Text>
                </View>
              </Cell>
              <Cell flex={1.1}>
                <Pill variant={p.deity === 'Any' ? 'ghost' : 'brass'} size={10}>{p.deity}</Pill>
              </Cell>
              <Cell flex={1.2} textStyle={{ fontFamily: fontFamilies.mono, fontSize: 11, color: colors.ink3 }}>{p.range}</Cell>
              <Cell flex={1.1} textStyle={{ fontFamily: fontFamilies.mono, fontSize: 11, color: colors.ink3 }}>{p.duration}</Cell>
              <Cell flex={0.5} align="right">
                <Button
                  variant="ghost"
                  iconLeft={<Icon name="dice" size={13} color={colors.ink2} />}
                  onPress={() => pray(p)}
                >{''}</Button>
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
  sep: { color: colors.ink4 },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 8 },
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
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' },
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
  prayerName: {
    fontFamily: fontFamilies.bodySemibold,
    fontSize: 13,
    color: colors.ink,
  },
  prayerDesc: {
    fontFamily: fontFamilies.body,
    fontSize: 11,
    color: colors.ink3,
    marginTop: 2,
    lineHeight: 15,
  },
});
