'use client';

import type { CSSProperties, ReactNode } from 'react';
import { color, font, radius, text } from '../tokens/tokens';

/**
 * A keyboard-key chip — used in hint strips and command rows. A quiet
 * fill, no raised border: the one place `font.mono` is allowed.
 */
export function Kbd({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <kbd
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 20,
        height: 20,
        padding: '0 6px',
        boxSizing: 'border-box',
        background: color.fill,
        color: color.fgSoft,
        border: 'none',
        borderRadius: radius.sm,
        fontFamily: font.mono,
        fontSize: text.xs,
        fontWeight: 600,
        lineHeight: 1,
        ...style,
      }}
    >
      {children}
    </kbd>
  );
}
