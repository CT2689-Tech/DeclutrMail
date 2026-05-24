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
 * Render a `VolumeTrendBucket` as a single compact glyph + label.
 * Bucketed (not raw %) per the senders-tightening v2 brief — false
 * precision on small baselines is the failure mode we're avoiding.
 *
 * `null` (no timeseries history) collapses to "—" so the cell stays
 * the same visual size as the other stats.
 */
function fmtTrend(bucket: SenderStats['volumeTrend']): {
  value: string;
  tone?: 'primary' | 'amber';
} {
  if (bucket === null) return { value: '—' };
  if (bucket === 'up') return { value: '↑ Up', tone: 'primary' };
  if (bucket === 'down') return { value: '↓ Down', tone: 'amber' };
  if (bucket === 'dormant') return { value: '○ Dormant', tone: 'amber' };
  if (bucket === 'new') return { value: '• New' };
  return { value: '→ Steady' };
}

/**
 * Stats strip (D39 #5, D44).
 *
 * Four scan-only stats in a single reflow row. Mono numerals with
 * tabular-nums so values stay column-aligned across screens. Auto-fit
 * grid reflows to 2 columns on tablet and stacks on phone widths —
 * directly addresses LEARNINGS.md 2026-05-19 (no fixed-width columns).
 *
 * Reshape pass (senders-tightening v2 brief):
 *   - Dropped `Read rate` headline cell — Gmail `!UNREAD` is a
 *     read-state proxy, not an open signal; we surface it caveated
 *     under the 12-month chart instead of as a primary stat.
 *   - Dropped `Total all-time` — was synthesized from
 *     `monthly × months × 0.85`. Misleading. The 12-month chart
 *     already carries lifetime context.
 *   - Added `Trend` cell — bucketed MoM trend (`up/down/steady/
 *     dormant/new`), the strongest decision signal we have today
 *     besides volume.
 *
 * No interactivity per D44 — clicking does nothing.
 */
export function StatsStrip({ stats }: { stats: SenderStats }) {
  type Tone = 'primary' | 'amber';
  const trend = fmtTrend(stats.volumeTrend);
  const trendCell: { label: string; value: string; tone?: Tone } = {
    label: 'Trend',
    value: trend.value,
  };
  if (trend.tone != null) trendCell.tone = trend.tone;

  const items: Array<{ label: string; value: string; tone?: Tone }> = [
    { label: 'Monthly volume', value: `${stats.monthlyVolume}/mo` },
    trendCell,
    { label: 'Relationship', value: fmtRelationship(stats.relationshipMonths) },
    { label: 'Last seen', value: relTime(stats.lastSeenDays) },
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
