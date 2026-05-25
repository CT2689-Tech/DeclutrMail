'use client';
// apps/web/src/features/senders/uplift-d/kpi-strip/kpi-strip.tsx
//
// Variant D KPI strip — feature-owned per ADR-0007 (lazy promotion).
// Promote to packages/shared/ when the second consumer (Activity, Brief)
// needs the same N-cell horizontal grid pattern.
//
// Design intent (~/.claude/plans/how-can-we-uplift-foamy-cloud.md §D1):
// a single restrained row of monumental numbers — Senders, Noise
// reducible, Time cost, Protected, Needs review. Each cell carries an
// uppercase eyebrow + a big mono numeral + optional micro-spark or
// caption beneath. NO sparkline pulse dots, NO animated counters
// (ADR-0010 rejected those). Sparklines DO get the once-per-mount draw-on
// per ADR-0010 — but the draw-on is the consumer's job (passed as the
// `micro` slot), not the strip's.
//
// Copy rules (ADR-0011 + D209): labels are user-value-facing nouns —
// 'Senders' not 'Sender count'; 'Time cost' not 'Reading hours'.
// Internal labels like 'Active 24h' / 'Active week' are permitted on
// dashboard surfaces but the founder-recommended labels for Senders V1
// are Senders / Noise reducible / Time cost / Protected / Needs review.

import type { ReactNode } from 'react';
import { tokens } from '@declutrmail/shared';

const { color, font, radius, shadow, text, space } = tokens;

export interface KpiCellProps {
  /** Uppercase eyebrow above the number. */
  label: ReactNode;
  /** Monumental number (string for formatting freedom — '~48%', '4.2h', '12'). */
  value: ReactNode;
  /**
   * Optional unit suffix rendered smaller alongside the number — e.g.
   * '%', 'h/mo', '/mo'. Pass as a child of `value` when you need finer
   * control over the spacing.
   */
  unit?: ReactNode;
  /**
   * Slot below the number. Typical use: `<Spark values={...} />` for a
   * 14px-tall trend line (ADR-0010 draw-on applies on first mount); or
   * a mono caption like 'VIPs · receipts' when the metric has no
   * temporal trend.
   */
  micro?: ReactNode;
}

export interface KpiStripProps {
  /** Cells rendered left → right. Typical count: 4–6. */
  cells: KpiCellProps[];
}

/**
 * Horizontal KPI strip with N evenly-distributed cells separated by hair
 * lines. Reflows to wrap on narrower viewports via CSS grid auto-fit.
 *
 * @example
 *   <KpiStrip cells={[
 *     { label: 'Senders', value: 12, micro: <Spark values={...} /> },
 *     { label: 'Noise reducible', value: '~48', unit: '%', micro: <Spark .../> },
 *     { label: 'Time cost', value: '4.2', unit: 'h/mo' },
 *     { label: 'Protected', value: 3, micro: 'VIPs · receipts' },
 *     { label: 'Needs review', value: 8, micro: <Spark values={...} /> },
 *   ]} />
 */
export function KpiStrip({ cells }: KpiStripProps) {
  const cellCount = cells.length;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cellCount}, minmax(0, 1fr))`,
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        marginBottom: space[4],
        overflow: 'hidden',
        fontFamily: font.sans,
      }}
    >
      {cells.map((cell, i) => (
        <div
          key={i}
          style={{
            padding: `${space[4]}px ${space[5]}px`,
            borderRight: i < cellCount - 1 ? `1px solid ${color.lineSoft}` : 'none',
          }}
        >
          <div
            style={{
              fontSize: text['2xs'],
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: color.fgMuted,
              fontWeight: 500,
            }}
          >
            {cell.label}
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: '-0.025em',
              marginTop: space[2],
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
              color: color.fg,
            }}
          >
            {cell.value}
            {cell.unit != null && (
              <span
                style={{
                  fontSize: text.sm,
                  color: color.fgMuted,
                  fontWeight: 500,
                  marginLeft: 3,
                  letterSpacing: 0,
                }}
              >
                {cell.unit}
              </span>
            )}
          </div>
          {cell.micro != null && (
            <div
              style={{
                marginTop: space[2],
                minHeight: 14,
                opacity: 0.7,
                fontSize: text['2xs'],
                color: color.fgMuted,
                fontFamily: font.mono,
              }}
            >
              {cell.micro}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
