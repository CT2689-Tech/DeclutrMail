import type { CSSProperties, ReactNode } from 'react';

import { color, font, radius } from '../tokens/tokens';

/**
 * Reusable progressive disclosure for protocol names, identifiers, and
 * support-only diagnostics. The required summary stays in plain language so
 * the disclosure makes sense before a user opens it.
 */
export function TechnicalDetails({
  summary,
  children,
  defaultOpen = false,
  style,
}: {
  /** Contextual action label, e.g. "Show Google permission details". */
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
  style?: CSSProperties;
}) {
  return (
    <details
      data-dm-technical-details
      open={defaultOpen || undefined}
      style={{
        width: '100%',
        border: `1px solid ${color.lineSoft}`,
        borderRadius: radius.md,
        background: color.paper,
        color: color.fg,
        fontFamily: font.sans,
        ...style,
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          padding: '9px 11px',
          color: color.primary,
          fontSize: 12.5,
          fontWeight: 600,
          lineHeight: 1.4,
        }}
      >
        {summary}
      </summary>
      <div
        style={{
          padding: '0 11px 11px',
          color: color.fgMuted,
          fontSize: 12,
          lineHeight: 1.55,
          overflowWrap: 'anywhere',
        }}
      >
        {children}
      </div>
    </details>
  );
}
