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
 *   - `new`     — `first_seen_at >= now - NEW_DAYS`; wins over all
 *                  other buckets (no prior period to compare against)
 *   - `up`      — recent-window rate ≥ baseline rate × `UP_MULTIPLIER`
 *   - `down`    — recent-window rate ≤ baseline rate × `DOWN_MULTIPLIER`
 *   - `steady`  — otherwise (within multipliers, both rates non-zero)
 *   - `quiet`   — silent ≥ `QUIET_DAYS` but < `DORMANT_DAYS` AND
 *                  recurring (`totalReceived ≥ RECURRING_MIN_TOTAL`)
 *   - `dormant` — silent ≥ `DORMANT_DAYS` AND recurring
 *
 * `null` indicates a one-shot ancient sender with nothing meaningful
 * to show; the FE surfaces this as a quiet "—" rather than picking a
 * misleading bucket. All thresholds live in `@declutrmail/shared/senders`
 * (`WINDOWS`, `VOLUMES`, `TREND`) — see `computeRollingTrendBucket` for
 * the priority order this enum is sorted by.
 */
export type VolumeTrendBucket = 'new' | 'up' | 'down' | 'steady' | 'quiet' | 'dormant';

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
  /**
   * Engine confidence, 0..1 (mirrors `triage_decisions.confidence`,
   * `numeric(3,2)`). Drives the FE intent-bucketing confidence gate
   * (`uplift-d/intent.ts`): a low-confidence verdict stays in the
   * catch-all bucket rather than surfacing as a recommendation the
   * engine isn't sure about. Always present when a decision exists —
   * `confidence` is `NOT NULL` on `triage_decisions`.
   */
  confidence: number;
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
  /**
   * Lifetime inbound message count for this sender, within retention
   * (ADR-0014). Powers the headline "Total" column + the magnitude bar
   * + the default `Total ↓` sort. Stored as `bigint`, serialised on the
   * wire as a JSON `number` (the column's value is bounded far below
   * `Number.MAX_SAFE_INTEGER`).
   *
   * Maintained authoritatively on every full rebuild (Path A —
   * `InitialSyncWorker.buildSenderIndex`) and reconciled nightly by
   * `SendersCounterReconciliationWorker`. Inbox state (archive / read /
   * label) never changes the value — counts are "how many has this
   * sender ever sent me", not "how many are in inbox right now".
   */
  totalReceived: number;
  /**
   * Per-sender "you replied N×" count (Senders V2 spec v1.3 + mig 0022).
   * Distinct outbound messages whose thread contains ≥1 inbound from
   * this sender; reconciles arithmetically with
   * `SUM(sender_timeseries.reply_count)`. Drives the per-row "you
   * replied N" copy on Sender Detail + the future card badge. `0` is
   * the engine default (no replies seen); never `null` because
   * `senders.replied_count` is `NOT NULL DEFAULT 0`.
   *
   * The auto-protect rule fires at `repliedCount >= 3` —
   * `protectionFlags.isProtected = true, protectionReason =
   * 'engagement_based'` follow.
   */
  repliedCount: number;
  monthlyVolume: number | null;
  readRate: number | null;
  /**
   * 12-week volume series (rolling, oldest → newest). Always 12 numbers
   * when present; missing weeks fill with 0. Drives the per-row mini-
   * sparkline in the grid card. Null when the sender has no recent
   * `mail_messages` rows (very old one-shots).
   */
  sparkline: number[] | null;
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
  /**
   * Standing VIP / Protect policy flags (D42, D43) — mirrors
   * `sender_policies`. Surfaced on the LIST row (not just detail) so the
   * Senders screen can render the "Protected" chip, populate the
   * "Protected" KPI, and route VIPs / protected senders to the "Protect"
   * intent bucket. Defaults (`isVip: false, isProtected: false,
   * protectionReason: null, protectionSetAt: null`) when the sender has
   * no `sender_policies` row — i.e. engine-default, not pinned.
   */
  protectionFlags: ProtectionFlags;
  /**
   * Standing policy verb (`keep | archive | unsubscribe | later`) from
   * `sender_policies.policy_type`. `null` when no policy row exists
   * (engine-default). The FE renders a "Unsub queued" pill when this
   * equals `'unsubscribe'` (D38 2026-06-05 brainstorm). Will fold into
   * the unified action manifest once D230 lands.
   */
  policyType: 'keep' | 'archive' | 'unsubscribe' | 'later' | null;
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
 * Sortable column for `GET /api/senders` (ADR-0014, senders list
 * contract). The default at Slice 1 is `total` (server-side default
 * sort by inbound-message count desc) — the new "flood" headline.
 *
 * Slice 1 implements `total` + `last_seen` + `first_seen` + `name`.
 * `read` and `recommended` are reserved in the contract for later
 * slices: `read` requires explicit nullable-column cursor handling
 * (NULLS LAST + boundary marker) and `recommended` needs a
 * recommendation-engine integration that does not exist yet. Sending
 * either today returns a 400 from the controller.
 */
