/**
 * Sender Detail — closed unions and shared types for the page.
 *
 * Per MISTAKES.md (2026-05-20 entry): model closed value sets as
 * union types so producer/consumer mismatches fail at `tsc`. The
 * `Verdict` and `ProtectionReason` types below are intentionally
 * narrow — no `string` fallback.
 */

import type { Sender } from '../data';

/**
 * The closed set of recommendation verdicts the engine can emit on
 * Sender Detail. `null` (no recommendation) is handled at the
 * component layer, not in this union.
 *
 * Note: this is the engine's recommended action, NOT a category
 * prediction. D222 bans category prediction permanently — verdicts
 * are derived from observed signals (read rate, volume, recency),
 * not from learned class labels.
 */
export type Verdict = 'keep' | 'archive' | 'unsubscribe' | 'later';

/**
 * Why a sender is protected. Each variant has a different copy in
 * the header tooltip and the recommendation banner.
 *
 * VIP is a SEPARATE standing policy (D42, D43) — its own header chip
 * and its own tooltip — never a protection reason.
 */
export type ProtectionReason =
  | 'user-marked' // founder toggled Protect on
  | 'auto-receipts' // receipts / statements auto-protected (default)
  | 'auto-financial'; // financial-institution sender auto-protected

/**
 * Source of a decision-history row (D46).
 *
 * Mirrors `activity_log.source` enum — kept narrow so a stale
 * literal in a fixture fails to typecheck rather than silently
 * widening the union.
 */
export type DecisionSource = 'You' | 'Triage' | 'Manual' | 'Autopilot' | 'Screener' | 'System';

/**
 * Past-tense action labels surfaced in the decision-history list.
 * The set spans all V2 actions (D46) — including VIP/Protect toggles
 * and the lifecycle actions (Restored, Snoozed).
 */
export type DecisionAction =
  | 'Archived'
  | 'Kept'
  | 'Unsubscribed'
  | 'Moved to Later'
  | 'Marked VIP'
  | 'Unmarked VIP'
  | 'Protected'
  | 'Unprotected'
  | 'Restored';

/** A single decision-history row from `activity_log`. */
export interface DecisionHistoryRow {
  id: string;
  /** ISO-8601 — relative-formatted in the UI for ≤7d, absolute beyond. */
  at: string;
  source: DecisionSource;
  action: DecisionAction;
  /** Email count for bulk actions (e.g. Archive cleared 47 messages). */
  count?: number;
  /** Operation ID in mono — tooltip on hover. */
  opId: string;
  /** When undo is still available (≤7d window). */
  undoExpiresAt?: string;
}

/** Recommendation banner payload, returned by the engine per sender. */
export interface Recommendation {
  verdict: Verdict;
  /** 0–1, displayed as percentage. ≥0.85 highlights the verb (D31). */
  confidence: number;
  /** One-sentence rationale — shown inline + in the popover header. */
  reasoning: string;
  /** Supporting signals — bullet list in the popover. */
  signals: string[];
}

/**
 * Single recent-message row. NO body / NO HTML — sender + subject +
 * snippet + dates only, per D7. Open-in-Gmail uses `providerMessageId`.
 */
export interface RecentMessage {
  id: string;
  /** Gmail message id — used by `GmailOpenLinkService` (D231). */
  providerMessageId: string;
  /** Gmail thread id — used for the inbox deep link fallback. */
  threadId: string;
  subject: string;
  /** Gmail's preview snippet — the only body-adjacent field allowed. */
  snippet: string;
  /** ISO-8601 received-at — relative-formatted in the UI. */
  receivedAt: string;
  /** Bytes — surfaced as a compact KB label. */
  sizeBytes: number;
  hasAttachment: boolean;
  unread: boolean;
}

/** A single (year, month) data point for the volume + open-rate charts. */
export interface TimeseriesPoint {
  /** YYYY-MM — the chart x-axis key. */
  yearMonth: string;
  /** Total messages received in the month. */
  volume: number;
  /** Number of opens — open-rate is `opens / volume`. */
  opens: number;
}

/** Aggregated stats strip data (D44 — 5 numbers). */
export interface SenderStats {
  /** Most-recent monthly cadence — e.g. 47/mo. */
  monthlyVolume: number;
  /** 0–1 read rate. */
  readRate: number;
  /** Relationship age in months. */
  relationshipMonths: number;
  /** Days since the most recent message. */
  lastSeenDays: number;
  /** Lifetime received count from this sender. */
  totalAllTime: number;
}

/**
 * The full Sender Detail page model. Composed at the API boundary
 * and consumed by the page component. Keeping it as a single value
 * makes the loading / error / empty branches trivial to express.
 */
export interface SenderDetail {
  sender: Sender;
  /** Verbose Gmail-side category — e.g. "Gmail: Social". */
  gmailCategory: string;
  isVip: boolean;
  isProtected: boolean;
  /** Why the sender is protected — only set when `isProtected` is true. */
  protectionReason: ProtectionReason | null;
  /** Engine recommendation. `null` = no recommendation (VIP / Protected). */
  recommendation: Recommendation | null;
  recentMessages: RecentMessage[];
  stats: SenderStats;
  timeseries: TimeseriesPoint[];
  history: DecisionHistoryRow[];
}

/** Page-level loading / error / empty state. Closed union — no `string`. */
export type SenderDetailState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; detail: SenderDetail };
