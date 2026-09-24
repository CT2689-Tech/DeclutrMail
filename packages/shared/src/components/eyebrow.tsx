'use client';

import type { CSSProperties, ReactNode } from 'react';
import { color, font, text } from '../tokens/tokens';

export type EyebrowTone = 'default' | 'primary' | 'amber';

/** Quiet sentence-case micro-label. Mono is reserved for numerals and keys. */
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
        fontFamily: font.sans,
        fontSize: text.sm,
        fontWeight: 500,
        color: fg,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
