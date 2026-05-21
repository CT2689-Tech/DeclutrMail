'use client';

import type { CSSProperties, ReactNode } from 'react';
import { color, font } from '../tokens/tokens';

export type EyebrowTone = 'default' | 'primary' | 'amber';

/** Mono uppercase micro-label that sits above a heading — editorial chrome. */
export function Eyebrow({
  children,
  tone = 'default',
  style,
}: {
  children: ReactNode;
  tone?: EyebrowTone;
  style?: CSSProperties;
}) {
  const fg = tone === 'primary' ? color.primary : tone === 'amber' ? color.amber : color.fgMuted;
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: fg,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
