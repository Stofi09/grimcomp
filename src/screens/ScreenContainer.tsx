import React from 'react';
import { ScrollView, View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { space } from '@/theme';

interface ScreenContainerProps {
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}

// Mirrors the .content + .screen wrapper from styles.css.
export const ScreenContainer: React.FC<ScreenContainerProps> = ({ children, contentStyle }) => (
  <ScrollView
    style={styles.scroll}
    contentContainerStyle={[styles.content, contentStyle]}
    showsVerticalScrollIndicator
  >
    <View style={styles.screen}>{children}</View>
  </ScrollView>
);

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingTop: space.s5,
    paddingHorizontal: 36,
    paddingBottom: 56,
  },
  screen: {
    maxWidth: 1080,
    width: '100%',
    alignSelf: 'center',
  },
});
