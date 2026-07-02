'use client';

import { tokens } from '@declutrmail/shared';
import { fmtCompact, lastSeenLabel, type TriageDecisionRow } from './data';

const { color, font } = tokens;

/**
 * Expanded content for a triage row (D36).
 *
 * The collapsed row shows the critical info — sender identity,
 * verdict pill, a one-line "why". This expanded panel adds the full
 * stats grid (volume, read, last-seen, lifetime), the engine's full
 * reasoning copy, and the bullet list of supporting signals.
 *
 * Privacy (D7 / D228): every field here is metadata. No body, no
 * snippet (the snippet belongs to messages, not to the sender-level
 * triage decision), no attachments. The signals are computed from
 * aggregates the engine already produces (read rate, volume, recency,
 * unsubscribe-method capability).
 */
export function TriageRowExpanded({ row }: { row: TriageDecisionRow }) {
  const readPct = Math.round(row.readRate * 100);
  return (
    <div
      style={{
        padding: '14px 18px 18px',
        background: 'rgba(14,20,19,0.018)',
        borderTop: `1px solid ${color.lineSoft}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        fontFamily: font.sans,
      }}
    >
      {/* Stats grid — 4 numbers, mono tabular figures so they line up. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 12,
        }}
      >
        <Stat label="per month" value={row.monthlyVolume.toLocaleString()} />
        <Stat
          label="read rate"
          value={`${readPct}%`}
          valueColor={
            row.readRate >= 0.5 ? color.primary : row.readRate >= 0.2 ? color.fg : color.amber
          }
        />
        {/* Derived via `lastSeenLabel` so this card can never
            contradict the collapsed row's quiet-90d copy (audit W3). */}
        <Stat label="last seen" value={lastSeenLabel(row)} />
        <Stat label="all-time" value={fmtCompact(row.totalAllTime)} />
      </div>

      {/* Full reasoning copy (D24) — the same string the engine writes
          to `triage_decisions.reasoning`. */}
      <div
        style={{
          padding: '10px 12px',
          background: color.card,
          border: `1px solid ${color.line}`,
          borderRadius: 9,
        }}
      >
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 9.5,
            fontWeight: 600,
            color: color.fgMuted,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          Reasoning
        </div>
        <p style={{ fontSize: 12.5, color: color.fg, margin: 0, lineHeight: 1.55 }}>
          {row.reasoning}
        </p>
      </div>

      {/* Signals — bullet list. */}
      <div>
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 9.5,
            fontWeight: 600,
            color: color.fgMuted,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: 6,
          }}
        >
          Supporting signals
        </div>
        <ul
          style={{
            margin: 0,
            padding: '0 0 0 16px',
            color: color.fgSoft,
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {row.signals.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  valueColor = color.fg,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 9,
        padding: '8px 10px',
      }}
    >
      <div
        style={{
          fontFamily: font.mono,
          fontWeight: 700,
          fontSize: 15,
          letterSpacing: '-0.012em',
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: font.sans,
          fontSize: 9.5,
          color: color.fgMuted,
          marginTop: 2,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
    </div>
  );
}
