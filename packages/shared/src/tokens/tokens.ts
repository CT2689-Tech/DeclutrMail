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
  fgMuted: '#646D69',

  /** Lines / borders. */
  border: 'rgba(14,20,19,0.14)',
  line: 'rgba(14,20,19,0.10)',
  lineSoft: 'rgba(14,20,19,0.06)',
  mutedBg: '#EFF2F5',

  /** Deep-teal accent. */
  primary: '#006B5F',
  primaryDeep: '#00463F',
  primarySoft: 'rgba(0,107,95,0.08)',
  primaryBorder: 'rgba(0,107,95,0.35)',
  /** Pale teal wash — informational banner backgrounds. */
  primaryWash: 'hsl(174 60% 96%)',
  mint: '#79E6DC',

  /** Semantic hues. */
  amber: '#B45309',
  amberBg: 'rgba(245,158,11,0.10)',
  emerald: '#047857',
  emeraldBg: 'rgba(5,150,105,0.10)',
  red: '#B91C1C',
  redBg: 'rgba(220,38,38,0.06)',
  redBorder: 'rgba(220,38,38,0.25)',

  /**
   * Canonical danger family (FOUNDER-FOLLOWUPS 2026-06-05).
   *
   * Replaces three drifted call sites: `#A12525` (compose-strip +
   * confirm-action-modal), `#DC2626` (action-popover), and the legacy
   * `color.red = #B91C1C`. The verb-registry header says `color.danger`
   * is the planned token for the Delete verb — this is that token.
   *
   * Surfaces:
   *   - `danger`        — text + icon stroke (AA on white surfaces).
   *   - `dangerBg`      — soft wash for danger banners + chips.
   *   - `dangerBorder`  — outline for danger chips + outlines.
   *   - `dangerDeep`    — pressed/hover state, darker than `danger`.
   *
   * Migration plan: new code uses these; an ESLint rule in the
   * Storybook lint phase blocks new `#A12525` / `#DC2626` literals.
   * Legacy `color.red` stays for one release for backward-compat, then
   * gets removed in the follow-up distill PR.
   */
  danger: '#A12525',
  dangerBg: 'rgba(161,37,37,0.06)',
  dangerBorder: 'rgba(161,37,37,0.30)',
  dangerDeep: '#7A1A1A',

  /**
   * Inverse-surface tokens (FOUNDER-FOLLOWUPS 2026-06-05).
   *
   * Used on dark surfaces — BulkActionBar, confirm-action-modal's
   * danger header, undo-tray. Replaces hand-rolled `rgba(255,255,255,
   * 0.55|0.65|0.7|0.16)` literals scattered across ~6 call sites with
   * three named alphas + an inverse line.
   */
  fgInverse: '#FFFFFF',
  fgInverseSoft: 'rgba(255,255,255,0.70)',
  fgInverseMuted: 'rgba(255,255,255,0.55)',
  lineInverse: 'rgba(255,255,255,0.16)',

  /**
   * Dashboard-surface palette extension per ADR-0009 (amends D2).
   *
   * SCOPE: Senders, Activity, Brief, future Insights surfaces ONLY.
   * Use violet for live/active affordances + filter-chip active state.
   *
   * FORBIDDEN everywhere: violet on action buttons (Keep / Archive /
   * Unsubscribe / Later — D227), on trust affordances (D7 / D228), on
   * recommendation tones (D26 / D31), or on any non-dashboard surface
   * (Triage / Onboarding / Settings / Billing / marketing).
   *
   * Consumer convention: files importing `color.dashboard.*` must
   * include the ADR-0009 file-header comment block. An ESLint guardrail
   * scoping these imports to apps/web/src/features/{senders,activity,brief}/**
   * is tracked in FOUNDER-FOLLOWUPS.md (2026-05-25 entry).
   */
  dashboard: {
    accent: '#7C3AED',
    accentSoft: 'rgba(124, 58, 237, 0.10)',
    accentBorder: 'rgba(124, 58, 237, 0.20)',
  },
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

// `avatarColors` (the saturated monogram fills) retired with ADR-0024 —
// the Avatar derives a muted per-domain tint itself, inside the D2
// cool/editorial palette. The saturated set included hues outside the
// ADR-0016 A3 accent map (violet, red, green).

export const tokens = {
  color,
  font,
  text,
  space,
  radius,
  shadow,
  breakpoint,
} as const;

export type Tokens = typeof tokens;
