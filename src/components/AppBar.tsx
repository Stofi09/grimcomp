import React from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { colors, fontFamilies, space } from '@/theme';
import { Icon } from './Icon';
import { resolveTest, outcomeLabel } from '@/utils/roll';
import { useConditions } from '@/hooks/useConditions';

interface AppBarProps {
  crumbs: string[];
  showMenu?: boolean;
  onMenuPress?: () => void;
}

export const AppBar: React.FC<AppBarProps> = ({ crumbs, showMenu, onMenuPress }) => {
  // Pull condition modifier for the quick-roll button so the toolbar's d100
  // reflects the same penalties as in-screen tests.
  const { modifier: condMod } = useConditions();
  return (
  <View style={styles.bar}>
    {showMenu ? (
      <Pressable style={styles.menuBtn} onPress={onMenuPress} hitSlop={6}>
        <Icon name="menu" size={18} color={colors.ink2} />
      </Pressable>
    ) : null}
    <View style={styles.crumbs}>
      {crumbs.map((c, i) => {
        const here = i === crumbs.length - 1;
        return (
          <View key={`${c}-${i}`} style={styles.crumbRow}>
            <Text style={[styles.crumb, here && styles.crumbHere]}>{c}</Text>
            {!here ? <Text style={styles.sep}>›</Text> : null}
          </View>
        );
      })}
    </View>
    <View style={{ flex: 1 }} />
    <Pressable
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
      onPress={() => Alert.alert('Search', 'Global search not wired up in this prototype.')}
      hitSlop={4}
    >
      <Icon name="search" size={14} color={colors.ink2} />
      <Text style={styles.actionText}>Search</Text>
    </Pressable>
    <View style={styles.sep2} />
    <Pressable
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
      onPress={() => Alert.alert('Notifications', 'You have no new notifications.')}
      hitSlop={4}
    >
      <Icon name="bell" size={14} color={colors.ink2} />
    </Pressable>
    <Pressable
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
      onPress={() => {
        // No specific target — show the bare d100 plus auto-success/fumble
        // interpretation (01–05 / 96–100).
        const r = resolveTest({ target: 50, modifier: condMod.total, label: 'Quick test' });
        const condLine = condMod.parts.length
          ? '\n\nFrom conditions:\n' + condMod.parts.map(p => `  • ${p.name} ×${p.stacks} → ${p.modifier > 0 ? '+' : ''}${p.modifier}`).join('\n')
          : '';
        Alert.alert(
          `Quick d100 — ${outcomeLabel(r.outcome)}`,
          `Rolled ${r.roll}.\n\nTip: tap the dice next to a skill or weapon to test against a real target.${condLine}`,
        );
      }}
      hitSlop={4}
    >
      <Icon name="dice" size={14} color={colors.ink2} />
      <Text style={styles.actionText}>Roll</Text>
    </Pressable>
  </View>
);
};

const styles = StyleSheet.create({
  bar: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 26,
    gap: space.xxl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: 'rgba(255,245,210,0.18)',
  },
  menuBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -10,
  },
  crumbs: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  crumbRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  crumb: {
    fontSize: 11.5,
    color: colors.ink3,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontFamily: fontFamilies.bodyMedium,
  },
  crumbHere: { color: colors.ink, fontFamily: fontFamilies.bodySemibold },
  sep: { color: colors.ink4, fontSize: 12 },
  sep2: { width: 1, height: 20, backgroundColor: colors.divider },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 3,
  },
  actionPressed: {
    backgroundColor: colors.surface2,
  },
  actionText: {
    fontSize: 12,
    color: colors.ink2,
    fontFamily: fontFamilies.body,
  },
});