export type SenderListSort = 'total' | 'last_seen' | 'first_seen' | 'name' | 'read' | 'recommended';

/** Sort direction — server applies a sane default per `sort` if omitted. */
export type SenderListDirection = 'asc' | 'desc';

/**
 * Mailbox-wide aggregates for `GET /api/senders/summary` (#145, real-
 * data counts mandate).
 *
 * REWRITE — all "per month" sums use a rolling 30-day window
 * (`mail_messages.internal_date >= now() - 30d`) instead of per-sender
 * latest year_month, eliminating the union-of-disjoint-time-windows
 * inflation. Eight mutually-exclusive buckets with explicit priority —
 * a sender belongs to exactly one. See
 * `packages/shared/src/senders/thresholds.ts:BUCKET_PRIORITY` for the
 * ordering; the SQL CASE in `getSenderSummary` enumerates the same
 * clauses in the same order so chip/KPI/row counts never disagree
 * (CLAUDE.md §8 invariant).
 *
 * `byBucket` totals MUST sum to `totalSenders`. The 8 fields cover
 * everything in scope; `one_time` carries the noise-floor (≤2 lifetime
 * msgs) which the FE hides behind an explicit toggle.
 */
export interface SenderSummary {
  /** Lifetime distinct senders within retention. */
  totalSenders: number;
  /** Senders with ≥1 inbound msg in last `WINDOWS.ACTIVE_DAYS`. */
  activeSenders: number;
  /** Inbound msg count in last `WINDOWS.VOLUME_DAYS`. */
  last30dVolume: number;
  /** 0..100 integer percent — share of `last30dVolume` from senders in
   *  the `needs_review` bucket. */
  noiseReducible: number;
  /** Alias of `byBucket.protect` (kept because the KPI cell label is "Protected"). */
  protected: number;
  /** Alias of `byBucket.needs_review`. */
  needsReview: number;
  /** Per-bucket sender counts. Sum equals `totalSenders`. */
  byBucket: {
    one_time: number;
    protect: number;
    people: number;
    needs_review: number;
    quiet: number;
    dormant: number;
    bulk: number;
    other: number;
  };
  /** ISO-8601 — server time at compute (observability). */
  asOf: string;
}

/**
 * `meta.query` on `GET /api/senders` (senders list contract — returned
 * on every page; the client should treat **page 1's value as
 * authoritative** for the duration of a scroll).
 *
 * - `totalMatching`  — rows matching the active filter + search, query-wide
 *                      (NOT cursor-scoped). Drives the "X of N senders" copy
 *                      and the bulk select-all banner.
 * - `globalMaxTotal` — `MAX(total_received)` for the **active mailbox**,
 *                      **UNFILTERED**. The magnitude-bar denominator —
 *                      a filtered view does NOT rescale to its own max,
 *                      so bars stay comparable across filters.
 * - `asOf`           — ISO-8601 timestamp the meta was computed (purely
 *                      observational; lets the client see how stale a
 *                      mid-scroll page's meta is relative to page 1).
 * - `counts`         — optional per-chip counts for the future filter
 *                      UI; reserved for Slice 3, omitted at Slice 1.
 */
export interface SenderListQueryMeta {
  totalMatching: number;
  globalMaxTotal: number;
  asOf: string;
  counts?: Record<string, number>;
  /**
   * Mailbox-wide absolute counts per filter axis (D38 powerful filters).
   *
   * Computed once per list query and returned with every page. Counts
   * are ABSOLUTE per axis — the number of senders matching JUST that
   * axis predicate, ignoring the rest of the active compose. The hero
   * "X senders match" reflects the composed scope (`totalMatching`);
   * the chip counts here stay stable so the user sees what each axis
   * holds independently and can predict the next click.
   */
  filterCounts?: {
    total: number;
    active: number;
    quiet: number;
    dormant: number;
    unsubReady: number;
    repliedTo: number;
    protected: number;
  };
}

/**
 * Activity bucket — derived from `senders.last_seen_at` against
 * `WINDOWS.ACTIVE_DAYS` (30d) and `WINDOWS.DORMANT_DAYS` (180d).
 *
 *   active   = last_seen_at >= now - 30d
 *   quiet    = last_seen_at <  now - 30d AND last_seen_at >= now - 180d
 *   dormant  = last_seen_at <  now - 180d
 *
 * Mutually exclusive — exactly one bucket per sender. Used by the
 * Senders V2 compose strip (D38).
 */
