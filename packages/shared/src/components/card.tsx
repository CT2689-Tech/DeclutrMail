'use client';

import type { CSSProperties, ReactNode } from 'react';
import { color, radius, shadow } from '../tokens/tokens';

/** The canonical surface — white card, hairline border, soft shadow. */
export function Card({
  children,
  padding = 16,
  accent = false,
  lift = false,
  style,
}: {
  children: ReactNode;
  padding?: number;
  accent?: boolean;
  lift?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      data-dm-lift={lift ? '' : undefined}
      style={{
        background: color.card,
        border: `1px solid ${accent ? color.primaryBorder : color.line}`,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
