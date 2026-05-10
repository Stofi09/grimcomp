import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { CHARACTER } from '@/data/character';
import { Hero } from '@/components/Hero';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { HitLocationFigure } from '@/components/HitLocationFigure';
import { colors, fontFamilies } from '@/theme';
import { layoutStyles } from '@/components/primitives';

const rollD100 = () => Math.floor(Math.random() * 100) + 1;

export const CombatScreen: React.FC = () => {
  const c = CHARACTER;
  const totalAP = c.ap.head + c.ap.body + c.ap.arm_l + c.ap.arm_r + c.ap.leg_l + c.ap.leg_r;
  return (
    <ScreenContainer>
      <Hero
        title="Combat"
        subRow={<Text style={styles.sub}>Weapons, armour, and hit locations.</Text>}
      />

      <View style={styles.row}>
        <Card flush style={styles.figureCard}>
          <CardHead title="Hit Locations" />
          <View style={styles.figureBox}>
            <HitLocationFigure ap={c.ap} />
          </View>
          <View style={styles.figureFoot}>
            <View style={layoutStyles.rowBetween}>
              <Text style={styles.metaMono}>TOTAL AP</Text>
              <Text style={styles.totalMono}>{totalAP}</Text>
            </View>
          </View>
        </Card>

        <View style={{ flex: 1, gap: 16, minWidth: 360 }}>
          <Card flush>
            <CardHead
              title="Weapons"
              right={
                <Button
                  variant="ghost"
                  iconLeft={<Icon name="plus" size={12} color={colors.ink2} />}
                  onPress={() => Alert.alert('New weapon', 'Adding new weapons is not wired up.')}
                >
                  New
                </Button>
              }
            />
            <Table>
              <TableRow header>
                <Cell header flex={2}>Weapon</Cell>
                <Cell header flex={1.1}>Group</Cell>
                <Cell header num flex={0.6}>Enc.</Cell>
                <Cell header flex={1}>Reach/Range</Cell>
                <Cell header flex={0.9}>Damage</Cell>
                <Cell header flex={1.4}>Qualities</Cell>
                <Cell header flex={0.5}> </Cell>
              </TableRow>
              {c.weapons.map((w, i) => (
                <TableRow key={i} last={i === c.weapons.length - 1}>
                  <Cell flex={2} textStyle={{ fontFamily: fontFamilies.bodySemibold }}>{w.name}</Cell>
                  <Cell flex={1.1} textStyle={{ color: colors.ink3 }}>{w.group}</Cell>
                  <Cell num flex={0.6}>{w.enc}</Cell>
                  <Cell flex={1} textStyle={{ fontFamily: fontFamilies.mono }}>{w.reach || w.range || '—'}</Cell>
                  <Cell flex={0.9} textStyle={{ fontFamily: fontFamilies.mono }}>{w.dmg}</Cell>
                  <Cell flex={1.4}>
                    <View style={styles.qualRow}>
                      {w.qual.map(q => <Pill key={q} size={10}>{q}</Pill>)}
                    </View>
                  </Cell>
                  <Cell flex={0.5} align="right">
                    <Button
                      variant="ghost"
                      iconLeft={<Icon name="dice" size={13} color={colors.ink2} />}
                      onPress={() => Alert.alert(`Attack: ${w.name}`, `d100 → ${rollD100()}\nDamage: ${w.dmg}`)}
                    >{''}</Button>
                  </Cell>
                </TableRow>
              ))}
            </Table>
          </Card>

          <Card flush>
            <CardHead
              title="Armour"
              right={
                <Button
                  variant="ghost"
                  iconLeft={<Icon name="plus" size={12} color={colors.ink2} />}
                  onPress={() => Alert.alert('New armour', 'Adding new armour is not wired up.')}
                >
                  New
                </Button>
              }
            />
            <Table>
              <TableRow header>
                <Cell header flex={2}>Piece</Cell>
                <Cell header flex={1.6}>Locations</Cell>
                <Cell header num flex={0.6}>Enc.</Cell>
                <Cell header num flex={0.6}>AP</Cell>
                <Cell header flex={1.4}>Qualities</Cell>
              </TableRow>
              {c.armour.map((a, i) => (
                <TableRow key={i} last={i === c.armour.length - 1}>
                  <Cell flex={2} textStyle={{ fontFamily: fontFamilies.bodySemibold }}>{a.name}</Cell>
                  <Cell flex={1.6} textStyle={{ color: colors.ink3 }}>{a.locs.join(', ')}</Cell>
                  <Cell num flex={0.6}>{a.enc}</Cell>
                  <Cell num flex={0.6} textStyle={{ color: colors.brass, fontFamily: fontFamilies.monoMedium }}>{a.ap}</Cell>
                  <Cell flex={1.4}>
                    <View style={styles.qualRow}>
                      {a.qual.map(q => <Pill key={q} size={10}>{q}</Pill>)}
                    </View>
                  </Cell>
                </TableRow>
              ))}
            </Table>
          </Card>
        </View>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  row: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginTop: 8 },
  figureCard: { width: 320, flexShrink: 0 },
  figureBox: { padding: 20, alignItems: 'center', justifyContent: 'center' },
  figureFoot: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  metaMono: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    color: colors.ink3,
    letterSpacing: 0.6,
  },
  totalMono: {
    fontFamily: fontFamilies.monoMedium,
    fontSize: 13,
    color: colors.ink,
  },
  qualRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
});
