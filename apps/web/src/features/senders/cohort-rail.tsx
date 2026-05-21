'use client';

import { tokens } from '@declutrmail/shared';
import type { Cohort } from './data';

const { color, font } = tokens;

/**
 * Standing behavioural cohorts surfaced as one-tap smart selections —
 * tapping a chip selects the matching senders and lights the bulk bar.
 */
export function CohortRail({
  cohorts,
  onApply,
}: {
  cohorts: Cohort[];
  onApply: (cohort: Cohort) => void;
}) {
  if (cohorts.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '10px 12px',
        background: color.paper,
        border: `1px solid ${color.line}`,
        borderRadius: 9,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: font.mono,
          fontSize: 10,
          fontWeight: 600,
          color: color.fgMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          whiteSpace: 'nowrap',
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        Cohorts
      </span>
      {cohorts.map((c) => {
        const fg = c.tone === 'warn' ? color.amber : color.primary;
        return (
          <button
            key={c.id}
            onClick={() => onApply(c)}
            title={`Select all ${c.ids.length} — then choose an action`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '5px 11px',
              background: c.tone === 'warn' ? color.amberBg : color.primarySoft,
              color: fg,
              border: `1px solid ${c.tone === 'warn' ? 'rgba(180,83,9,0.30)' : color.primaryBorder}`,
              borderRadius: 9999,
              fontFamily: font.sans,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <span>{c.label}</span>
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 10,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                background: color.card,
                color: fg,
                padding: '1px 6px',
                borderRadius: 9999,
              }}
            >
              {c.ids.length}
            </span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
