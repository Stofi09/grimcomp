export { colors } from './colors';
export type { ColorKey } from './colors';
export { fontFamilies, systemFallback, tracking } from './typography';

export const radius = {
  sm: 3,
  md: 6,
  lg: 10,
  xl: 14,
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  xxl: 14,
  xxxl: 18,
  s4: 24,
  s5: 28,
  s6: 36,
} as const;

// React Native cannot do CSS multi-shadow; we approximate.
export const shadows = {
  paper: {
    shadowColor: '#3c280f',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  deep: {
    shadowColor: '#3c280f',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const;

// Breakpoint above which we treat the device as "tablet" and show the rail inline.
export const RAIL_BREAKPOINT = 820;
export const RAIL_WIDTH = 268;
