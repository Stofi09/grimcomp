import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { ROSTER } from '@/data/character';
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

export const RosterScreen: React.FC<Props> = ({ onNav }) => (
  <ScreenContainer>
    <Hero
      title="Characters"
      subRow={<Text style={styles.sub}>{ROSTER.length} characters · The Eberfeld Road Wardens</Text>}
      actions={
        <Button variant="primary" iconLeft={<Icon name="plus" size={13} color={colors.ivory} />} onPress={() => onNav('newchar')}>
          New character
        </Button>
      }
    />

    <Section title="Active party" />

    <View style={styles.grid}>
      {ROSTER.map(c => (
        <Pressable key={c.id} style={styles.cellWrap} onPress={() => onNav('overview')}>
          <Card
            style={[
              { flex: 1 },
              c.active ? { borderColor: colors.brass, shadowOpacity: 0.18 } : null,
            ]}
          >
            <View style={[layoutStyles.row, { alignItems: 'flex-start', gap: 14 }]}>
              <Avatar initials={c.initials} accent={c.accent} size={56} fontSize={22} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={layoutStyles.rowBetween}>
                  <Text style={styles.name}>{c.name}</Text>
                  {c.active ? <Pill variant="brass" size={10}>ACTIVE</Pill> : null}
                </View>
                <Text style={styles.meta}>{c.species} · {c.career} · rank {c.level} · {c.status}</Text>
                <View style={[layoutStyles.row, { gap: 18, marginTop: 12 }]}>
                  <View>
                    <Text style={styles.metaMono}>WOUNDS</Text>
                    <Text style={styles.bigVal}>{c.wounds}</Text>
                  </View>
                  <View>
                    <Text style={styles.metaMono}>SPENDABLE XP</Text>
                    <Text style={[styles.bigVal, { color: colors.brass }]}>{c.xp}</Text>
                  </View>
                  <View style={{ marginLeft: 'auto', alignSelf: 'center' }}>
                    <Icon name="chev" size={16} color={colors.ink3} />
                  </View>
                </View>
              </View>
            </View>
          </Card>
        </Pressable>
      ))}

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
