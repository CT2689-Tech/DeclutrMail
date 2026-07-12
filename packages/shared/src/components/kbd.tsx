'use client';

import type { CSSProperties, ReactNode } from 'react';
import { color, font } from '../tokens/tokens';

/** A keyboard-key chip — used in hint strips and command rows. */
export function Kbd({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  // Consumers use `border: 'none'` for inverse/filled keys. Normalize that
  // shorthand into four sides so React never has to reconcile `border` and
  // the raised-key `borderBottom` longhand during a tone change.
  const { border: customBorder, ...restStyle } = style ?? {};
  const defaultBorder = `1px solid ${color.border}`;
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
        borderTop: customBorder ?? defaultBorder,
        borderRight: customBorder ?? defaultBorder,
        borderBottom: customBorder ?? `2px solid ${color.border}`,
        borderLeft: customBorder ?? defaultBorder,
        borderRadius: 4,
        fontFamily: font.mono,
        fontSize: 10,
        fontWeight: 600,
        ...restStyle,
      }}
    >
      {children}
    </kbd>
  );
}
