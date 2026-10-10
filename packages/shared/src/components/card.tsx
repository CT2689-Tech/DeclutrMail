import type { CSSProperties, ReactNode } from 'react';
import { color, radius, shadow } from '../tokens/tokens';

/**
 * The canonical surface — white card, hairline border, soft shadow.
 * No client-only behavior: server-rendered guidance need not hydrate its frame.
 */
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
