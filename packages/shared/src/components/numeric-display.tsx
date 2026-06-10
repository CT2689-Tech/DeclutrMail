// packages/shared/src/components/numeric-display.tsx
//
// `NumericDisplay` — the single shared primitive for primary numerics
// on Senders + Sender-Detail surfaces (ADR-0016 §A1).
//
// Every "a number that earns visual gravity" use-site reaches for one
// of four variants instead of hand-rolling `fontFamily: font.display`
// + an ad-hoc fontSize. Variants encode the size + weight + tracking
// pairing so the cross-surface scale stays consistent.
//
// Variants:
//   - `hero`    — Fraunces 40px / 300 / -0.03em
//                 SenderCard primary monthly volume; hero slice headline
//   - `display` — Fraunces 28px / 400 / -0.025em
//                 SenderDetailHeader sender name; SenderTable total cell
//   - `stat`    — Fraunces 20px / 500 / -0.02em
//                 Stat strip values (Detail + card stat strip)
//   - `data`    — Geist Mono 13px / 500 / 0.01em + tabular-nums
//                 Inline counts, percents, dates
//
// Always `font-variant-numeric: tabular-nums` so values stay
// column-aligned across sort changes, refetches, and surface
// transitions (card → row → detail).
//
// Tone defaults to `color.fg`; pass `tone="primary"` / `"amber"` /
// `"muted"` for the recommendation-tone semantic per ADR-0009 /
// D26 / D31. Tone semantics are restated in ADR-0016 §A3 — refer
// there before adding new tones.

import type { CSSProperties, ReactNode } from 'react';
import { tokens } from '../tokens/tokens';

const { color, font } = tokens;

export type NumericDisplayVariant = 'hero' | 'display' | 'stat' | 'data';
export type NumericDisplayTone = 'default' | 'primary' | 'amber' | 'muted';

export interface NumericDisplayProps {
  /** The numeric value to render. Strings supported so callers may
   *  pass formatted output (e.g. `1,247`, `13%`, `3d`, `today`). */
  value: ReactNode;
  /** Optional small suffix rendered inline after the value (e.g.
   *  `/mo`, `in last 30d`). Renders in sans, tone="muted". */
  suffix?: ReactNode;
  variant?: NumericDisplayVariant;
  tone?: NumericDisplayTone;
  /** Optional style overrides for callers that need to constrain
   *  width / margin / etc. Use sparingly — every override is a
   *  Storybook regression. */
  style?: CSSProperties;
  className?: string;
  /** Optional aria-label for screen readers when the value is a
   *  formatted abbreviation (e.g. `today`, `3d`, `1.2yr`). */
  ariaLabel?: string;
}

const VARIANT_STYLE: Record<NumericDisplayVariant, CSSProperties> = {
  hero: {
    fontFamily: font.display,
    fontSize: 40,
    fontWeight: 300,
    letterSpacing: '-0.03em',
    lineHeight: 1,
  },
  display: {
    fontFamily: font.display,
    fontSize: 28,
    fontWeight: 400,
    letterSpacing: '-0.025em',
    lineHeight: 1.05,
  },
  stat: {
    fontFamily: font.display,
    fontSize: 20,
    fontWeight: 500,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
  },
  data: {
    fontFamily: font.mono,
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: '0.01em',
    lineHeight: 1.2,
  },
};

const TONE_COLOR: Record<NumericDisplayTone, string> = {
  default: color.fg,
  primary: color.primary,
  amber: color.amber,
  muted: color.fgMuted,
};

/**
 * Em-dash placeholder rendered when `value` arrives degraded — `null`,
 * `undefined`, `NaN`, an empty string, or the literal string
 * `'undefined'` / `'NaN'` produced by an upstream `String()` coercion.
 *
 * Rationale (silent-failure-hunter advisory 2026-06-03): the primitive
 * is the single shared numeric surface — guarding here protects every
 * consumer from a silent wire-regression that would otherwise ship a
 * literal `"NaN"` / `"undefined"` to the DOM and slip past Sentry. An
 * em-dash reads as a designed "no data" state that the rest of the
 * codebase already uses (`stats-strip.tsx`, `sender-table.tsx`).
 */
const EMPTY_PLACEHOLDER = '—';

function renderableValue(value: NumericDisplayProps['value']): NumericDisplayProps['value'] {
  if (value === null || value === undefined) return EMPTY_PLACEHOLDER;
  if (typeof value === 'number' && !Number.isFinite(value)) return EMPTY_PLACEHOLDER;
  if (typeof value === 'string') {
    if (value === '' || value === 'NaN' || value === 'undefined') return EMPTY_PLACEHOLDER;
  }
  return value;
}

export function NumericDisplay({
  value,
  suffix,
  variant = 'data',
  tone = 'default',
  style,
  className,
  ariaLabel,
}: NumericDisplayProps) {
  const variantStyle = VARIANT_STYLE[variant];
  const safeValue = renderableValue(value);
  const merged: CSSProperties = {
    ...variantStyle,
    color: safeValue === EMPTY_PLACEHOLDER ? color.fgMuted : TONE_COLOR[tone],
    fontVariantNumeric: 'tabular-nums',
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: 8,
    minWidth: 0,
    ...style,
  };
  return (
    <span
      className={className}
      style={merged}
      aria-label={ariaLabel}
      data-numeric-variant={variant}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {safeValue}
      </span>
      {suffix !== undefined && suffix !== null && (
        <span
          style={{
            fontFamily: font.sans,
            fontSize: 12,
            fontWeight: 500,
            color: color.fgSoft,
            letterSpacing: '-0.005em',
            fontVariantNumeric: 'normal',
          }}
        >
          {suffix}
        </span>
      )}
    </span>
  );
}
