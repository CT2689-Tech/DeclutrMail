'use client';

import { tokens } from '@declutrmail/shared';

const { color, font, motion, text } = tokens;

/**
 * The screen's one count — "3 of 12" plus a thin bar.
 *
 * `total` is the longest the queue has been this session and `done` is
 * how many of those have left it. Both are read off the queue itself,
 * which only shrinks on a server-confirmed decision (D226), so the bar
 * can never run ahead of reality — and an Undo that returns a sender
 * walks it back.
 *
 * `current` is what the label counts: the focus card's position in
 * focus mode, the decisions made in list mode.
 */
export function SessionProgress({
  current,
  done,
  total,
  label,
}: {
  current: number;
  done: number;
  total: number;
  /** Accessible name — says what `current` counts. */
  label: string;
}) {
  if (total === 0) return null;
  const pct = Math.round((done / total) * 100);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: font.sans }}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={label}
        style={{
          width: 72,
          height: 3,
          borderRadius: 9999,
          background: color.line,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 9999,
            background: color.primary,
            transition: `width ${motion.base} ${motion.ease}`,
          }}
        />
      </div>
      <span
        style={{
          fontSize: text.sm,
          color: color.fgMuted,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {current} of {total}
      </span>
    </div>
  );
}
