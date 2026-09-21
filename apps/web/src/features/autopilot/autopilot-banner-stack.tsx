'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { tokens, useIsAtMost } from '@declutrmail/shared';

const { color, font, radius, text } = tokens;

/** The one surface every Autopilot banner shares — a wash, no border. */
export const bannerSurface: CSSProperties = {
  padding: '12px 14px',
  background: color.paper,
  borderRadius: radius.md,
  fontFamily: font.sans,
};

/**
 * One banner at a time. The screen passes its banners in priority
 * order; the stack shows the first and a "+N" control that steps to the
 * next, so a lower-priority banner is never lost — just not stacked.
 */
export function AutopilotBannerStack({ banners }: { banners: { key: string; node: ReactNode }[] }) {
  const [index, setIndex] = useState(0);
  const isMobile = useIsAtMost('sm');
  if (banners.length === 0) return null;
  // A banner can disappear under the user (a prompt dismissed, a rule
  // resumed), so the index is clamped on read rather than reset in an
  // effect.
  const current = banners[index % banners.length];
  if (current === undefined) return null;
  const others = banners.length - 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div key={current.key}>{current.node}</div>
      {others > 0 && (
        <button
          type="button"
          onClick={() => setIndex((i) => (i + 1) % banners.length)}
          aria-label={`Show next notice, ${others} more`}
          style={{
            alignSelf: 'flex-end',
            minHeight: isMobile ? 44 : 28,
            padding: 0,
            background: 'transparent',
            border: 'none',
            color: color.fgMuted,
            fontFamily: font.sans,
            fontSize: text.sm,
            cursor: 'pointer',
          }}
        >
          +{others} more
        </button>
      )}
    </div>
  );
}
