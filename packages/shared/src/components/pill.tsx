'use client';

import type { CSSProperties, ReactNode } from 'react';
import { color, font, radius, text } from '../tokens/tokens';

export type PillTone = 'default' | 'primary' | 'amber' | 'emerald' | 'red' | 'dark';

// Soft-fill capsules: the tint IS the shape, so there is no outline.
const PILL_TONES: Record<PillTone, { bg: string; fg: string }> = {
  default: { bg: color.fill, fg: color.fgSoft },
  primary: { bg: color.primarySoft, fg: color.primary },
  // Semantic fgs ride the theme tokens so the washes stay readable when
  // the dark palette brightens them.
  amber: { bg: color.amberBg, fg: color.amber },
  emerald: { bg: color.emeraldBg, fg: color.emerald },
  red: { bg: color.redBg, fg: color.red },
  dark: { bg: color.fg, fg: color.fgInverse },
};

/** Small soft-fill status/label capsule. */
export function Pill({
  children,
  tone = 'default',
  style,
}: {
  children: ReactNode;
  tone?: PillTone;
  style?: CSSProperties;
}) {
  const t = PILL_TONES[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 22,
        padding: '0 9px',
        boxSizing: 'border-box',
        background: t.bg,
        color: t.fg,
        border: 'none',
        borderRadius: radius.pill,
        fontFamily: font.sans,
        fontSize: text.xs,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
