import React from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { useTalents } from '@/hooks/useTalents';
import { useXp } from '@/hooks/useXp';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { colors, fontFamilies } from '@/theme';
import { layoutStyles } from '@/components/primitives';

// "Buy another rank" cost: 100 × the new rank number. WFRP 4e core p.49.
const talentCost = (currentTimes: number) => 100 * (currentTimes + 1);

export const TalentsScreen: React.FC = () => {
  const { list, buyAnother } = useTalents();
  const xp = useXp();

  const buy = (name: string, currentTimes: number) => {
    const cost = talentCost(currentTimes);
    const reason = `${name} ×${currentTimes + 1}`;
    const r = xp.spend(cost, reason, 'talent');
    if (!r.ok) {
      Alert.alert('Not enough XP', r.message);
      return;
    }
    buyAnother(name);
    Alert.alert('Bought talent', r.message);
  };

  return (
    <ScreenContainer>
      <Hero
        eyebrow="Sheet 4 — Talents"
        title="Talents"
        subRow={
          <>
            <Text style={styles.sub}>{list.length} acquired</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>passive effects and unlocks</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.sub}>{xp.current} XP available</Text>
          </>
        }
      />

      <Section title="Active talents" />

      <View style={styles.grid}>
        {list.map((t, i) => {
          const cost = talentCost(t.times);
          return (
            <Card key={i} style={styles.cell}>
              <View style={[layoutStyles.row, { alignItems: 'flex-start', justifyContent: 'space-between' }]}>
                <View style={{ flex: 1 }}>
                  <View style={styles.titleRow}>
                    <Text style={styles.tName}>{t.name}</Text>
                    {t.career ? <Pill variant="empire" size={9.5}>career</Pill> : null}
                  </View>
                  <Text style={styles.desc}>{t.desc}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', marginLeft: 14 }}>
                  <Text style={styles.miniLabel}>TIMES</Text>
                  <Text style={styles.times}>×{t.times}</Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={layoutStyles.rowBetween}>
                <Text style={styles.next}>NEXT {cost} XP</Text>
                <Button variant="ghost" onPress={() => buy(t.name, t.times)}>
                  Buy another
                </Button>
              </View>
            </Card>
          );
        })}

        <Pressable
          style={({ pressed }) => [styles.cell, pressed && { opacity: 0.7 }]}
          onPress={() => Alert.alert('New talent', '5 talents available in your career path. Picker not wired up.')}
          hitSlop={4}
        >
          <Card dashed style={[{ flex: 1 }, styles.empty]}>
            <Icon name="plus" size={20} color={colors.ink3} />
            <Text style={styles.emptyTitle}>New talent</Text>
            <Text style={styles.emptySub}>5 available in career</Text>
          </Card>
        </Pressable>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink2, fontFamily: fontFamilies.body },
  sep: { color: colors.ink4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { flexBasis: '48%', flexGrow: 1, minWidth: 280 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tName: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 18,
    color: colors.ink,
  },
  desc: {
    color: colors.ink3,
    fontSize: 12,
    marginTop: 6,
    lineHeight: 18,
    fontFamily: fontFamilies.body,
  },
  miniLabel: {
    fontFamily: fontFamilies.mono,
    fontSize: 9,
    letterSpacing: 1,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  times: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 24,
    color: colors.brass,
  },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 14 },
  next: {
    fontFamily: fontFamilies.mono,
    fontSize: 10,
    color: colors.ink3,
    letterSpacing: 0.6,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 160,
  },
  emptyTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 16,
    color: colors.ink,
    marginTop: 6,
  },
  emptySub: {
    fontFamily: fontFamilies.mono,
    fontSize: 10.5,
    color: colors.ink3,
    marginTop: 2,
  },
});
