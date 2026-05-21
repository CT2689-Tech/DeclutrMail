/**
 * Typed design tokens — the JS-side mirror of styles/tokens.css.
 * Components consume these via inline styles so the prototype's
 * editorial look ports with full fidelity. Scales are normalised:
 * the prototype's ad-hoc sizes collapse here into clean steps.
 */

export const color = {
  /** Warm-newsprint surface stack — deepest → top. */
  bg: '#FAFAF7',
  paper: '#F4F4F0',
  card: '#FFFFFF',

  /** Ink. */
  fg: '#0E1413',
  fgSoft: '#4B5552',
  fgMuted: '#8A938F',

  /** Lines / borders. */
  border: '#E4E7EB',
  line: 'rgba(14,20,19,0.10)',
  lineSoft: 'rgba(14,20,19,0.06)',
  mutedBg: '#EFF2F5',

  /** Deep-teal accent. */
  primary: '#006B5F',
  primaryDeep: '#00463F',
  primarySoft: 'rgba(0,107,95,0.08)',
  primaryBorder: 'rgba(0,107,95,0.35)',
  mint: '#79E6DC',

  /** Semantic hues. */
  amber: '#B45309',
  amberBg: 'rgba(245,158,11,0.10)',
  emerald: '#047857',
  emeraldBg: 'rgba(5,150,105,0.10)',
  red: '#B91C1C',
  redBg: 'rgba(220,38,38,0.06)',
  redBorder: 'rgba(220,38,38,0.25)',
} as const;

export const font = {
  sans: 'var(--dm-font-sans)',
  mono: 'var(--dm-font-mono)',
  display: 'var(--dm-font-display)',
} as const;

/** Normalised type scale (px). */
export const text = {
  '2xs': 10,
  xs: 11,
  sm: 12,
  base: 13,
  md: 14,
  lg: 16,
  xl: 18,
  '2xl': 22,
  '3xl': 28,
  '4xl': 34,
} as const;

/** 4px spacing scale (px). */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 9999,
} as const;

export const shadow = {
  card: '0 1px 2px rgba(20,30,50,0.04), 0 0 0 1px rgba(20,30,50,0.012)',
  pop: '0 10px 28px rgba(0,0,0,0.14)',
  lift: '0 8px 24px -8px rgba(20,30,50,0.10), 0 2px 6px -2px rgba(20,30,50,0.05)',
} as const;

/** Responsive ceilings (px) — see useIsAtMost. */
export const breakpoint = {
  xs: 480,
  sm: 900,
  md: 1100,
  lg: 1280,
} as const;

/** Deterministic avatar fills, picked by sender-name char code. */
export const avatarColors = [
  '#0E7490',
  '#7C3AED',
  '#059669',
  '#0891B2',
  '#DC2626',
  '#0369A1',
  '#B45309',
  '#15803D',
] as const;

export const tokens = {
  color,
  font,
  text,
  space,
  radius,
  shadow,
  breakpoint,
  avatarColors,
} as const;

export type Tokens = typeof tokens;
