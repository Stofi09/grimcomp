import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { Hero } from '@/components/Hero';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { colors, fontFamilies } from '@/theme';

const ROWS: Array<[string, string, string]> = [
  ['Language', 'English', 'Hungarian translation available'],
  ['Theme', 'Parchment (light)', 'Dark theme coming soon'],
  ['Rulebook version', '2026.04.01', 'auto-update'],
  ['XP rule', 'Flexible (warn, allow)', 'RAW vs. house rules'],
  ['Export', 'JSON + PDF', 'character sheet copy'],
  ['Data sync', 'local only (SQLite)', 'cloud sync optional'],
];

export const SettingsScreen: React.FC = () => (
  <ScreenContainer>
    <Hero
      title="Settings"
      subRow={<Text style={styles.sub}>All data is stored on this device. Rulebook data is available offline.</Text>}
    />

    <Card flush style={{ marginTop: 20 }}>
      {ROWS.map((r, i) => (
        <View
          key={r[0]}
          style={[
            styles.row,
            i !== ROWS.length - 1 ? styles.rowBorder : null,
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{r[0]}</Text>
            <Text style={styles.body}>{r[2]}</Text>
          </View>
          <Text style={styles.value}>{r[1]}</Text>
          <Button variant="ghost" onPress={() => Alert.alert(r[0], `Currently: ${r[1]}\n\n${r[2]}`)}>
            Change
          </Button>
        </View>
      ))}
    </Card>
  </ScreenContainer>
);

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  title: {
    fontFamily: fontFamilies.bodySemibold,
    fontSize: 13,
    color: colors.ink,
  },
  body: {
    fontSize: 11,
    color: colors.ink3,
    marginTop: 2,
    fontFamily: fontFamilies.body,
  },
  value: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    color: colors.ink2,
  },
});
