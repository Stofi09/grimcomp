import React from 'react';
import { Text, StyleSheet, Alert } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { Hero } from '@/components/Hero';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { colors, fontFamilies } from '@/theme';

export const MagicScreen: React.FC = () => (
  <ScreenContainer>
    <Hero
      title="Magic"
      subRow={<Text style={styles.sub}>Sigmund is not a spellcaster — this screen is for reference only.</Text>}
    />

    <Card style={styles.empty}>
      <Icon name="sparkle" size={28} color={colors.ink3} />
      <Text style={styles.title}>No spells</Text>
      <Text style={styles.body}>
        The Magic page activates when the character has spellcasting (e.g. Apprentice Wizard or Wizard career).
        Use the Reference page to browse magic rules.
      </Text>
      <Button
        style={{ marginTop: 14 }}
        onPress={() => Alert.alert('Rulebook', 'Reference rules would open here.')}
      >
        Open rulebook
      </Button>
    </Card>
  </ScreenContainer>
);

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamilies.body },
  empty: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 48,
    marginTop: 24,
  },
  title: {
    fontFamily: fontFamilies.display,
    fontSize: 20,
    color: colors.ink,
    marginTop: 10,
  },
  body: {
    color: colors.ink3,
    fontSize: 13,
    marginTop: 6,
    maxWidth: 420,
    textAlign: 'center',
    lineHeight: 19,
    fontFamily: fontFamilies.body,
  },
});
