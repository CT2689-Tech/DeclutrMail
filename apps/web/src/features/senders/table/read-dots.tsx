'use client';

import { tokens } from '@declutrmail/shared';

const { color, font } = tokens;

/** Read-rate as five dots — or a red "0%" pill when never opened. */
export function ReadDots({ rate }: { rate: number }) {
  if (rate === 0) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '1px 6px',
          borderRadius: 9999,
          background: color.redBg,
          color: color.red,
          fontFamily: font.mono,
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.06em',
        }}
      >
        0%
      </span>
    );
  }
  const filled = Math.round(rate * 5);
  const dotColor = rate < 0.2 ? color.amber : rate < 0.5 ? color.fgMuted : color.emerald;
  return (
    <span style={{ display: 'inline-flex', gap: 2.5, alignItems: 'center' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: 9999,
            background: i < filled ? dotColor : color.mutedBg,
          }}
        />
      ))}
    </span>
  );
}
