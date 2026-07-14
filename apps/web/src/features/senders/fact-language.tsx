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
 * Read-state bucket for LIST surfaces. Thresholds follow the
 * tightening-brief vocabulary the table shipped with:
 *   0 → Never · (0, .30) → Low · [.30, .70) → Mid · [.70, 1] → High
 *
 * `Never` is amber (unread bulk = the action-available signal, A3);
 * `High` is solid `fg` (quietly healthy); Low/Mid muted. No pills.
 */
export function readBucket(rate: number): { label: string; fg: string; aria: string } {
  if (rate === 0) {
    return { label: 'Never', fg: color.amber, aria: 'Read rate: never marked read' };
  }
  if (rate < 0.3) return { label: 'Low', fg: color.fgMuted, aria: 'Read rate: low' };
  if (rate < 0.7) return { label: 'Mid', fg: color.fgMuted, aria: 'Read rate: mid' };
  return { label: 'High', fg: color.fg, aria: 'Read rate: high' };
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
