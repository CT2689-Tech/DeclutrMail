'use client';

import type { CSSProperties } from 'react';
import { color, font, radius, shadow } from '../tokens/tokens';
import {
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_BADGE_LEAD,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_NEVER_LABEL,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_STORAGE_LABEL,
} from '../copy/privacy';

/**
 * Layout density.
 *
 * - `card` (default) — full trust card with lead paragraph + both
 *   lists. Used on landing, onboarding sync gate, Privacy & Data
 *   settings (D109, D217, D223).
 * - `inline` — compact one-line version with headline + storage list
 *   only, for footers and tooltips. Still uses the D228 wording.
 */
export type PrivacyBadgeVariant = 'card' | 'inline';

/**
 * Trust badge consuming the D7 + D228 locked copy module.
 *
 * Renders only strings from `../copy/privacy.ts`. The component itself
 * holds zero copy literals so the microcopy audit only needs to guard
 * one file.
 */
export function PrivacyBadge({
  variant = 'card',
  style,
}: {
  variant?: PrivacyBadgeVariant;
  style?: CSSProperties;
}) {
  if (variant === 'inline') {
    return (
      <div
        data-dm-privacy-badge="inline"
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 6,
          padding: '6px 10px',
          background: color.primarySoft,
          border: `1px solid ${color.primaryBorder}`,
          borderRadius: radius.md,
          fontFamily: font.sans,
          fontSize: 12,
          color: color.fg,
          ...style,
        }}
      >
        <strong style={{ fontWeight: 600, color: color.primaryDeep }}>
          {PRIVACY_BADGE_HEADLINE}
        </strong>
        <span style={{ color: color.fgMuted }}>
          {PRIVACY_STORAGE_LABEL} {PRIVACY_STORAGE_ITEMS.join(', ')}.
        </span>
      </div>
    );
  }

  return (
    <section
      data-dm-privacy-badge="card"
      aria-label={PRIVACY_BADGE_HEADLINE}
      style={{
        background: color.card,
        border: `1px solid ${color.primaryBorder}`,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        padding: 20,
        fontFamily: font.sans,
        color: color.fg,
        ...style,
      }}
    >
      <header style={{ marginBottom: 12 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: color.primaryDeep,
          }}
        >
          {PRIVACY_BADGE_HEADLINE}
        </h3>
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 13,
            lineHeight: 1.55,
            color: color.fgMuted,
          }}
        >
          {PRIVACY_BADGE_LEAD}
        </p>
      </header>

      <PrivacyList
        label={PRIVACY_STORAGE_LABEL}
        items={PRIVACY_STORAGE_ITEMS}
        tone="store"
      />
      <PrivacyList
        label={PRIVACY_NEVER_LABEL}
        items={PRIVACY_NEVER_ITEMS}
        tone="never"
        style={{ marginTop: 12 }}
      />
    </section>
  );
}

function PrivacyList({
  label,
  items,
  tone,
  style,
}: {
  label: string;
  items: readonly string[];
  tone: 'store' | 'never';
  style?: CSSProperties;
}) {
  const dotColor = tone === 'store' ? color.primary : color.fgMuted;
  return (
    <div style={style}>
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 10.5,
          fontWeight: 500,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: color.fgMuted,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'grid',
          gap: 4,
        }}
      >
        {items.map((item) => (
          <li
            key={item}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 5,
                height: 5,
                borderRadius: radius.pill,
                background: dotColor,
                marginTop: 7,
                flexShrink: 0,
              }}
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
