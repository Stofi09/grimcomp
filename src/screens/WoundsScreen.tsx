import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { CONDITIONS } from '@/data/character';
import { useStoredState } from '@/hooks/useStoredState';
import { useConditions } from '@/hooks/useConditions';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card, CardHead } from '@/components/Card';
import { Bar } from '@/components/Bar';
import { Chip } from '@/components/Chip';
import { Stepper } from '@/components/Stepper';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors, fontFamilies } from '@/theme';
import { tabular, layoutStyles } from '@/components/primitives';

export const WoundsScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const [wounds, setWounds] = useStoredState(characterKey(id, 'wounds'), c.wounds.current);
  const { conds, cycle } = useConditions();
  const { list: chars } = useCharacteristics();
  const tb = chars.find(x => x.key === 't')?.bonus ?? 0;
  return (
    <ScreenContainer>
      <Hero
        title="Wounds & Conditions"
        subRow={<Text style={styles.sub}>Track combat health, critical wounds, and recovery.</Text>}
      />

      <View style={styles.row}>
        <Card style={[styles.flexBig]}>
          <View style={layoutStyles.rowBetween}>
            <Text style={styles.label}>Current wounds</Text>
            <Text style={styles.metaMono}>max {c.wounds.max} = SB + 2×TB + WPB</Text>
          </View>
          <View style={[layoutStyles.row, { gap: 16, marginTop: 10, alignItems: 'baseline' }]}>
            <Text style={[styles.bigEmpire, tabular]}>{wounds}</Text>
            <Text style={styles.bigFrac}>/ {c.wounds.max}</Text>
            <View style={{ flex: 1 }} />
            <Stepper value={wounds} min={0} max={c.wounds.max} onChange={setWounds} />
          </View>
          <Bar value={wounds / c.wounds.max} variant="empire" large style={{ marginTop: 14 }} />
          <View style={[layoutStyles.rowBetween, { marginTop: 8 }]}>
            <Text style={styles.metaMono}>0 · roll critical</Text>
            <Text style={styles.metaMono}>max · full health</Text>
          </View>
        </Card>

        <Card style={styles.flexSmall}>
          <Text style={styles.label}>Quick actions</Text>
          <View style={{ gap: 6, marginTop: 10 }}>
            <Button
              iconLeft={<Icon name="heart" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={() => {
                setWounds(w => Math.min(c.wounds.max, w + tb));
                Alert.alert('Rest', `Recovered ${tb} wounds (TB).`);
              }}
            >
              Rest (recover TB)
            </Button>
            <Button
              iconLeft={<Icon name="dice" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={() => {
                setWounds(w => Math.min(c.wounds.max, w + 4));
                Alert.alert('Healing Draught', 'Recovered 4 wounds.');
              }}
            >
              Use healing draught
            </Button>
            <Button
              iconLeft={<Icon name="flame" size={13} color={colors.ink} />}
              style={{ alignSelf: 'stretch' }}
              onPress={() => Alert.alert('End of scene', 'Fortune refreshed; conditions tick down by 1.')}
            >
              End of scene
            </Button>
          </View>
        </Card>
      </View>

      <Section title="Conditions" aside="tap to add a stack · long-press for the rule" />
      <View style={styles.chips}>
        {CONDITIONS.map(t => {
          const n = conds[t] ?? 0;
          return <Chip key={t} label={t} count={n} on={n > 0} onPress={() => cycle(t)} />;
        })}
      </View>

      <Section title="Critical Wounds" aside="d100 + hit location" />
      <Card flush>
        <CardHead
          title="Active critical wounds"
          right={
            <Button
              variant="primary"
              iconLeft={<Icon name="dice" size={12} color={colors.ivory} />}
              onPress={() => Alert.alert('New critical', `Critical roll → ${Math.floor(Math.random() * 100) + 1}`)}
            >
              New critical
            </Button>
          }
        />
        <Table>
          <TableRow header>
            <Cell header flex={1}>Location</Cell>
            <Cell header num flex={0.7}>Roll</Cell>
            <Cell header flex={2}>Wound</Cell>
            <Cell header flex={3}>Effect</Cell>
            <Cell header num flex={1}>Heal days</Cell>
            <Cell header flex={0.5}> </Cell>
          </TableRow>
          {c.criticals.map((cr, i) => (
            <TableRow key={i} last={i === c.criticals.length - 1}>
              <Cell flex={1}>{cr.loc}</Cell>
              <Cell num flex={0.7} textStyle={{ fontFamily: fontFamilies.mono }}>{cr.roll}</Cell>
              <Cell flex={2} textStyle={{ fontFamily: fontFamilies.bodySemibold }}>{cr.name}</Cell>
              <Cell flex={3} textStyle={{ color: colors.ink3 }}>{cr.effect}</Cell>
              <Cell num flex={1} textStyle={{ fontFamily: fontFamilies.mono }}>{cr.days}</Cell>
              <Cell flex={0.5} align="right">
                <Button
                  variant="ghost"
                  iconLeft={<Icon name="check" size={13} color={colors.success} />}
                  onPress={() => Alert.alert('Resolved', `${cr.name} marked as healed.`)}
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
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  flexBig: { flex: 2, minWidth: 360 },
  flexSmall: { flex: 1, minWidth: 240 },
  label: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  metaMono: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    color: colors.ink3,
  },
  bigEmpire: {
    fontFamily: fontFamilies.display,
    fontSize: 56,
    color: colors.empire,
    lineHeight: 56,
  },
  bigFrac: { fontSize: 16, color: colors.ink3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 20 },
});
