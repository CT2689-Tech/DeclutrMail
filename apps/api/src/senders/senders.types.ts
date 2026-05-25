// apps/api/src/senders/senders.types.ts — wire shapes for the Senders
// read endpoints (D39, D40, D44, D45, D46).
//
// Plain DTO module: no NestJS decorators, no class instances. The
// types are consumed end-to-end — the controller composes them, and
// the FE TanStack Query hooks (PR follow-up) import the same shapes
// from a future `@declutrmail/shared/contracts` re-export if they
// stabilize. Keeping them here at launch is the lightest move:
// expanding to a shared contract is a one-file copy + re-export.
//
// PRIVACY (D7, D228): every field is on the storage allowlist —
// sender identity, subject, Gmail-allowlisted `snippet`, dates,
// labels, read state, derived counts. NO body, NO attachments, NO
// non-allowlisted headers.

import type { TriageReasoningSource, TriageVerdict } from '@declutrmail/db';

/**
 * Bucketed month-over-month volume trend, computed BE-side from
 * `sender_timeseries`. Bucketed rather than raw % to avoid false
 * precision on small baselines (Codex review on the senders-tightening
 * brief) — `+47%` from a baseline of 2 messages is noise; `up` after
 * a sustained 3-month average is signal.
 *
 *   - `up`      — current month ≥ prior-3-month average × 1.3
 *   - `down`    — current month ≤ prior-3-month average × 0.7
 *   - `steady`  — otherwise (within ±30% of prior average)
 *   - `dormant` — current month is 0 and prior average > 0
 *   - `new`     — fewer than 2 completed months of history
 *
 * `null` indicates no timeseries data at all (sync hasn't run); the FE
 * surfaces this as a quiet "—" rather than picking a misleading bucket.
 */
export type VolumeTrendBucket = 'new' | 'up' | 'down' | 'steady' | 'dormant';

/**
 * Summary of the most-recent triage decision for a sender. Surfaces on
 * the Sender Detail header as a "Last reviewed …" eyebrow so users can
 * see whether a stale recommendation is being shown. Each field is
 * `null` when no `triage_decisions` row exists for `(mailbox, sender)`
 * yet — the FE renders "Never reviewed" in that case.
 *
 * The wire deliberately uses the neutral "reviewed" vocabulary at the
 * UI seam (rather than "decided") because `generatedBy = 'template'`
 * means an auto-template fired the verdict without explicit user
 * action; calling that "decided" overstates user agency. The wire
 * still passes the raw `generatedBy` through so the FE can colour or
 * caveat the eyebrow if it wants to distinguish LLM vs template
 * provenance later.
 */
export interface LastReview {
  /** ISO-8601 — `triage_decisions.produced_at` of the most recent row. */
  at: string;
  /** Verdict that engine settled on. */
  verdict: TriageVerdict;
  /** Provenance — LLM call vs deterministic template fallback. */
  generatedBy: TriageReasoningSource;
}

/**
 * Gmail's own category enum mirrored from the `gmail_category` Postgres
 * enum. Kept in sync with `packages/db/src/schema/senders.ts` — adding
 * a value requires touching both the migration and this union (one
 * source of truth per type-design principle).
 */
export type GmailCategory = 'primary' | 'promotions' | 'social' | 'updates' | 'forums';

/**
 * Derived unsubscribe capability (D9, RFC 8058). Mirror of the
 * `gmail_unsubscribe_method` enum. NULL on the wire when the sender
 * has not yet been indexed by `building_sender_index` (D224) — the
 * column is nullable until the stage runs.
 */
export type UnsubscribeMethod = 'one_click' | 'mailto' | 'none';

/**
 * One row in `GET /api/senders` — the list-page shape (D39).
 *
 * `monthlyVolume` is the most-recent month's `sender_timeseries.volume`
 * (not a 12-month average) — drives the "47/mo" cadence label on the
 * Senders screen. NULL when the sender has no timeseries rows yet
 * (sync hasn't materialized the rollup); the FE renders that as a "—".
 *
 * `readRate` is `read_count / volume` over the most recent month —
 * 0..1 with 2-decimal precision. NULL when `volume = 0` (cannot divide).
 */
