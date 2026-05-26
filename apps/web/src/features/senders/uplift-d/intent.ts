// apps/web/src/features/senders/uplift-d/intent.ts
//
// Variant D intent-grouping helper per ADR-0012 (Senders intent-grouped
// tables — amends D38/D39).
//
// Lazy-promoted per ADR-0007: lives in feature dir until a second
// consumer (Activity, Brief, future Insights) needs the same disposition
// bucketing. At that point this file moves to packages/shared/ and the
// import path updates in this PR's same commit.
//
// Bucketing rules (derived from existing Sender fields — NO ML, no new
// schema, no new wire data; D222 is honored):
//
//   - cleanup  = lastReview.verdict === 'unsubscribe'
//   - later    = lastReview.verdict === 'archive'
//   - protect  = sender.protected === true  (VIP signal not yet on the
//               list wire shape; when D200 surfaces protectionFlags.isVip
//               on the list endpoint, extend this branch to OR-in isVip)
//   - people   = everything else (no recommendation, not protected)
//
// Group ordering is fixed; see INTENT_ORDER below. The Senders list
// renders groups in this order with the first group (cleanup) auto-
// expanded.

import type { Sender } from '../data';

export type SenderIntent = 'cleanup' | 'later' | 'protect' | 'people';

/**
 * Fixed group ordering for the Variant D senders list. Cleanup first
 * because it carries the highest-priority decisions; people last
 * because it's the longest-tail "keep watching" bucket.
 */
export const INTENT_ORDER: readonly SenderIntent[] = [
  'cleanup',
  'later',
  'protect',
  'people',
] as const;

/**
 * UI metadata per intent group. Copy is audited against D209 forbidden
 * words; `description` strings carry the ADR-0011 editorial relaxation
 * (descriptive, not promotional).
 */
export interface IntentMeta {
  /** Display label. */
  label: string;
  /** One-line description rendered under the label. */
  description: string;
  /** Single-character icon glyph for the group header chip. */
  icon: string;
  /**
   * Accent tone — drives the noise-stripe gradient color. Maps to
   * existing semantic tokens (amber for action-needed, fg for neutral,
   * emerald for safety, teal for relationship).
   */
  accent: 'amber' | 'fg' | 'emerald' | 'teal';
}

export const INTENT_META: Record<SenderIntent, IntentMeta> = {
  cleanup: {
    label: 'Clean up',
    description: 'Senders we think you can let go',
    icon: '↘',
    accent: 'amber',
  },
  later: {
    label: 'Move later',
    description: 'Out of inbox, still here when you need them',
    icon: '↗',
    accent: 'fg',
  },
  protect: {
    label: 'Protect',
    description: 'Always-keep · receipts, VIPs, important threads',
    icon: '◆',
    accent: 'emerald',
  },
  people: {
    label: 'People',
    description: 'Folks and tools you stay in touch with',
    icon: '◯',
    accent: 'teal',
  },
};

/**
 * Confidence threshold below which an engine verdict is treated as
 * "not sure" — the sender stays in the catch-all bucket instead of
 * surfacing as a Cleanup / Move-later recommendation the engine isn't
 * confident about.
 *
 * Rationale (founder Q "if we are not sure about something, would we
 * avoid surfacing recommended action?"): yes. Cascade Phase B
 * (`insufficient_signal`) returns confidence 0.70; Phase C fallback
 * (`score_inconclusive`) returns 0.60. Both fall below the 0.75 gate,
 * so an unsure recommendation does NOT pressure the user — they see
 * the sender unbucketed and decide cold.
 *
 * High-confidence Phase A rules (replied, gmail_primary, starred,
 * high_read_rate) score 0.80-1.00 and pass the gate cleanly.
 */
export const ENGINE_CONFIDENCE_GATE = 0.75;

/**
 * Bucket a single sender into its intent group. Returns 'people' when
 * the sender has no engine recommendation (or has one below the
 * confidence gate) and is not protected — the 'people' bucket is the
 * catch-all middle. Pure function, no side effects, deterministic on
 * the input.
 *
 * Confidence handling: when `lastReview.confidence` is missing (older
 * wire payloads — the field is optional per `SenderLastReview`), we
 * default to 1.0 = full confidence, preserving the prior behavior. BE
 * follow-up will populate the field from `triage_decisions.confidence`.
 */
export function intentOf(s: Pick<Sender, 'lastReview' | 'protected'>): SenderIntent {
  // Protected always wins — user-pinned standing policy beats any
  // engine recommendation.
  if (s.protected === true) return 'protect';

  // Confidence gate: low-confidence verdicts are NOT surfaced as
  // action buckets. Sender stays in catch-all so user decides cold.
  const confidence = s.lastReview?.confidence ?? 1.0;
  const verdict = confidence >= ENGINE_CONFIDENCE_GATE ? s.lastReview?.verdict : undefined;

  if (verdict === 'unsubscribe') return 'cleanup';
  if (verdict === 'archive') return 'later';
  return 'people';
}

/**
 * Group a list of senders by intent, preserving INTENT_ORDER on the
 * output. Empty groups are kept in the result so consumers can render
 * "0 senders" affordances or skip them — the helper is presentation-
 * agnostic.
 */
export interface IntentBucket {
  intent: SenderIntent;
  meta: IntentMeta;
  items: Sender[];
}

export function groupByIntent(senders: readonly Sender[]): IntentBucket[] {
  const buckets: Record<SenderIntent, Sender[]> = {
    cleanup: [],
    later: [],
    protect: [],
    people: [],
  };
  for (const s of senders) {
    buckets[intentOf(s)].push(s);
  }
  return INTENT_ORDER.map((intent) => ({
    intent,
    meta: INTENT_META[intent],
    items: buckets[intent],
  }));
}
