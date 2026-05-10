import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fontFamilies, space } from '@/theme';
import { Icon } from './Icon';

interface AppBarProps {
  crumbs: string[];
  showMenu?: boolean;
  onMenuPress?: () => void;
}

export const AppBar: React.FC<AppBarProps> = ({ crumbs, showMenu, onMenuPress }) => (
  <View style={styles.bar}>
    {showMenu ? (
      <Pressable style={styles.menuBtn} onPress={onMenuPress}>
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
    <Pressable style={styles.action}>
      <Icon name="search" size={14} color={colors.ink2} />
      <Text style={styles.actionText}>Search</Text>
    </Pressable>
    <View style={styles.sep2} />
    <Pressable style={styles.action}>
      <Icon name="bell" size={14} color={colors.ink2} />
    </Pressable>
    <Pressable style={styles.action}>
      <Icon name="dice" size={14} color={colors.ink2} />
      <Text style={styles.actionText}>Roll</Text>
    </Pressable>
  </View>
);

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
  actionText: {
    fontSize: 12,
    color: colors.ink2,
    fontFamily: fontFamilies.body,
  },
});
