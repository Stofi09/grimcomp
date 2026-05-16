import React from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { useCharacter } from '@/hooks/useCharacter';
import { useRoster } from '@/hooks/useRoster';
import type { ScreenId } from '@/data/nav';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { colors, fontFamilies } from '@/theme';
import { layoutStyles } from '@/components/primitives';

interface Props { onNav: (id: ScreenId) => void; }

export const RosterScreen: React.FC<Props> = ({ onNav }) => {
  const { id: activeId, setActive } = useCharacter();
  const { list, remove, custom } = useRoster();
  const switchTo = (id: string) => {
    setActive(id);
    onNav('overview');
  };
  return (
  <ScreenContainer>
    <Hero
      title="Characters"
      subRow={<Text style={styles.sub}>{list.length} characters · The Eberfeld Road Wardens</Text>}
      actions={
        <Button variant="primary" iconLeft={<Icon name="plus" size={13} color={colors.ivory} />} onPress={() => onNav('newchar')}>
          New character
        </Button>
      }
    />

    <Section title="Active party" />

    <View style={styles.grid}>
      {list.map(c => {
        const isActive = c.id === activeId;
        const isCustom = c.id in custom;
        const onLong = isCustom
          ? () => Alert.alert(
              'Delete character',
              `Permanently delete ${c.name}? This wipes their XP, wounds, conditions and inventory.`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => {
                  remove(c.id);
                  if (isActive) setActive('c1');
                }},
              ],
            )
          : undefined;
        return (
        <Pressable
          key={c.id}
          style={styles.cellWrap}
          onPress={() => switchTo(c.id)}
          onLongPress={onLong}
          delayLongPress={500}
        >
          <Card
            style={[
              { flex: 1 },
              isActive ? { borderColor: colors.brass, shadowOpacity: 0.18 } : null,
            ]}
          >
            <View style={[layoutStyles.row, { alignItems: 'flex-start', gap: 14 }]}>
              <Avatar initials={c.initials} accent={c.accent} size={56} fontSize={22} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={layoutStyles.rowBetween}>
                  <Text style={styles.name}>{c.name}</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {isCustom ? <Pill variant="ghost" size={10}>CUSTOM</Pill> : null}
                    {isActive ? <Pill variant="brass" size={10}>ACTIVE</Pill> : null}
                  </View>
                </View>
                <Text style={styles.meta}>{c.species} · {c.career} · rank {c.careerLevel} · {c.status}</Text>
                <View style={[layoutStyles.row, { gap: 18, marginTop: 12 }]}>
                  <View>
                    <Text style={styles.metaMono}>WOUNDS</Text>
                    <Text style={styles.bigVal}>{c.wounds.current}/{c.wounds.max}</Text>
                  </View>
                  <View>
                    <Text style={styles.metaMono}>SPENDABLE XP</Text>
                    <Text style={[styles.bigVal, { color: colors.brass }]}>{c.xpCurrent}</Text>
                  </View>
                  <View style={{ marginLeft: 'auto', alignSelf: 'center' }}>
                    <Icon name="chev" size={16} color={colors.ink3} />
                  </View>
                </View>
              </View>
            </View>
          </Card>
        </Pressable>
        );
      })}

      <Pressable style={styles.cellWrap} onPress={() => onNav('newchar')}>
        <Card dashed style={[styles.empty]}>
          <Icon name="plus" size={22} color={colors.ink3} />
          <Text style={styles.emptyTitle}>New character</Text>
          <Text style={styles.emptySub}>blank, from template, or imported</Text>
        </Card>
      </Pressable>
    </View>
  </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cellWrap: { flexBasis: '48%', flexGrow: 1, minWidth: 320 },
  name: {
    fontFamily: fontFamilies.display,
    fontSize: 22,
    color: colors.ink,
  },
  meta: {
    fontSize: 12,
    color: colors.ink3,
    marginTop: 2,
    fontFamily: fontFamilies.body,
  },
  metaMono: {
    fontFamily: fontFamilies.mono,
    fontSize: 10,
    color: colors.ink3,
    letterSpacing: 0.6,
  },
  bigVal: {
    fontFamily: fontFamilies.display,
    fontSize: 17,
    color: colors.ink,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 180,
    flex: 1,
  },
  emptyTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 18,
    color: colors.ink,
    marginTop: 6,
  },
  emptySub: {
    color: colors.ink3,
    fontSize: 12,
    fontFamily: fontFamilies.body,
  },
});
