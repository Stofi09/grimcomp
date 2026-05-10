import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fontFamilies, RAIL_WIDTH, space } from '@/theme';
import { CHARACTER } from '@/data/character';
import { NAV, type ScreenId } from '@/data/nav';
import { useXp } from '@/hooks/useXp';
import { useCareer } from '@/hooks/useCareer';
import { useStoredState } from '@/hooks/useStoredState';
import { Icon } from './Icon';
import { Avatar } from './Avatar';
import { tabular } from './primitives';

interface RailProps {
  current: ScreenId;
  onNav: (id: ScreenId) => void;
  onClose?: () => void;
  width?: number;
}

export const Rail: React.FC<RailProps> = ({ current, onNav, onClose, width = RAIL_WIDTH }) => {
  const c = CHARACTER;
  const xp = useXp();
  const career = useCareer();
  const [wounds] = useStoredState('gc.wounds', c.wounds.current);
  return (
    <View style={[styles.rail, { width }]}>
      {/* parchment-tan vertical gradient — matches styles.css .rail */}
      <LinearGradient
        pointerEvents="none"
        colors={['#d9c8a4', '#c9b78a', '#b9a472']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      {/* embossed seam — inset shadow on the right edge */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(40,28,10,0)', 'rgba(40,28,10,0.25)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.seam}
      />
      {/* hanging ribbon marker */}
      <LinearGradient
        pointerEvents="none"
        colors={[colors.empireBright, colors.empireDeep]}
        locations={[0, 0.8]}
        style={styles.ribbon}
      />

      <ScrollView
        style={styles.inner}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brand}>
          <View style={styles.mark}>
            <Text style={styles.markText}>G</Text>
          </View>
          <View>
            <Text style={styles.wordmark}>Grim Companion</Text>
            <Text style={styles.ver}>v2 · Reikland</Text>
          </View>
        </View>

        <Pressable style={styles.charCard} onPress={() => onNav('roster')}>
          <View style={styles.charTop}>
            <Avatar initials="SB" size={40} fontSize={16} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{career.name} · rank {career.level}</Text>
            </View>
            <Icon name="chev" size={13} color={colors.ink4} />
          </View>
          <View style={styles.vitals}>
            <Vital label="Wnd" value={`${wounds}`} sub={`/${c.wounds.max}`} accent={colors.empire} />
            <Vital label="Fate" value={`${c.fate}`} sub={`·${c.fortune}`} accent={colors.brass} />
            <Vital label="XP" value={`${xp.current}`} accent={colors.brass} last />
          </View>
        </Pressable>

        {NAV.map(group => (
          <View key={group.section}>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{group.section}</Text>
              <View style={styles.sectionRule} />
            </View>
            {group.items.map(it => {
              const active = current === it.id;
              return (
                <Pressable
                  key={it.id}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.item,
                    active && styles.itemActive,
                    pressed && !active && styles.itemPressed,
                  ]}
                  onPress={() => { onNav(it.id); onClose?.(); }}
                >
                  <View style={styles.itemIcon}>
                    <Icon
                      name={it.icon}
                      size={15}
                      color={active ? colors.gold : colors.ink3}
                    />
                  </View>
                  <Text style={[styles.itemText, active && styles.itemTextActive]} numberOfLines={1}>
                    {it.label}
                  </Text>
                  {it.badge ? (
                    <View style={[styles.badge, active && styles.badgeActive]}>
                      <Text style={[styles.badgeText, active && styles.badgeTextActive]}>
                        {it.badge}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

interface VitalProps {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  last?: boolean;
}

const Vital: React.FC<VitalProps> = ({ label, value, sub, accent, last }) => (
  <View style={[vitalStyles.box, !last && vitalStyles.divider]}>
    <Text style={vitalStyles.label}>{label}</Text>
    <Text style={[vitalStyles.value, accent ? { color: accent } : null, tabular]}>
      {value}
      {sub ? <Text style={vitalStyles.sub}>{sub}</Text> : null}
    </Text>
  </View>
);

const vitalStyles = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  divider: { borderRightWidth: 1, borderRightColor: colors.divider },
  label: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 8.5,
    letterSpacing: 1,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  value: {
    fontFamily: fontFamilies.display,
    fontSize: 17,
    color: colors.ink,
    marginTop: 2,
  },
  sub: { fontSize: 11, color: colors.ink3 },
});

const styles = StyleSheet.create({
  rail: {
    borderRightWidth: 1,
    borderRightColor: '#6a5836',
    height: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  seam: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 8,
  },
  ribbon: {
    position: 'absolute',
    top: 0,
    right: 24,
    width: 14,
    height: 70,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 18,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(60,40,15,0.18)',
    marginBottom: 12,
  },
  mark: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderColor: colors.brass,
    backgroundColor: colors.ivory,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 22,
    color: colors.brass,
    lineHeight: 24,
  },
  wordmark: {
    fontFamily: fontFamilies.display,
    fontSize: 19,
    color: colors.ink,
    lineHeight: 19,
  },
  ver: {
    fontFamily: fontFamilies.mono,
    fontSize: 9,
    color: 'rgba(60,40,15,0.55)',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginTop: 3,
  },
  charCard: {
    marginVertical: 4,
    marginBottom: 14,
    backgroundColor: colors.ivory,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 6,
    overflow: 'hidden',
  },
  charTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.empireBright,
    borderWidth: 2,
    borderColor: colors.brass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fontFamilies.display,
    fontSize: 16,
    color: colors.bone,
  },
  name: {
    fontFamily: fontFamilies.display,
    fontSize: 15,
    color: colors.ink,
  },
  sub: {
    fontSize: 10.5,
    color: colors.ink3,
    marginTop: 2,
    fontFamily: fontFamilies.body,
  },
  vitals: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionLabel: {
    fontFamily: fontFamilies.bodySemibold,
    fontSize: 9.5,
    letterSpacing: 1.7,
    color: 'rgba(60,40,15,0.55)',
    textTransform: 'uppercase',
  },
  sectionRule: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(60,40,15,0.18)',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 3,
  },
  itemActive: {
    backgroundColor: colors.ink,
  },
  itemPressed: {
    backgroundColor: 'rgba(0,0,0,0.10)',
  },
  itemIcon: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
    fontSize: 13,
    color: colors.ink2,
    fontFamily: fontFamilies.body,
    flex: 1,
  },
  itemTextActive: {
    color: colors.bone,
    fontFamily: fontFamilies.bodyMedium,
  },
  badge: {
    fontFamily: fontFamilies.mono,
    backgroundColor: colors.inkSoft06,
    borderWidth: 1,
    borderColor: 'rgba(60,40,15,0.10)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },
  badgeActive: {
    backgroundColor: colors.brass,
    borderColor: colors.brass,
  },
  badgeText: {
    fontFamily: fontFamilies.monoMedium,
    fontSize: 9.5,
    color: colors.ink3,
  },
  badgeTextActive: {
    color: colors.bone,
  },
});
