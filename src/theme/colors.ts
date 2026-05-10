// Mirror of styles.css CSS variables — single source of truth for the parchment theme.
export const colors = {
  // surfaces
  bg: '#ece2d0',
  bg2: '#e0d4bd',
  surface: '#f6ecd8',
  surface2: '#ebdfc6',
  surface3: '#e2d4b6',
  border: '#b9a787',
  borderSoft: '#cdbfa3',
  borderStrong: '#8d7a5b',
  divider: '#d4c5a4',

  // ink
  ink: '#1f1812',
  ink2: '#4a3e2f',
  ink3: '#76654c',
  ink4: '#a3927a',

  // accents
  empire: '#7d1f1f',
  empireDeep: '#5a1313',
  empireBright: '#a02a2a',
  brass: '#8a6f1c',
  brassBright: '#b8951f',
  brassSoft: '#c9a227',
  gold: '#d4af37',
  corruption: '#5b3d6b',
  corruptionBright: '#7a548c',
  bone: '#f3e8d0',
  ivory: '#fbf3df',
  candle: '#d49a3a',

  success: '#3a5d2c',
  warning: '#a07810',
  info: '#2f4f73',

  // tints (used in places styles.css uses rgba)
  empireTint: 'rgba(125,31,31,0.10)',
  empireTintBorder: 'rgba(125,31,31,0.35)',
  brassTint: 'rgba(138,111,28,0.12)',
  brassTintBorder: 'rgba(138,111,28,0.40)',
  brassTintInk: '#6a5612',
  corrTint: 'rgba(91,61,107,0.10)',
  corrTintBorder: 'rgba(91,61,107,0.35)',
  successTint: 'rgba(58,93,44,0.10)',
  successTintBorder: 'rgba(58,93,44,0.35)',
  warnTint: 'rgba(160,120,16,0.12)',
  warnTintBorder: 'rgba(160,120,16,0.40)',

  hoverHighlight: 'rgba(212,175,55,0.05)',
  brassHighlight: 'rgba(212,175,55,0.08)',

  inkSoft06: 'rgba(60,40,15,0.06)',
  inkSoft08: 'rgba(60,40,15,0.08)',
  inkSoft18: 'rgba(60,40,15,0.18)',
  inkSoft55: 'rgba(60,40,15,0.55)',
} as const;

export type ColorKey = keyof typeof colors;
