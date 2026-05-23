'use client';

import { useId } from 'react';
import { Eyebrow, tokens } from '@declutrmail/shared';
import type { TimeseriesPoint } from './types';

const { color, font, radius } = tokens;

const CHART_HEIGHT = 130;
const PAD_TOP = 14;
const PAD_BOTTOM = 18;
const PAD_X = 10;

/**
 * Volume + open-rate charts (D39 #6, D45).
 *
 * 12 monthly buckets. Volume = bar chart, open-rate = line chart.
 * Y-axis grid only — no axis labels — per the Linear-style
 * minimalism in D2 (cool/Vercel direction).
 *
 * Side-by-side on desktop, stacked on phone via `auto-fit` minmax.
 * No external chart lib — kept in plain SVG so the bundle stays
 * lean and the visual matches the rest of the editorial palette.
 * If a future feature needs richer charts, swap to Recharts or visx
 * (D45 leans visx) — kept consumer-local until that consumer arrives.
 */
export function Charts({ timeseries }: { timeseries: TimeseriesPoint[] }) {
  return (
    <section
      aria-label="Volume and open rate"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 14,
        fontFamily: font.sans,
      }}
    >
      <ChartCard title="Volume / 12 months" footer="messages per month">
        <VolumeBars points={timeseries} />
      </ChartCard>
      <ChartCard title="Open rate / 12 months" footer="opens ÷ volume">
        <OpenRateLine points={timeseries} />
      </ChartCard>
    </section>
  );
}

function ChartCard({
  title,
  footer,
  children,
}: {
  title: string;
  footer: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
      }}
    >
      <Eyebrow>{title}</Eyebrow>
      <div style={{ width: '100%', overflow: 'hidden' }}>{children}</div>
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 10,
          color: color.fgMuted,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {footer}
      </span>
    </div>
  );
}

function monthLabel(yearMonth: string): string {
  const [, m] = yearMonth.split('-');
  const idx = Math.max(0, Math.min(11, Number(m ?? '1') - 1));
  return ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'][idx] ?? '';
}

function VolumeBars({ points }: { points: TimeseriesPoint[] }) {
  const titleId = useId();
  if (points.length === 0) return <ChartEmpty />;
  const max = Math.max(1, ...points.map((p) => p.volume));
  const width = 100; // viewBox % — scales to container
  const innerW = width - PAD_X * 2;
  const innerH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const slot = innerW / points.length;
  const barW = slot * 0.66;

  return (
    <svg
      role="img"
      aria-labelledby={titleId}
      viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: CHART_HEIGHT, display: 'block' }}
    >
      <title id={titleId}>Monthly volume over the last 12 months. Peak {max} messages.</title>
      {/* Y-axis grid lines — no labels, per D45 + D2. */}
      {[0.25, 0.5, 0.75].map((frac) => (
        <line
          key={frac}
          x1={PAD_X}
          x2={width - PAD_X}
          y1={PAD_TOP + innerH * frac}
          y2={PAD_TOP + innerH * frac}
          stroke={color.lineSoft}
          strokeWidth={0.4}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {points.map((p, i) => {
        const h = (p.volume / max) * innerH;
        const x = PAD_X + slot * i + (slot - barW) / 2;
        const y = PAD_TOP + (innerH - h);
        const isLast = i === points.length - 1;
        return (
          <g key={p.yearMonth}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(0.6, h)}
              fill={isLast ? color.primary : 'rgba(14,20,19,0.18)'}
              rx={0.6}
            />
            <text
              x={x + barW / 2}
              y={CHART_HEIGHT - 4}
              textAnchor="middle"
              fontFamily="var(--dm-font-mono)"
              fontSize={5}
              fill={color.fgMuted}
              style={{ letterSpacing: '0.05em' }}
            >
              {monthLabel(p.yearMonth)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function OpenRateLine({ points }: { points: TimeseriesPoint[] }) {
  const titleId = useId();
  if (points.length === 0) return <ChartEmpty />;
  const rates = points.map((p) => (p.volume > 0 ? p.opens / p.volume : 0));
  const max = Math.max(0.01, ...rates);
  const width = 100;
  const innerW = width - PAD_X * 2;
  const innerH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;
  const y = (v: number) => PAD_TOP + innerH - (v / max) * innerH;
  const pts = rates.map((v, i) => `${PAD_X + i * step},${y(v)}`);
  const last = rates[rates.length - 1] ?? 0;

  return (
    <svg
      role="img"
      aria-labelledby={titleId}
      viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: CHART_HEIGHT, display: 'block' }}
    >
      <title id={titleId}>
        Open rate over the last 12 months. Latest {Math.round(last * 100)}%.
      </title>
      {[0.25, 0.5, 0.75].map((frac) => (
        <line
          key={frac}
          x1={PAD_X}
          x2={width - PAD_X}
          y1={PAD_TOP + innerH * frac}
          y2={PAD_TOP + innerH * frac}
          stroke={color.lineSoft}
          strokeWidth={0.4}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color.primary}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {points.map((p, i) => {
        const cx = PAD_X + i * step;
        const cy = y(rates[i] ?? 0);
        return (
          <circle
            key={p.yearMonth}
            cx={cx}
            cy={cy}
            r={i === points.length - 1 ? 1.6 : 0.9}
            fill={i === points.length - 1 ? color.primary : color.fgMuted}
          />
        );
      })}
      {points.map((p, i) => (
        <text
          key={p.yearMonth}
          x={PAD_X + i * step}
          y={CHART_HEIGHT - 4}
          textAnchor="middle"
          fontFamily="var(--dm-font-mono)"
          fontSize={5}
          fill={color.fgMuted}
          style={{ letterSpacing: '0.05em' }}
        >
          {monthLabel(p.yearMonth)}
        </text>
      ))}
    </svg>
  );
}

function ChartEmpty() {
  return (
    <div
      style={{
        height: CHART_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: color.fgMuted,
        fontFamily: font.mono,
        fontSize: 11,
      }}
    >
      No data yet
    </div>
  );
}
