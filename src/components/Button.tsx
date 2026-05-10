import React from 'react';
import { Pressable, Text, View, StyleSheet, ViewStyle, TextStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fontFamilies, shadows } from '@/theme';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'brass';

interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  large?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

interface VariantStyle {
  bg: string;
  border: string;
  text: string;
  /** vertical gradient stops, top to bottom */
  gradient?: [string, string];
}

const VARIANT_STYLES: Record<ButtonVariant, VariantStyle> = {
  default: { bg: colors.ivory, border: colors.borderStrong, text: colors.ink, gradient: [colors.ivory, colors.surface2] },
  primary: { bg: colors.empireBright, border: colors.empireDeep, text: colors.ivory, gradient: [colors.empireBright, colors.empireDeep] },
  ghost: { bg: 'transparent', border: 'transparent', text: colors.ink2 },
  brass: { bg: colors.brassSoft, border: colors.brass, text: '#2a2010', gradient: [colors.brassSoft, colors.brass] },
};

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'default',
  iconLeft,
  iconRight,
  large,
  disabled,
  onPress,
  style,
  textStyle,
}) => {
  const v = VARIANT_STYLES[variant];
  const showGradient = !!v.gradient && !disabled;
  const disabledStyle = disabled
    ? { backgroundColor: '#c8b89d', borderColor: '#8c7c64', opacity: 0.85 }
    : null;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: showGradient ? 'transparent' : v.bg, borderColor: v.border },
        large && styles.large,
        variant !== 'ghost' && shadows.paper,
        pressed && !disabled ? { opacity: 0.7, transform: [{ scale: 0.98 }] } : null,
        disabledStyle,
        style,
      ]}
    >
      {showGradient ? (
        <LinearGradient
          colors={v.gradient!}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: 3 }]}
        />
      ) : null}
      {iconLeft ? <View>{iconLeft}</View> : null}
      <Text
        style={[
          styles.text,
          { color: v.text, fontSize: large ? 13 : 12 },
          disabled ? { color: 'rgba(255,245,210,0.7)' } : null,
          textStyle,
        ]}
      >
        {children}
      </Text>
      {iconRight ? <View>{iconRight}</View> : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 3,
    borderWidth: 1,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  large: { paddingHorizontal: 18, paddingVertical: 10 },
  text: {
    fontFamily: fontFamilies.bodySemibold,
    letterSpacing: 0.2,
  },
});
