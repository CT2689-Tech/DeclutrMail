'use client';

import { tokens } from '@declutrmail/shared';
import { relTime } from './data';
import type { SenderStats } from './types';

const { color, font, radius } = tokens;

/** Format a month-count as years for ≥12 months, months otherwise. */
function fmtRelationship(months: number): string {
  if (months < 12) return `${months}mo`;
  const years = months / 12;
  return `${years.toFixed(1)}yr`;
}

/**
 * Stats strip (D39 #5, D44).
 *
 * Five scan-only stats in a single reflow row. Mono numerals with
 * tabular-nums so values stay column-aligned across screens. Auto-fit
 * grid reflows to 2 columns on tablet and stacks on phone widths —
 * directly addresses LEARNINGS.md 2026-05-19 (no fixed-width columns).
 *
 * No interactivity per D44 — clicking does nothing.
 */
export function StatsStrip({ stats }: { stats: SenderStats }) {
  type Tone = 'primary' | 'amber';
  const readTone: Tone | null =
    stats.readRate >= 0.5 ? 'primary' : stats.readRate < 0.2 ? 'amber' : null;
  const readRate: { label: string; value: string; tone?: Tone } = {
    label: 'Read rate',
    value: `${Math.round(stats.readRate * 100)}%`,
  };
  if (readTone != null) readRate.tone = readTone;

  const items: Array<{ label: string; value: string; tone?: Tone }> = [
    { label: 'Monthly volume', value: `${stats.monthlyVolume}/mo` },
    readRate,
    { label: 'Relationship', value: fmtRelationship(stats.relationshipMonths) },
    { label: 'Last seen', value: relTime(stats.lastSeenDays) },
    { label: 'Total all-time', value: stats.totalAllTime.toLocaleString() },
  ];

  return (
    <section
      aria-label="Sender stats"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 10,
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
        padding: '14px 16px',
        fontFamily: font.sans,
      }}
    >
      {items.map((item) => (
        <div key={item.label} style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 9.5,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: color.fgMuted,
            }}
          >
            {item.label}
          </div>
          <div
            style={{
              fontFamily: font.display,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color:
                item.tone === 'primary'
                  ? color.primary
                  : item.tone === 'amber'
                    ? color.amber
                    : color.fg,
              marginTop: 4,
              fontVariantNumeric: 'tabular-nums',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.value}
          </div>
        </div>
      ))}
    </section>
  );
}
