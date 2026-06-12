'use client';

import { tokens } from '@declutrmail/shared';

const { color, font } = tokens;

/**
 * Screener empty state (D76) — a calm single-line message. No
 * illustration, no CTA; matches the calm/premium voice. Copy is the
 * D76-locked text verbatim.
 */
export function ScreenerEmptyState() {
  return (
    <div
      role="status"
      style={{
        padding: '48px 24px',
        textAlign: 'center',
        fontFamily: font.sans,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 600, color: color.fg }}>No unknown senders.</span>
      <span style={{ fontSize: 13, color: color.fgMuted }}>
        We&apos;ll let you know when one shows up.
      </span>
    </div>
  );
}
