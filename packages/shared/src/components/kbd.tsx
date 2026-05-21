'use client';

import type { CSSProperties, ReactNode } from 'react';
import { color, font } from '../tokens/tokens';

/** A keyboard-key chip — used in hint strips and command rows. */
export function Kbd({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <kbd
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        background: color.card,
        color: color.fg,
        border: `1px solid ${color.border}`,
        borderBottom: `2px solid ${color.border}`,
        borderRadius: 4,
        fontFamily: font.mono,
        fontSize: 10,
        fontWeight: 600,
        ...style,
      }}
    >
      {children}
    </kbd>
  );
}
