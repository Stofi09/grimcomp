import { Platform } from 'react-native';

// Loaded by expo-font in App.tsx
export const fontFamilies = {
  display: 'IMFellEnglish_400Regular',
  displayItalic: 'IMFellEnglish_400Italic',
  body: Platform.select({ ios: 'Inter_400Regular', default: 'Inter_400Regular' })!,
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
} as const;

// Fallback when fonts aren't loaded (or running web).
export const systemFallback = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'system-ui',
})!;

export const tracking = {
  // letter-spacing translations (RN uses absolute px, css uses em)
  small: 0.6,
  caps: 1.6,
  capsTight: 1.0,
  capsWide: 2.4,
} as const;
