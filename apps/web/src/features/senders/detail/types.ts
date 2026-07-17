/**
 * Sender Detail — closed unions and shared types for the page.
 *
 * Per MISTAKES.md (2026-05-20 entry): model closed value sets as
 * union types so producer/consumer mismatches fail at `tsc`. The
 * `Verdict` and `ProtectionReason` types below are intentionally
 * narrow — no `string` fallback.
 */

import type { UnsubscribeLifecycleStatus } from '@declutrmail/shared/contracts';
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
 */
export type ProtectionReason =
  | 'user-marked' // user toggled Protect on
  | 'replied' // user replied at least three times
  | 'starred' // user starred a message in the past year
  | 'gmail-important'; // Gmail marked ≥3 recent messages important, sender in Primary

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
 * The set spans all V2 actions (D46) — including Protect toggles
 * and the lifecycle actions (Restored, Snoozed).
 */
export type DecisionAction =
  | 'Archived'
  | 'Kept'
  | 'Unsubscribe requested'
  | 'Moved to Later'
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

/** Optional secondary suggestion payload, returned by the engine per sender. */
export interface Recommendation {
  verdict: Verdict;
  /** 0–1 engine metadata. D245 forbids using it to select or style actions. */
  confidence: number;
  /** One-sentence factual basis shown only inside the optional disclosure. */
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
  /**
   * Bytes — surfaced as a compact KB / MB label. `null` for rows synced
   * before ADR-0021 (D7 storage-allowlist amendment, 2026-06-06) OR
   * rows where Gmail omitted `sizeEstimate`; the renderer shows an
   * em-dash on null rather than a misleading "0B".
   */
  sizeBytes: number | null;
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

/**
 * Aggregated stats strip data (D44).
 *
 * Reshape pass (senders-tightening v2 brief):
 *   - `totalAllTime` removed — it was synthesized (`monthly × months`)
 *     and therefore misleading. The 12-month chart already carries
 *     lifetime context; we don't need a fake aggregate.
 *   - `readRate` demoted from a headline cell to a secondary line
 *     under the chart (rendered by the chart component). Stays on
 *     this shape for callers that still surface it caveated.
 *   - `volumeTrend` added — bucketed MoM trend. Drives the trend
 *     cell on the stats strip + the chip on the row evidence line.
 */
export interface SenderStats {
  /** Most-recent monthly cadence — e.g. 47/mo. */
  monthlyVolume: number;
  /**
   * Read-state proxy — 0..1. Gmail `!UNREAD` flag rate, NOT real
   * opens. The detail surface MUST label this as "marked read" and
   * explicitly caveat the source; never call it "opens" or
   * "opened" — Gmail exposes no open events. `null` when the sender
   * has no timeseries yet — renders as "—", never a fabricated 0%.
   */
  readRate: number | null;
  /** Relationship age in months. */
  relationshipMonths: number;
  /** Days since the most recent message. */
  lastSeenDays: number;
  /**
   * Bucketed MoM trend. `null` when there's no timeseries history
   * — the stats strip renders a quiet "—" cell rather than a
   * misleading bucket. Mirrors `Sender.volumeTrend`.
   */
  volumeTrend: 'new' | 'up' | 'down' | 'steady' | 'quiet' | 'dormant' | null;
}

/**
 * The full Sender Detail page model. Composed at the API boundary
 * and consumed by the page component. Keeping it as a single value
 * makes the loading / error / empty branches trivial to express.
 */
export interface SenderDetail {
  sender: Sender;
  /**
   * Sender email address from the wire DTO. Used by the "Open all in
   * Gmail" deep link (FOUNDER-FOLLOWUPS 2026-06-06 Q3.2). Kept on the
   * Detail model rather than `Sender` because the senders-grid avatar
   * row doesn't render the address; only Detail does.
   */
  email: string;
  /** Verbose Gmail-side category — e.g. "Gmail: Social". */
  gmailCategory: string;
  isProtected: boolean;
  /** Why the sender is protected — only set when `isProtected` is true. */
  protectionReason: ProtectionReason | null;
  /**
   * Standing policy applied to future mail from this sender, if any.
   *
   * `'unsubscribe'` powers the "Unsub queued" pill in the page header
   * (FOUNDER-FOLLOWUPS 2026-06-05) — visible AFTER the user invokes
   * Unsubscribe but BEFORE Gmail's RFC 8058 endpoint resolves the
   * removal. The pill mirrors the senders-list row so the user knows
   * the request is in flight regardless of which surface they land on.
   *
   * `null` = no standing policy. Observed facts still drive the primary action.
   */
  policyType: 'keep' | 'archive' | 'unsubscribe' | 'later' | null;
  /**
   * Truthful unsubscribe lifecycle (D9/D245); `null` means no recorded
   * unsubscribe intent yet.
   */
  unsubStatus: UnsubscribeLifecycleStatus | null;
  /**
   * The sender's unsubscribe channel (ADR-0006 derivation). Drives
   * which post-intent affordance the page renders.
   */
  unsubscribeMethod: 'one_click' | 'mailto' | 'none' | null;
  /**
   * Raw `mailto:` List-Unsubscribe URL (D230 manual path) — parsed
   * into the Gmail compose deep link by the persistent "Finish in
   * Gmail" callout. `null` unless `unsubscribeMethod === 'mailto'`.
   */
  unsubscribeMailtoUrl: string | null;
  /** Optional engine suggestion. `null` for Protected senders. */
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
