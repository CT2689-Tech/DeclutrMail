'use client';

import { tokens } from '@declutrmail/shared';

const { color, font } = tokens;

/**
 * Session burn-down for the triage header — "3 decided · 5 to go" plus
 * a thin progress bar.
 *
 * `decided` is the client-session counter from the triage store
 * (D200 — ephemeral, resets on mount; the durable per-day number is
 * `stats.decidedToday`). It increments ONLY on server confirmation
 * (D226), so the bar can never run ahead of reality. `remaining` is
 * the live queue length.
 *
 * Renders nothing until the first confirmed decision — a "0 decided"
 * bar on arrival is noise, and the queue legend already carries the
 * count of waiting decisions.
 */
export function SessionProgress({ decided, remaining }: { decided: number; remaining: number }) {
  if (decided === 0) return null;
  const total = decided + remaining;
  const pct = total === 0 ? 100 : Math.round((decided / total) * 100);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        minWidth: 160,
        fontFamily: font.sans,
      }}
    >
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: color.fgMuted,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {decided} decided · {remaining === 0 ? 'all done' : `${remaining} to go`}
      </span>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={decided}
        aria-label={`Session progress: ${decided} of ${total} decisions made`}
        style={{
          height: 3,
          borderRadius: 9999,
          background: color.lineSoft,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 9999,
            background: color.primary,
            transition: 'width 0.25s ease-out',
          }}
        />
      </div>
    </div>
  );
}
