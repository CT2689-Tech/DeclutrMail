// apps/api/src/senders/senders.types.ts — wire shapes for the Senders
// read endpoints (D39, D40, D44, D45, D46) plus the standing-policy
// write surface (D40, D42, D43 — `PATCH /api/senders/:id/policy`).
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

import { z } from 'zod';

import type { ProtectionReason, TriageReasoningSource, TriageVerdict } from '@declutrmail/db';
import type { UnsubscribeLifecycleStatus } from '@declutrmail/shared/contracts';

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
 * Gmail's own category enum derived directly from the `gmail_category`
 * Postgres enum (`packages/db/src/schema/senders.ts`). Adding a value
 * is a single migration edit; this type widens automatically.
 * Contract assertion at the bottom of this file keeps the API type in
 * lockstep with the shared zero-server-dep mirror.
 */
export type { GmailCategory } from '@declutrmail/db';
import type { GmailCategory } from '@declutrmail/db';

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
  /**
   * Whether this sender's domain has a brand mark cached RIGHT NOW
   * (ADR-0034). Decoration, not sender state: it changes as the icon
   * worker resolves domains, and it carries no user linkage — the
   * `domain_icons` cache is global.
   *
   * `Avatar` emits its CSS `background-image` layer only when this is
   * true. That is the entire point: the layer is a browser subresource
   * with no code around it, so without being told, every avatar on a
   * page requested an icon and almost all of them were told 204.
   */
  brandMark: boolean;
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
   * label) never changes the value — counts are "received and still
   * within retention" (ADR-0014 §Neutral — NOT a lifetime total; mail
   * deleted from Gmail drops out on the nightly recount), not "how many
   * are in inbox right now".
   */
  totalReceived: number;
  /**
   * Messages currently carrying INBOX for this sender — the set every
   * inbox-scoped verb can act on. Live correlated count (not a
   * maintained counter — label membership changes on every action and
   * sync). Lets the row say "hundreds received · 0 in inbox" BEFORE the
   * user opens three verb modals to learn the same thing (founder
   * report 2026-07-28).
   */
  inboxCount: number;
  /**
   * The UNREAD subset of `inboxCount`.
   *
   * For a Protected sender this is exactly what the protection is
   * shielding from bulk and automatic cleanup (D245) — the measure of
   * what a wrong protection costs, and the ordering key the standing
   * protection review sorts on. Always ≤ `inboxCount`, resolved from
   * the same message set, so the two can never disagree.
   */
  unreadInboxCount: number;
  /**
   * Per-sender "you wrote to them N×" count (mig 0063). Distinct
   * outbound messages ADDRESSED to this sender — their address in
   * `recipient_emails` (To + Cc), matched on the D12 normalized form.
   *
   * NOT a reply count. The column it replaces counted every outbound
   * message in a THREAD the sender appeared in, which credited a bounce
   * notifier with 14 "replies" and missed 449 of one real
   * correspondent's 529 (F010). Gmail exposes no causal reply signal;
   * who a message was addressed to is a fact the user can verify in
   * Gmail with `to:their@address`, and one no third-party tool can
   * manufacture.
   *
   * `0` is the engine default (nothing addressed to them); never `null`
   * because `senders.wrote_to_count` is `NOT NULL DEFAULT 0`.
   *
   * Automatic protection needs TWO-WAY traffic — this >= 3 AND at least
   * one message received from them; starred and Gmail-important
   * messages are evaluated from message labels.
   */
  wroteToCount: number;
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
   * Standing Protect policy state (D42, D43) — mirrors
   * `sender_policies`. Surfaced on the LIST row (not just detail) so the
   * Senders screen can render the "Protected" chip, populate the
   * "Protected" KPI, and route protected senders to the "Protect"
   * intent bucket. Defaults (`isProtected: false,
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
  /**
   * Truthful unsubscribe lifecycle from `sender_policies.unsub_status`.
   * One-click endpoint acceptance, manual mailto progress, terminal
   * failure/uncertainty, and unavailable channels are distinct. Legacy
   * DB values are normalized before they reach the wire. `null` means
   * the sender has no recorded unsubscribe intent yet.
   */
  unsubStatus: UnsubExecutionStatus | null;
}

/** Canonical external lifecycle; legacy DB spellings never reach clients. */
export type UnsubExecutionStatus = UnsubscribeLifecycleStatus;

/**
 * Standing protection state for `GET /api/senders/:id` (D42).
 *
 * `isProtected`, `protectionReason`, and `protectionSetAt`
 * mirror the columns on `sender_policies`. NULL `protectionReason`
 * and `protectionSetAt` are valid when `isProtected = false` —
 * documented at the schema column.
 */
export interface ProtectionFlags {
  isProtected: boolean;
  protectionReason: ProtectionReason | null;
  /** ISO-8601 — when `is_protected` last flipped true; null otherwise. */
  protectionSetAt: string | null;
  /**
   * Does the recorded `protectionReason` still hold against today's
   * evidence?
   *
   * Only `replied` can go stale, and only because mig 0063 corrected
   * what it measures: protections granted under the old
   * thread-membership count were sometimes granted on outbound mail
   * that was never addressed to the sender at all (F010 — a bounce
   * notifier scored 14). 99 shields on the founder's mailbox are in
   * that position.
   *
   * NOTHING IS WITHDRAWN ON THIS FIELD. The sweep never unprotects a
   * `replied` row, so a `false` here means "surface this for the user
   * to keep or unprotect", never "we already removed it". Withdrawing a
   * shield silently is the failure mode this exists to prevent.
   *
   *   `true`  — checked and holds, or there is nothing to check
   *             (`user_defined` is the user's own decision; `starred`
   *             and `gmail_important` are evaluated from labels we
   *             still hold; an unprotected sender has no claim to
   *             recheck)
   *   `false` — checked, and today's evidence does not support it
   *   `null`  — NOT CHECKABLE. The mailbox has no outbound mail indexed
   *             at all, so "you wrote to them" is unmeasurable rather
   *             than absent. Consumers must render `null` exactly as
   *             `true`; coercing unknown to "unsupported" would indict
   *             every shield on such a mailbox at once.
   */
  protectionEvidenceCurrent: boolean | null;
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
/**
 * A list row as the READ SERVICE produces it — every fact about the
 * sender, minus the brand-mark decoration.
 *
 * `brandMark` is not sender state. It is a property of the GLOBAL icon
 * cache at the instant of the response, and it lives on a table the
 * senders feature does not own (D204). The controller resolves it for
 * a whole page in one batched read and decorates the rows on the way
 * out, so the read service keeps selecting only senders-owned tables —
 * and it stays a type error to serve a row that never answered the
 * question.
 */
export type SenderFacts = Omit<SenderListRow, 'brandMark'>;

export interface SenderDetail extends SenderListRow {
  protectionFlags: ProtectionFlags;
  /**
   * Raw `mailto:` URL from the sender's List-Unsubscribe header —
   * D230's manual path. The FE parses it into a Gmail compose deep
   * link (the user sends the opt-out themselves; DeclutrMail never
   * auto-sends). `null` unless `unsubscribeMethod === 'mailto'`.
   * Detail-only: the list grid never renders the compose affordance.
   */
  unsubscribeMailtoUrl: string | null;
  /**
   * The engine's current read on this sender, for the optional
   * suggestion disclosure below the action toolbar (D39 layout order,
   * D245 disclosure rule). Detail-only: the list already carries the
   * compact `lastReview`, and a per-sender sentence would bloat a
   * 7k-row page.
   *
   * D245 is what shapes this field: observed facts pick the highlighted
   * verb (`derivePrimaryVerbId`), and this suggestion is disclosed
   * BESIDE that choice — it may never select or restyle an action. The
   * two can and do disagree (a promotions sender with a one-click
   * header leads with Unsubscribe while the engine says Keep because
   * the user reads every message), which is precisely when disclosing
   * it is worth the space.
   *
   * `scoredAt` is not decoration. `triage_decisions` rows carry a 7-day
   * `expires_at`, and re-scoring is trigger-driven, so a verdict can be
   * months old (8,448 of 8,531 rows expired on the founder's dev
   * mailbox, 2026-08-19). Rather than hide a stale read — which would
   * blank the disclosure on ~99% of senders — the wire ships the
   * produced-at timestamp and the FE says how old the read is.
   *
   * `null` when the engine has never scored this sender.
   */
  recommendation: SenderRecommendation | null;
}

/**
 * The engine's suggestion for one sender — a projection of that
 * sender's `triage_decisions` row. Never an instruction: the user's
 * available actions are identical whether this is present or absent.
 */
export interface SenderRecommendation {
  /** The verb the engine would pick. `triage_verdict` has no 'screen'. */
  verdict: TriageVerdict;
  /** 0..1, 2-decimal (mirrors `numeric(3,2)`). Shown as words, not a bar. */
  confidence: number;
  /** One sentence, LLM-written or templated — see `generatedBy`. */
  reasoning: string;
  /** Provenance of `reasoning`. */
  generatedBy: TriageReasoningSource;
  /** ISO-8601 `produced_at` — when the engine last looked. */
  scoredAt: string;
  /**
   * Whether the read is past its `expires_at` TTL. The BE owns this
   * because the BE owns the TTL — a duplicated 7-day constant in the FE
   * would drift the first time D25 changes.
   *
   * A stale read is still SENT and still shown, with its age. The flag
   * exists so the page can ask for a fresh one (D25 `stale_refresh`),
   * not so it can hide the old one.
   */
  stale: boolean;
}

/**
 * `PATCH /api/senders/:id/policy` — request body (D40, D42, D43).
 *
 * Partial set-state patch over the sender's standing policy. Each field
 * is an explicit TARGET state (never a toggle), so a network-retried
 * request is naturally idempotent: re-applying the same patch is a
 * no-op (`changed: false`, no second audit row).
 *
 *   - `policyType` — only `'keep'` is writable on this route (D40:
 *     "Keep applies immediately, records sender_policy(policy_type=
 *     keep)"). `unsubscribe` has its own intent endpoint
 *     (`POST /api/actions/unsubscribe-intent`); `archive` / `later`
 *     standing policies have no write semantics yet — fail-closed.
 *   - `isProtected` — the sole manual safety state (D42).
 *
 * `.strict()` rejects unknown keys so a future field can't silently
 * no-op; the refine requires at least one field so an empty body 400s
 * instead of writing nothing while returning 200.
 */
export const senderPolicyPatchSchema = z
  .object({
    policyType: z.literal('keep').optional(),
    isProtected: z.boolean().optional(),
  })
  .strict()
  .refine((p) => p.policyType !== undefined || p.isProtected !== undefined, {
    message: 'At least one of policyType, isProtected is required.',
  });
export type SenderPolicyPatch = z.infer<typeof senderPolicyPatchSchema>;

/**
 * `PATCH /api/senders/:id/policy` — response (D40, D42, D43).
 *
 * The resulting standing-policy state after the patch. Field names
 * mirror `ProtectionFlags` + `policyType` on the list/detail rows so
 * the FE can reconcile its caches without a refetch round-trip.
 * `policyType` is `null` when the sender still has no policy row
 * (a no-change patch never creates one).
 */
export interface SenderPolicyResult {
  senderId: string;
  policyType: 'keep' | 'archive' | 'unsubscribe' | 'later' | null;
  isProtected: boolean;
  protectionReason: ProtectionReason | null;
  /** ISO-8601 — when `is_protected` last flipped true; null otherwise. */
  protectionSetAt: string | null;
  /**
   * True when this request changed at least one field (and wrote the
   * matching D43 audit row(s)); false for the idempotent no-op replay.
   */
  changed: boolean;
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
    wroteTo: number;
    protected: number;
    /**
     * "Unsub'd, still emailing" (D51 fact filter) — senders with
     * `sender_policies.policy_type = 'unsubscribe'` whose
     * `last_seen_at` is AFTER the policy row was last written
     * (`sender_policies.updated_at`). The honest read of "I asked to
     * stop and mail kept coming".
     */
    unsubIgnored: number;
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
  /**
   * Whole-message byte estimate from Gmail's `sizeEstimate` (D7
   * storage-allowlist amendment per ADR-0021). `null` for rows synced
   * before the amendment OR rows where Gmail omitted the field; the FE
   * renders an em-dash on null rather than a misleading "0B".
   */
  sizeBytes: number | null;
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
 * The set of `activity_log.action` values that are DECISIONS — the
 * K/A/U/L/D verbs plus the Protect toggles. Deliberately narrower than
 * the DB enum: the unsubscribe lifecycle rows (`unsubscribe_failed`,
 * `unsubscribe_action_required`, …) and `followup-dismiss` are outcome
 * and feature records that Activity renders in its own feed. Every one
 * of them is written alongside the decision row that caused it, so
 * nothing the user did is hidden by this narrowing.
 */
export type DecisionHistoryAction =
  | 'keep'
  | 'archive'
  | 'unsubscribe'
  | 'later'
  | 'delete'
  | 'marked_protected'
  | 'unmarked_protected';

/** Mirrors the `activity_source` enum — who performed the action. */
export type DecisionHistorySource = 'triage' | 'manual' | 'autopilot' | 'screener';

/**
 * One row in `GET /api/senders/:id/history` (D46 — decision history on
 * Sender Detail).
 *
 * Sourced from `activity_log` — things that HAPPENED. It deliberately
 * does NOT read `triage_decisions`: that table holds the scoring
 * worker's suggestion for a sender, which no user action ever writes,
 * and rendering it here made every unscored-but-untouched sender claim
 * a decision it never received (founder screenshot 2026-08-19 — Sender
 * Detail said "Triage Kept", Activity for the same sender said nothing
 * had happened; Activity was right).
 *
 * The engine's verdict is a suggestion and belongs on a surface that
 * says so. Today the only such surface is Triage — the highlighted verb
 * above 0.85 confidence (D31) plus the verdict pill. The Senders list
 * carries `lastReview` on the wire but renders nothing from it, and the
 * detail wire has no recommendation field at all, so Sender Detail shows
 * no suggestion — a product gap, not something this history endpoint may
 * paper over.
 */
export interface DecisionHistoryRow {
  /** `activity_log.id` — the operation id Sender Detail displays. */
  id: string;
  action: DecisionHistoryAction;
  source: DecisionHistorySource;
  /** ISO-8601 — when the action happened. */
  occurredAt: string;
  /** Messages moved. 0 for policy-only verbs (Keep, Protect toggles). */
  affectedCount: number;
}

/**
 * Cross-package contract — the DB-derived `GmailCategory` must stay
 * equal to the shared zero-server-dep mirror in
 * `@declutrmail/shared/contracts`. Failing-compile is preferable to
 * silently-wrong category fallback ('primary' default in worker code).
 */
import type { GmailCategory as SharedGmailCategory } from '@declutrmail/shared/contracts';

const _GMAIL_CATEGORY_API_EXTENDS_SHARED: GmailCategory extends SharedGmailCategory ? true : false =
  true;

const _GMAIL_CATEGORY_SHARED_EXTENDS_API: SharedGmailCategory extends GmailCategory ? true : false =
  true;

/** A sender detail as the read service produces it — see `SenderFacts`. */
export type SenderDetailFacts = Omit<SenderDetail, 'brandMark'>;
