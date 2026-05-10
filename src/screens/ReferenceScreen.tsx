import React from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors, fontFamilies } from '@/theme';
import { layoutStyles } from '@/components/primitives';

interface CategoryDef { icon: IconName; title: string; count: number; sub?: string; }

const CATS: CategoryDef[] = [
  { icon: 'crown', title: 'Careers', count: 64, sub: 'all 4 ranks' },
  { icon: 'scroll', title: 'Skills', count: 46, sub: 'basic + advanced' },
  { icon: 'star', title: 'Talents', count: 131 },
  { icon: 'sparkle', title: 'Spells', count: 89, sub: '8 traditions' },
  { icon: 'flame', title: 'Prayers', count: 41, sub: '8 deities' },
  { icon: 'heart', title: 'Conditions', count: 12 },
  { icon: 'sword', title: 'Critical Wounds', count: 72, sub: '6 locations' },
  { icon: 'mask', title: 'Chaos & Mutation', count: 28 },
];

const RECENT: Array<[string, string, string]> = [
  ['Fear & Terror', 'Condition', 'Core 190'],
  ['Bow (group)', 'Weapon', 'Core 295'],
  ['Apothecary', 'Career', 'Core 62'],
  ['Minor Miscast', 'Table', 'Core 238'],
];

export const ReferenceScreen: React.FC = () => (
  <ScreenContainer>
    <Hero
      title="Reference"
      subRow={<Text style={styles.sub}>WFRP 4e core book · version 2026.04.01 · offline</Text>}
      actions={
        <Button
          iconLeft={<Icon name="search" size={13} color={colors.ink} />}
          onPress={() => Alert.alert('Search', 'Reference search not wired up.')}
        >
          Search rules
        </Button>
      }
    />

    <Section title="Categories" />
    <View style={styles.grid}>
      {CATS.map(c => (
        <Pressable
          key={c.title}
          style={styles.cellWrap}
          onPress={() => Alert.alert(c.title, `${c.count} ${c.title.toLowerCase()} in this category.`)}
        >
          <Card tight style={{ flex: 1 }}>
            <View style={layoutStyles.rowBetween}>
              <Icon name={c.icon} size={18} color={colors.ink2} />
              <Text style={styles.count}>{c.count}</Text>
            </View>
            <Text style={styles.cTitle}>{c.title}</Text>
            {c.sub ? <Text style={styles.cSub}>{c.sub}</Text> : null}
          </Card>
        </Pressable>
      ))}
    </View>

    <Section title="Recently viewed" />
    <Card flush>
      <Table>
        <TableRow header>
          <Cell header flex={2}>Name</Cell>
          <Cell header flex={1.2}>Category</Cell>
          <Cell header flex={1.4}>Source</Cell>
          <Cell header flex={0.4}> </Cell>
        </TableRow>
        {RECENT.map((r, i) => (
          <TableRow
            key={i}
            last={i === RECENT.length - 1}
            onPress={() => Alert.alert(r[0], `${r[1]} — ${r[2]}`)}
          >
            <Cell flex={2} textStyle={{ fontFamily: fontFamilies.bodySemibold }}>{r[0]}</Cell>
            <Cell flex={1.2} textStyle={{ color: colors.ink3 }}>{r[1]}</Cell>
            <Cell flex={1.4} textStyle={{ fontFamily: fontFamilies.mono, fontSize: 11, color: colors.ink3 }}>{r[2]}</Cell>
            <Cell flex={0.4} align="right">
              <Icon name="chev" size={12} color={colors.ink3} />
            </Cell>
          </TableRow>
        ))}
      </Table>
    </Card>
  </ScreenContainer>
);

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cellWrap: { flexBasis: '23%', flexGrow: 1, minWidth: 160 },
  count: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    color: colors.ink3,
  },
  cTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 17,
    color: colors.ink,
    marginTop: 10,
  },
  cSub: {
    fontSize: 11,
    color: colors.ink3,
    marginTop: 2,
    fontFamily: fontFamilies.body,
  },
});
