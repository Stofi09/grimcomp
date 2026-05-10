import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fontFamilies } from '@/theme';

interface AvatarProps {
  initials: string;
  size?: number;
  fontSize?: number;
  /** Solo accent for non-gradient mode, or "from" colour for gradient mode. */
  accent?: string;
  /** Second colour for the diagonal gradient (defaults to a dark empire red). */
  accentDeep?: string;
  style?: StyleProp<ViewStyle>;
}

export const Avatar: React.FC<AvatarProps> = ({
  initials,
  size = 40,
  fontSize,
  accent = colors.empireBright,
  accentDeep = '#5a1f1f',
  style,
}) => (
  <View
    style={[
      styles.box,
      {
        width: size,
        height: size,
        borderRadius: size / 2,
      },
      style,
    ]}
  >
    <LinearGradient
      colors={[accent, accentDeep]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[StyleSheet.absoluteFillObject, { borderRadius: size / 2 }]}
    />
    <Text style={[styles.text, { fontSize: fontSize ?? Math.round(size * 0.4) }]}>
      {initials}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.brass,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  text: {
    fontFamily: fontFamilies.display,
    color: colors.bone,
  },
});
