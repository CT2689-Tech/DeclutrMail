'use client';

import { color } from '../tokens/tokens';

/** Tiny trend sparkline — line plus a faint area fill, the "live, watched" cue. */
export function Spark({
  values,
  width = 56,
  height = 18,
  color: stroke,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const line = stroke ?? color.fgMuted;
  const n = values.length;
  if (n === 0) return <svg width={width} height={height} aria-hidden="true" />;

  const max = Math.max(...values, 1);
  const step = n > 1 ? width / (n - 1) : 0;
  const y = (v: number) => height - (v / max) * (height - 2) - 1;
  const pts = values.map((v, i) => `${i * step},${y(v)}`);
  const last = values[n - 1] ?? 0;
  const area = `M ${pts.join(' L ')} L ${(n - 1) * step},${height} L 0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      style={{ overflow: 'visible', flexShrink: 0 }}
      aria-hidden="true"
    >
      <path d={area} fill={line} fillOpacity={0.12} stroke="none" />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={line}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={(n - 1) * step} cy={y(last)} r={2} fill={line} />
    </svg>
  );
}
