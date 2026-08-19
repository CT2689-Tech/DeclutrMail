'use client';

/**
 * Fact language — ONE vocabulary + tone rule for the bucketed sender
 * facts every Senders surface renders (grid card, table row, detail
 * stats strip).
 *
 * Why this module exists: by 2026-07-03 the same two facts had three
 * dialects. Volume trend rendered `up` as amber on the table but
 * primary on the detail stats strip (opposite tones for the same
 * fact), and used emerald — the A3 trust/privacy hue — for `down`.
 * Read-state rendered as red/green pills on the table (both hues
 * outside the ADR-0016 A3 accent map) but as a raw percentage on the
 * card. This module is the single source both consume.
 *
 * Tone rules (ADR-0016 A3 — no new hues, no off-map hues):
 *   - `amber`  = unsubscribe-action-available. `up` (volume
 *     pressure building) and `Never` read (the cleanup scent) earn it.
 *   - `primary`= notable-but-safe. `new` sender only.
 *   - everything else is neutral (`fg` / `fgMuted`) — facts, calmly.
 *
 * Precision rule (senders-tightening v2 brief, Codex-reviewed): LIST
 * surfaces (card, table row) speak BUCKETS — raw percentages are
 * false precision on small baselines. DETAIL surfaces (stats strip,
 * expanded panel stat cards) may speak exact numbers because the
 * volume context is on screen next to them.
 */

import { tokens } from '@declutrmail/shared';
import type { VolumeTrendBucket } from '@/lib/api/senders';

const { color, font, text } = tokens;

/** Canonical glyph + label + fg tone per trend bucket. */
export const TREND_FACT: Record<VolumeTrendBucket, { glyph: string; label: string; fg: string }> = {
  up: { glyph: '↑', label: 'Up', fg: color.amber },
  down: { glyph: '↓', label: 'Down', fg: color.fgMuted },
  steady: { glyph: '—', label: 'Steady', fg: color.fgMuted },
  quiet: { glyph: '◐', label: 'Quiet', fg: color.fgMuted },
  dormant: { glyph: '○', label: 'Dormant', fg: color.fgMuted },
  new: { glyph: '•', label: 'New', fg: color.primary },
};

/**
 * Trend as plain mono text (no pill chrome — two pill columns side by
 * side read as noise; the glyph is the differentiator). `null` = no
 * timeseries history → em-dash placeholder at the same size.
 */
export function TrendChip({ bucket }: { bucket: VolumeTrendBucket | null }) {
  if (bucket === null) {
    return (
      <span aria-label="No trend data" style={{ color: color.fgMuted }}>
        —
      </span>
    );
  }
  const fact = TREND_FACT[bucket];
  return (
    <span
      aria-label={`Trend: ${fact.label}`}
      style={{
        fontFamily: font.mono,
        fontSize: text.xs,
        fontWeight: 600,
        color: fact.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {fact.glyph} {fact.label}
    </span>
  );
}

/**
 * Read rate as a display percentage, never rounding a real signal down
 * to a flat `0`. A sender with 1 read in 250 is `<1`, not `0` — the
 * difference between "we measured almost none" and "we measured none" is
 * the whole point of the number.
 */
export function formatReadRatePct(rate: number): string {
  const pct = rate * 100;
  if (pct > 0 && pct < 1) return '<1';
  return String(Math.round(pct));
}

/**
 * Read-state bucket for LIST surfaces. Thresholds follow the
 * tightening-brief vocabulary the table shipped with:
 *   0 → None · (0, .30) → Low · [.30, .70) → Mid · [.70, 1] → High
 *
 * `None` is amber (unread bulk = the action-available signal, A3);
 * `High` is solid `fg` (quietly healthy); Low/Mid muted. No pills.
 *
 * Every label describes a ROLLING 30-DAY window (the API's `readRate` is
 * `last30dReadCount / last30dMsgs`), which is why the top bucket says
 * "None" and the aria names the window. It said **"Never"** with an aria
 * of "never marked read" — an absolute, lifetime claim drawn from 30 days
 * of data. On the founder's mailbox that labelled 332 of 615 active
 * senders, including one read 96.5% of the time since 2017 (FINDINGS
 * F008). A percentage can be repaired with a window suffix; the word
 * "Never" could not, so the word had to go.
 */
export function readBucket(rate: number): { label: string; fg: string; aria: string } {
  if (rate === 0) {
    return { label: 'None', fg: color.amber, aria: 'Read rate: none in the last 30 days' };
  }
  if (rate < 0.3) return { label: 'Low', fg: color.fgMuted, aria: 'Read rate: low, last 30 days' };
  if (rate < 0.7) return { label: 'Mid', fg: color.fgMuted, aria: 'Read rate: mid, last 30 days' };
  return { label: 'High', fg: color.fg, aria: 'Read rate: high, last 30 days' };
}

/** Read bucket as plain mono text; `null` = no timeseries yet. */
export function ReadBucketText({ rate }: { rate: number | null }) {
  if (rate === null) return <span style={{ color: color.fgMuted }}>—</span>;
  const bucket = readBucket(rate);
  return (
    <span
      aria-label={bucket.aria}
      style={{
        fontFamily: font.mono,
        fontSize: text.sm,
        fontWeight: 600,
        color: bucket.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {bucket.label}
    </span>
  );
}
