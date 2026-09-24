'use client';

import { tokens } from '@declutrmail/shared';
import { confidenceBand, scoredAgeLabel } from '@declutrmail/shared/copy';
import { useNow } from '@/lib/use-now';
import { fmtCompact, lastSeenLabel, type TriageDecisionRow } from './data';
import { verdictToVerb } from './types';

const { color, font, text } = tokens;

/**
 * The detail behind a triage decision (D36) — the expanded list row
 * and the focus card's "Why?" disclosure render the same block.
 *
 * At rest a sender shows identity, the verdict and a one-line "why".
 * This adds the engine's full reasoning with its confidence band and
 * age, the stats (volume, read, last-seen, received) and the
 * supporting signals.
 *
 * Privacy (D7 / D228): every field here is metadata. No body, no
 * snippet (the snippet belongs to messages, not to the sender-level
 * triage decision), no attachments. The signals are computed from
 * aggregates the engine already produces (read rate, volume, recency,
 * unsubscribe-method capability).
 */
export function TriageRowExpanded({ row }: { row: TriageDecisionRow }) {
  // `useNow`, not an ambient `new Date()`: this queue is server-rendered
  // and hydrated (`server-triage-boundary.tsx`), so a clock read during
  // render gives the server and the client two different answers across
  // any day boundary — "3 days ago" vs "4 days ago" is a hydration
  // mismatch on every expanded row. `null` until mount; the label is
  // decoration and can wait one tick.
  const now = useNow();
  const ageLabel =
    row.scoredAt !== undefined && now !== null ? scoredAgeLabel(row.scoredAt, new Date(now)) : null;
  // `null` means the sender sent nothing in the 90-day window, so there
  // is no denominator and no rate. This card used to print
  // `Math.round(null * 100)` — a confident "0% read" for a sender we
  // have measured nothing about, which is the strongest possible signal
  // under every low-engagement ranking we show.
  const readPct = row.readRate === null ? null : Math.round(row.readRate * 100);
  // The engine's confidence, as one word beside the verdict. A protected
  // row's recommendation is Keep BECAUSE of the protection — the raw
  // confidence belongs to the suppressed verdict, so printing it here
  // would mislead (2026-07-10: "Keep · 95%" where 95% was the
  // unsubscribe confidence).
  const band =
    row.protectionReason !== null ? 'protected' : confidenceBand(row.verdict, row.confidence);
  return (
    <div
      style={{
        padding: '16px 0 4px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        fontFamily: font.sans,
        textAlign: 'left',
      }}
    >
      {/* Full reasoning copy (D24) — the same string the engine writes
          to `triage_decisions.reasoning`. */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 6,
            fontSize: text.sm,
            color: color.fgMuted,
          }}
        >
          <span data-dm-verdict-band>
            Suggested: {verdictToVerb(row.verdict)}
            {band !== null && <> · {band}</>}
          </span>
          {/* The sentence below and the STATISTICS come from different
              moments: reasoning is stored at score time, the stats are
              recomputed on every request. Stating the age is what stops
              the two from reading as one measurement that contradicts
              itself (D25, founder 2026-08-19). Omitted entirely when
              unknown — the demo fixtures have no engine run behind them,
              and "Scored today" on a hand-written row is the same
              untruth. */}
          {ageLabel !== null && <span style={{ whiteSpace: 'nowrap' }}>{ageLabel}</span>}
        </div>
        <p style={{ fontSize: text.md, color: color.fg, margin: 0, lineHeight: 1.55 }}>
          {row.reasoning}
        </p>
      </div>

      {/* Stats — 4 numbers, tabular figures so they line up.
          `auto-fit`/`minmax` instead of a fixed 4-column track: a fixed
          track left a label like "Marked read 90d" with too little width
          at 375px and its window word orphaned onto its own line
          (QA-triage-20260827-10). Reflows with no JS/media hook, so
          there's no hydration-flash risk either. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 12,
        }}
      >
        {/* Names the window AND that it's derived: `monthlyVolume` is
            `round(last90dMessages / 3)` (data.ts), a 90-day-derived
            average, not a measured monthly count — a bare "per month"
            reads as one (QA-archive-20260828-01, Codex review). */}
        <Stat label="Per month, 90d avg" value={row.monthlyVolume.toLocaleString('en-US')} />
        {/* Names the window: this cell sits beside lifetime figures, so
            a bare rate reads as lifetime. "marked read", not "read
            rate" — matches the why-line's deliberate wording
            (QA-triage-20260827-07). */}
        <Stat
          label="Marked read, 90d"
          value={readPct === null ? '—' : `${readPct}%`}
          muted={readPct === null}
        />
        {/* Derived via `lastSeenLabel` so this can never contradict the
            why-line's quiet-90d copy (audit W3). */}
        <Stat label="Last seen" value={lastSeenLabel(row)} />
        {/* `totalAllTime` is a lifetime count sitting beside two 90d
            figures — label it so it doesn't read as sharing their window
            (QA-triage-20260827-10). */}
        <Stat label="Received all time" value={fmtCompact(row.totalAllTime)} />
      </div>

      {row.signals.length > 0 && (
        <ul
          aria-label="What we noticed"
          style={{
            margin: 0,
            padding: '0 0 0 16px',
            color: color.fgSoft,
            fontSize: text.sm,
            lineHeight: 1.6,
          }}
        >
          {row.signals.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontWeight: 600,
          fontSize: text.lg,
          letterSpacing: '-0.01em',
          color: muted ? color.fgMuted : color.fg,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: text.xs, color: color.fgMuted, marginTop: 4 }}>{label}</div>
    </div>
  );
}