export interface SenderListRow {
  id: string;
  displayName: string;
  email: string;
  domain: string;
  gmailCategory: GmailCategory;
  /** ISO-8601 — earliest `internal_date` we've seen for this sender. */
  firstSeenAt: string;
  /** ISO-8601 — latest `internal_date` we've seen for this sender. */
  lastSeenAt: string;
  monthlyVolume: number | null;
  readRate: number | null;
  /**
   * Bucketed month-over-month volume trend — see `VolumeTrendBucket`.
   * `null` when there's no timeseries data at all (sync hasn't run).
   * Drives the trend chip on the Senders row evidence line.
   */
  volumeTrend: VolumeTrendBucket | null;
  unsubscribeMethod: UnsubscribeMethod | null;
  /**
   * Summary of the most-recent triage decision for this sender —
   * powers the "Last reviewed …" eyebrow on the Sender Detail header
   * AND lets the Senders row decide whether to render a stale-decision
   * cue. `null` when the engine has never produced a decision for
   * (mailbox, sender).
   */
  lastReview: LastReview | null;
}

/**
 * Standing protection / VIP flags for `GET /api/senders/:id` (D42).
 *
 * `isProtected`, `isVip`, `protectionReason`, and `protectionSetAt`
 * mirror the columns on `sender_policies`. NULL `protectionReason`
 * and `protectionSetAt` are valid when `isProtected = false` —
 * documented at the schema column.
 */
export interface ProtectionFlags {
  isVip: boolean;
  isProtected: boolean;
  protectionReason: 'user_defined' | 'engagement_based' | 'vip' | null;
  /** ISO-8601 — when `is_protected` last flipped true; null otherwise. */
  protectionSetAt: string | null;
}

/**
 * `GET /api/senders/:id` — the detail shape (D39, D40).
 *
 * Composes the list row with the standing-policy flags. The FE's
 * `SenderDetail` model is richer (recent messages, stats strip,
 * timeseries, history) — those are intentionally separate endpoints
 * so a slow sender (e.g. one with thousands of messages) doesn't
 * tax the header render path.
 */
export interface SenderDetail extends SenderListRow {
  protectionFlags: ProtectionFlags;
}

/**
 * One row in `GET /api/senders/:id/messages` (D46 — recent-messages
 * strip on Sender Detail).
 *
 * Allowlist: sender (implicit — the route is per-sender), subject,
 * snippet, dates, labels, read state. `providerMessageId` powers the
 * D41/D231 open-in-Gmail deep link; `providerThreadId` is the
 * inbox-deep-link fallback.
 */
export interface MailMessageRow {
  id: string;
  providerMessageId: string;
  providerThreadId: string;
  subject: string;
  /** Gmail's `snippet` — the only body-adjacent field allowlisted (D7). */
  snippet: string;
  /** ISO-8601 received-at — Gmail's `internalDate`. */
  internalDate: string;
  isUnread: boolean;
}

/**
 * One point in `GET /api/senders/:id/timeseries` — past 12 calendar
 * months (D39 — volume + read-rate sparklines on Sender Detail).
 *
 * `yearMonth` is `YYYY-MM` (the FE x-axis key); the underlying
 * `sender_timeseries.year_month` column is a `date` whose value is
 * the first day of the month — we project just the year-month
 * portion so the wire is stable across timezones.
 *
 * `readCount` is messages that month WITHOUT the UNREAD label. The
 * column was originally drafted as `opens` in the D-plan; the rename
 * (read-proxy, not actual opens — Gmail has no open events) is
 * documented on `sender_timeseries` schema. The FE computes read-rate
 * as `readCount / volume` (or "—" when `volume = 0`).
 */
export interface TimeseriesPoint {
  yearMonth: string;
  volume: number;
  readCount: number;
}

/**
 * One row in `GET /api/senders/:id/history` (D46 — decision history
 * popover on Sender Detail).
 *
 * Sourced from `triage_decisions`. Per ADR-0008, the senders read
 * service reads `triage_decisions` directly at launch (pragmatic
 * exception flagged for ratification once triage feature grows past
 * its single-table footprint).
 *
 * The current schema enforces ONE row per (mailbox, sender) — the
 * cursor is therefore future-proofing for when the engine retains
 * decision history (a planned `triage_decision_history` table; see
 * `triage-decisions.ts` schema header). Pagination today returns at
 * most one row but the contract stays uniform with the rest of the
 * list endpoints.
 */
export interface DecisionHistoryRow {
  id: string;
  verdict: TriageVerdict;
  /** 0..1, 2-decimal precision (mirrors `numeric(3,2)` storage). */
  confidence: number;
  /** ISO-8601 — engine compute time. */
  producedAt: string;
  /** Human-readable explanation (LLM or template — see `generatedBy`). */
  reasoning: string;
  /** Provenance of `reasoning` — LLM call vs template fallback. */
  generatedBy: TriageReasoningSource;
}
