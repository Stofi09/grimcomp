// Visible error state for a build whose bundled catalogue failed validation.
// The affected files are left out of the registry instead of crashing launch;
// this banner makes the missing rulebook data obvious rather than silent.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useContentStatus } from '../content/useContent';
import { colors, fontFamilies } from '../theme';

export const ContentIssueBanner: React.FC = () => {
  const { catalogueIssues } = useContentStatus();
  if (catalogueIssues.length === 0) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.title}>Some bundled rulebook data could not be loaded</Text>
      <Text style={styles.body}>
        {'These files failed this build\'s content checks, so their entries are missing. Saved characters are not affected.'}
      </Text>
      {catalogueIssues.map(issue => (
        <Text key={issue.source} style={styles.detail} numberOfLines={2}>
          {`${issue.source}: ${issue.message}`}
        </Text>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.warnTint,
    borderBottomWidth: 1,
    borderBottomColor: colors.warnTintBorder,
  },
  title: { fontFamily: fontFamilies.bodySemibold, fontSize: 13, color: colors.warning },
  body: { fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 17, color: colors.ink2 },
  detail: { fontFamily: fontFamilies.mono, fontSize: 11, lineHeight: 15, color: colors.ink3 },
});
