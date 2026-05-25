import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { type Trapping, type Weapon, type Armour } from '@/data/character';
import { useCharacter } from '@/hooks/useCharacter';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useCharacterCollection } from '@/hooks/useCharacterCollection';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Counter } from '@/components/Counter';
import { Bar } from '@/components/Bar';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { EditSheet } from '@/components/EditSheet';
import { TextField, NumberField } from '@/components/Fields';
import { colors, fontFamilies } from '@/theme';
import { tabular, layoutStyles } from '@/components/primitives';

const blankTrapping = (): Trapping => ({ name: '', enc: 0 });

export const TrappingsScreen: React.FC = () => {
  const { template: c } = useCharacter();
  const { list: chars } = useCharacteristics();
  const sb = chars.find(x => x.key === 's')?.bonus ?? 0;
  const tb = chars.find(x => x.key === 't')?.bonus ?? 0;
  const maxEnc = sb + tb;

  // Live collections — weapons + armour share their storage keys with
  // CombatScreen, so they must seed with the *same* full shape. Seeding a
  // trimmed `{ enc }` object here would let whichever screen mounts first
  // cache a shape the other can't read (CombatScreen reads .qual / .locs).
  const trappings = useCharacterCollection<Trapping>('trappings', c.trappings);
  const weapons = useCharacterCollection<Weapon>('weapons', c.weapons);
  const armour = useCharacterCollection<Armour>('armour', c.armour);

  const encItems = trappings.items.reduce((a, x) => a + (x.enc ?? 0), 0);
  const encW = weapons.items.reduce((a, x) => a + (x.enc ?? 0), 0);
  const encA = armour.items.reduce((a, x) => a + (x.enc ?? 0), 0);
  const enc = encItems + encW + encA;

  const [editing, setEditing] = useState<{ index: number | null; draft: Trapping } | null>(null);
  const openNew = () => setEditing({ index: null, draft: blankTrapping() });
  const openEdit = (i: number) => setEditing({ index: i, draft: { ...trappings.items[i] } });

  const save = () => {
    if (!editing) return;
    if (!editing.draft.name.trim()) {
      Alert.alert('Name required', 'Give the item a name.');
      return;
    }
    if (editing.index == null) trappings.add(editing.draft);
    else trappings.update(editing.index, editing.draft);
    setEditing(null);
  };
  const drop = () => {
    if (!editing || editing.index == null) return;
    const name = editing.draft.name;
    trappings.remove(editing.index);
    setEditing(null);
    Alert.alert('Dropped', `${name} removed from inventory.`);
  };

  return (
    <ScreenContainer>
      <Hero
        title="Trappings"
        subRow={<Text style={styles.sub}>Inventory, encumbrance, and coin.</Text>}
        actions={
          <Button
            iconLeft={<Icon name="plus" size={13} color={colors.ink} />}
            onPress={openNew}
          >
            New item
          </Button>
        }
      />

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
            value={maxEnc > 0 ? enc / maxEnc : 0}
            variant="brass"
            fillColorOverride={enc > maxEnc ? colors.empire : colors.brassSoft}
            style={{ marginTop: 10 }}
          />
        </Card>
      </View>

      <Section title="Items" aside={`${trappings.items.length} pieces`} />
      <Card flush>
        <Table>
          <TableRow header>
            <Cell header flex={3}>Item</Cell>
            <Cell header num flex={0.7}>Enc.</Cell>
            <Cell header flex={0.7}> </Cell>
          </TableRow>
          {trappings.items.map((t, i) => (
            <TableRow key={`${t.name}-${i}`} last={i === trappings.items.length - 1} onPress={() => openEdit(i)}>
              <Cell flex={3} textStyle={{ fontFamily: fontFamilies.bodyMedium }}>{t.name}</Cell>
              <Cell num flex={0.7}>{t.enc}</Cell>
              <Cell flex={0.7} align="right">
                <Pressable onPress={() => openEdit(i)} hitSlop={8}>
                  <Icon name="chev" size={14} color={colors.ink3} />
                </Pressable>
              </Cell>
            </TableRow>
          ))}
          {trappings.items.length === 0 ? (
            <TableRow last>
              <Cell flex={1} textStyle={{ color: colors.ink3, fontStyle: 'italic' }}>
                No items. Tap "New item" to add one.
              </Cell>
            </TableRow>
          ) : null}
        </Table>
      </Card>

      <EditSheet
        visible={!!editing}
        title={editing?.index == null ? 'New item' : 'Edit item'}
        subtitle={editing?.index == null ? 'Add a trapping to this character\'s pack.' : 'Tap Save to commit, or Drop to remove from inventory.'}
        onClose={() => setEditing(null)}
        onSave={save}
        destructive={editing?.index != null ? { label: 'Drop', onPress: drop } : undefined}
      >
        {editing ? (
          <>
            <TextField
              label="Name"
              value={editing.draft.name}
              onChangeText={t => setEditing(s => s && ({ ...s, draft: { ...s.draft, name: t } }))}
              placeholder="e.g. Lantern oil flask"
            />
            <NumberField
              label="Encumbrance"
              value={editing.draft.enc}
              onChangeNumber={n => setEditing(s => s && ({ ...s, draft: { ...s.draft, enc: n } }))}
              min={0}
              max={20}
              hint="0 for small items, 1 for typical gear, 2+ for bulky."
            />
          </>
        ) : null}
      </EditSheet>
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
