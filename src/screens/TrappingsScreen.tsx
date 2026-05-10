import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { CHARACTER, type CharacteristicKey } from '@/data/character';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Counter } from '@/components/Counter';
import { Bar } from '@/components/Bar';
import { Button } from '@/components/Button';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors, fontFamilies } from '@/theme';
import { tabular, layoutStyles } from '@/components/primitives';

const bonusOf = (k: CharacteristicKey) => {
  const c = CHARACTER.characteristics.find(x => x.key === k)!;
  return Math.floor((c.init + c.adv) / 10);
};

export const TrappingsScreen: React.FC = () => {
  const c = CHARACTER;
  const sb = bonusOf('s');
  const tb = bonusOf('t');
  const maxEnc = sb + tb;
  const encItems = c.trappings.reduce((a, x) => a + x.enc, 0);
  const encW = c.weapons.reduce((a, x) => a + x.enc, 0);
  const encA = c.armour.reduce((a, x) => a + x.enc, 0);
  const enc = encItems + encW + encA;
  return (
    <ScreenContainer>
      <Hero title="Trappings" subRow={<Text style={styles.sub}>Inventory, encumbrance, and coin.</Text>} />

      <View style={styles.row}>
        <Counter
          label="Encumbrance"
          sub={`max ${maxEnc} (SB+TB)`}
          value={
            <Text style={[
              { fontFamily: fontFamilies.display, fontSize: 48, color: enc > maxEnc ? colors.empire : colors.ink },
              tabular,
            ]}>
              {enc}
              <Text style={{ fontSize: 18, color: colors.ink3, fontFamily: fontFamilies.displayItalic }}>/{maxEnc}</Text>
            </Text>
          }
          style={{ flex: 1 }}
        />
        <Counter
          label="Wealth"
          sub={`${c.wealth.gc * 20 * 12 + c.wealth.ss * 12 + c.wealth.d} brass ≈`}
          variant="fate"
          value={
            <Text style={[{ fontFamily: fontFamilies.display, fontSize: 28, color: colors.brass }, tabular]}>
              {c.wealth.gc}<Text style={styles.frac}> GC </Text>
              {c.wealth.ss}<Text style={styles.frac}> SS </Text>
              {c.wealth.d}<Text style={styles.frac}> BP</Text>
            </Text>
          }
          style={{ flex: 1 }}
        />
        <Card style={{ flex: 1 }}>
          <Text style={styles.label}>Encumbrance breakdown</Text>
          <View style={{ gap: 6, marginTop: 8 }}>
            <View style={layoutStyles.rowBetween}><Text style={styles.muted}>Weapons</Text><Text style={[styles.mono]}>{encW}</Text></View>
            <View style={layoutStyles.rowBetween}><Text style={styles.muted}>Armour</Text><Text style={[styles.mono]}>{encA}</Text></View>
            <View style={layoutStyles.rowBetween}><Text style={styles.muted}>Other</Text><Text style={[styles.mono]}>{encItems}</Text></View>
          </View>
          <Bar
            value={enc / maxEnc}
            variant="brass"
            fillColorOverride={enc > maxEnc ? colors.empire : colors.brassSoft}
            style={{ marginTop: 10 }}
          />
        </Card>
      </View>

      <Section title="Items" aside={`${c.trappings.length} pieces`} />
      <Card flush>
        <Table>
          <TableRow header>
            <Cell header flex={3}>Item</Cell>
            <Cell header num flex={0.7}>Enc.</Cell>
            <Cell header num flex={0.7}>Qty</Cell>
            <Cell header flex={0.5}> </Cell>
          </TableRow>
          {c.trappings.map((t, i) => (
            <TableRow key={i} last={i === c.trappings.length - 1}>
              <Cell flex={3} textStyle={{ fontFamily: fontFamilies.bodyMedium }}>{t.name}</Cell>
              <Cell num flex={0.7}>{t.enc}</Cell>
              <Cell num flex={0.7} textStyle={{ fontFamily: fontFamilies.mono }}>1</Cell>
              <Cell flex={0.5} align="right">
                <Button variant="ghost" onPress={() => Alert.alert(t.name, 'Item actions: edit · drop · split.')}>···</Button>
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
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 8 },
  label: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  muted: { color: colors.ink3, fontSize: 12, fontFamily: fontFamilies.body },
  mono: { fontFamily: fontFamilies.monoMedium, fontSize: 12, color: colors.ink },
  frac: { fontSize: 14, color: colors.ink3, fontFamily: fontFamilies.displayItalic },
});
