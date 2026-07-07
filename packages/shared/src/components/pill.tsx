'use client';

import type { CSSProperties, ReactNode } from 'react';
import { color, font, radius } from '../tokens/tokens';

export type PillTone = 'default' | 'primary' | 'amber' | 'emerald' | 'red' | 'dark';

const PILL_TONES: Record<PillTone, { bg: string; fg: string; br: string }> = {
  default: { bg: color.mutedBg, fg: color.fg, br: color.border },
  primary: { bg: color.primarySoft, fg: color.primary, br: color.primaryBorder },
  // Semantic fgs ride the theme tokens (not the old darker literals) so
  // the washes stay readable when the dark palette brightens them.
  amber: { bg: color.amberBg, fg: color.amber, br: 'rgba(245,158,11,0.30)' },
  emerald: { bg: color.emeraldBg, fg: color.emerald, br: 'rgba(5,150,105,0.25)' },
  red: { bg: color.redBg, fg: color.red, br: color.redBorder },
  dark: { bg: color.fg, fg: color.fgInverse, br: color.fg },
};

/** Small rounded status/label chip. */
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
        padding: '2px 8px',
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.br}`,
        borderRadius: radius.pill,
        fontFamily: font.sans,
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
