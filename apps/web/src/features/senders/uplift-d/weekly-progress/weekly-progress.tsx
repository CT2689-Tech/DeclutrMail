'use client';
// apps/web/src/features/senders/uplift-d/weekly-progress/weekly-progress.tsx
//
// Variant D weekly-progress loop — retention surface per
// ~/.claude/plans/how-can-we-uplift-foamy-cloud.md §D1.
//
// Renders "THIS WEEK / N of M cleanup decisions done · ~Xh/year saved"
// with a thin teal progress bar. Information signal, not gamification —
// no badges, no streak indicators, no celebratory copy. The numbers
// update via fade-swap on the consumer side (parent re-renders w/ new
// counts); the component does not animate the digits per ADR-0010's
// explicit rejection of counter-tick.
//
// Lazy-promoted per ADR-0007 (feature-owned until 2nd consumer).

import type { ReactNode } from 'react';
import { tokens } from '@declutrmail/shared';

const { color, font, radius, shadow, text, space } = tokens;

export interface WeeklyProgressProps {
  /** Uppercase eyebrow — typically "This week". */
  label: ReactNode;
  /** Decisions completed so far this week. */
  done: number;
  /** Total decisions queued this week. */
  total: number;
  /**
   * Free-form caption following the progress sentence — e.g.
   * "Estimated savings so far: 3.1h/year".
   */
  caption?: ReactNode;
}

/**
 * Restrained progress strip — single line + thin bar. Hidden when total
 * is 0 (nothing to do this week → no need for a progress affordance).
 */
export function WeeklyProgress({ label, done, total, caption }: WeeklyProgressProps) {
  if (total === 0) return null;
  const pct = Math.min(100, Math.round((done / total) * 100));
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[5],
        padding: `${space[3]}px ${space[5]}px`,
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
        marginBottom: space[3],
        boxShadow: shadow.card,
        fontFamily: font.sans,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          style={{
            fontSize: text['2xs'],
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: color.fgMuted,
            fontWeight: 500,
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: 13.5, color: color.fg, fontWeight: 500 }}>
          <span style={{ color: color.primary, fontWeight: 600 }}>
            {done} of {total}
          </span>{' '}
          cleanup decisions done
          {caption != null && (
            <>
              {' · '}
              <span style={{ fontWeight: 400 }}>{caption}</span>
            </>
          )}
        </div>
      </div>
      <div
        style={{
          width: 220,
          height: 6,
          background: color.lineSoft,
          borderRadius: 3,
          overflow: 'hidden',
        }}
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${done} of ${total} cleanup decisions done`}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: `linear-gradient(to right, ${color.primary}, ${color.primaryDeep})`,
            borderRadius: 3,
            transition: 'width 250ms ease-out',
          }}
        />
      </div>
    </div>
  );
}