export type ActivityBucket = 'active' | 'quiet' | 'dormant';

/**
 * Tri-state filter — a chip can be required (`true`), negated
 * (`false` — exclude rows matching), or absent (`null` — no constraint).
 * Mirrors the wire param parsing: `true | not | <absent>`.
 */
export type TriStateFilter = boolean | null;

/**
 * Activity filter — same tri-state semantics, applied per bucket.
 * The wire shape carries the bucket and direction (`active | not-active
 * | quiet | not-quiet | ...`); parsed into this struct.
 */
export interface ActivityFilter {
  bucket: ActivityBucket;
  /** When true, EXCLUDE the bucket instead of requiring it. */
  negate: boolean;
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
 * One sender row inside a Weekly Hero slice card (D47, D48).
 *
 * A compact shape — `SenderListRow` carries the row-level wire data
 * already, but the Hero slice cards only render avatar dot + name +
 * monthly volume per sender. Keeping the slice-row shape narrow keeps
 * the response small (each slice card can carry up to 24 senders).
 *
 * `sparkline` is the 12-month volume series (oldest → newest), filled
 * with 0 for months that have no `sender_timeseries` row. Drives the
 * per-card sparkline on the Hero card. 12 numbers — fixed length so the
 * client doesn't need to align series across senders.
 */
export interface WeeklyHeroSenderRow {
  id: string;
  displayName: string;
  email: string;
  domain: string;
  /** Most-recent month volume — drives the per-sender stat on the card. */
  monthlyVolume: number;
  /** 0..1 — most-recent month read rate. `null` if `monthlyVolume` is 0. */
  readRate: number | null;
  /** 12-month series in chronological order. Always 12 numbers; 0 fills gaps. */
  sparkline: number[];
}

/**
 * Slice kind for `GET /api/senders/weekly-hero` (D47, D48).
 *
 * Three slices per D48:
 *   - `high_confidence` — engine confidence > 0.85 on Archive/Unsubscribe
 *   - `spike`           — current month ≥ 3× rolling 30-day baseline
 *   - `quiet`           — silent 30+ days, read_rate < 0.30, ≥ 6mo relationship
 */
export type WeeklyHeroSliceKind = 'high_confidence' | 'spike' | 'quiet';

/**
 * One slice card on the Weekly Hero surface (D47, D48).
 *
 * Slices with fewer than 3 senders ARE NOT included in the response —
 * the empty-card guard from D48 ("If any slice has < 3 senders, the
 * card hides itself") happens BE-side so the FE can iterate the
 * returned slices and trust every card has enough content to render.
 *
 * `senders` is the slice members, ordered per the D48 sort rule for the
 * slice kind:
 *   - high_confidence — by latest `monthly_volume` desc (highest noise first)
 *   - spike           — by spike ratio (current / priorAvg) desc
 *   - quiet           — by `monthly_volume × first_seen_months` desc
 *
 * Capped at 24 senders per slice (D48 — "Slice limit: top 12-24
 * senders"). Sub-12-row slices are surfaced as-is.
 */
export interface WeeklyHeroSlice {
  kind: WeeklyHeroSliceKind;
  /** Total senders that qualify before the 24-row cap — drives "+N more" copy on the FE. */
  totalCount: number;
  senders: WeeklyHeroSenderRow[];
}

/**
 * Response shape for `GET /api/senders/weekly-hero` (D47, D48).
 *
 * `isMonday` is computed server-side from the mailbox's account timezone
 * (D47 — "refreshes Monday morning per user timezone"). The FE shows
 * the Hero only when `isMonday=true`; on other days the FE hides the
 * Hero strip and renders the grid/table directly.
 *
 * The "refresh Monday morning" cadence is a presentation choice — the
 * BE always computes the freshest slices; the FE decides whether to
 * surface them. Decoupling cache-freshness from surfacing means a
 * user who lands at 11:59pm Sunday and a user who lands at 12:01am
 * Monday see the same data once we cross midnight.
 *
 * `weekOf` is the Monday of the week (YYYY-MM-DD in mailbox local
 * timezone) — drives the "Week of May 26" copy on the Hero header.
 */
export interface WeeklyHero {
  /** True on Mondays in the mailbox's local timezone — controls Hero visibility. */
  isMonday: boolean;
  /** YYYY-MM-DD — Monday of the current week in mailbox local timezone. */
  weekOf: string;
  /** Slices with ≥ 3 senders; slices below the threshold are omitted. */
  slices: WeeklyHeroSlice[];
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
