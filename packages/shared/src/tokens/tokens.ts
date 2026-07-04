/**
 * Typed design tokens — the JS-side mirror of styles/tokens.css.
 * Components consume these via inline styles so the prototype's
 * editorial look ports with full fidelity. Scales are normalised:
 * the prototype's ad-hoc sizes collapse here into clean steps.
 *
 * Color + shadow values are CSS custom-property REFERENCES (not
 * literals): the actual hex lives in styles/tokens.css under
 * `:root` (light) and `[data-theme='dark']`, so every inline style
 * that reads `tokens.color.*` re-themes when the html attribute
 * flips. Never compare or do math on these strings — they are
 * `var(...)` expressions, resolved only by the browser.
 */

export const color = {
  /** Warm-newsprint surface stack — deepest → top. */
  bg: 'var(--dm-bg)',
  paper: 'var(--dm-paper)',
  card: 'var(--dm-card)',

  /** Ink. */
  fg: 'var(--dm-fg)',
  fgSoft: 'var(--dm-fg-soft)',
  fgMuted: 'var(--dm-fg-muted)',

  /** Lines / borders. */
  border: 'var(--dm-border)',
  line: 'var(--dm-line)',
  lineSoft: 'var(--dm-line-soft)',
  mutedBg: 'var(--dm-muted-bg)',

  /** Deep-teal accent. */
  primary: 'var(--dm-primary)',
  primaryDeep: 'var(--dm-primary-deep)',
  primarySoft: 'var(--dm-primary-soft)',
  primaryBorder: 'var(--dm-primary-border)',
  /** Pale teal wash — informational banner backgrounds. */
  primaryWash: 'var(--dm-primary-wash)',
  mint: 'var(--dm-mint)',

  /** Semantic hues. */
  amber: 'var(--dm-amber)',
  amberBg: 'var(--dm-amber-bg)',
  emerald: 'var(--dm-emerald)',
  emeraldBg: 'var(--dm-emerald-bg)',
  red: 'var(--dm-red)',
  redBg: 'var(--dm-red-bg)',
  redBorder: 'var(--dm-red-border)',

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
  danger: 'var(--dm-danger)',
  dangerBg: 'var(--dm-danger-bg)',
  dangerBorder: 'var(--dm-danger-border)',
  dangerDeep: 'var(--dm-danger-deep)',

  /**
   * Inverse-surface tokens (FOUNDER-FOLLOWUPS 2026-06-05).
   *
   * Used on dark surfaces — BulkActionBar, confirm-action-modal's
   * danger header, undo-tray. Replaces hand-rolled `rgba(255,255,255,
   * 0.55|0.65|0.7|0.16)` literals scattered across ~6 call sites with
   * three named alphas + an inverse line.
   */
  fgInverse: 'var(--dm-fg-inverse)',
  fgInverseSoft: 'var(--dm-fg-inverse-soft)',
  fgInverseMuted: 'var(--dm-fg-inverse-muted)',
  lineInverse: 'var(--dm-line-inverse)',

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
    accent: 'var(--dm-dash-accent)',
    accentSoft: 'var(--dm-dash-accent-soft)',
    accentBorder: 'var(--dm-dash-accent-border)',
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
  card: 'var(--dm-shadow-card)',
  pop: 'var(--dm-shadow-pop)',
  lift: 'var(--dm-shadow-lift)',
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
