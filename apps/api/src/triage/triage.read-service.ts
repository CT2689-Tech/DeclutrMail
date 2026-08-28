import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, count, desc, eq, getTableName, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import {
  activityLog,
  mailMessages,
  mailboxAccounts,
  readStateNotSweeperMarked,
  senderHasActionableMail,
  senderInboxActionWhere,
  senderPolicies,
  senders,
  triageDecisions,
  workspaces,
  type TriageVerdict,
} from '@declutrmail/db';
import { cleanupActionsPerMonthFor } from '@declutrmail/shared/entitlements';
import {
  evaluateProtectionEvidence,
  PROTECTION_WROTE_TO_THRESHOLD,
} from '@declutrmail/shared/senders';
// The weak/strong split is product vocabulary, not a query detail —
// shared so the API, the review copy and every surface that names a
// protection reason cannot drift apart (D245 / CLAUDE.md §2.6).
import {
  WEAK_PROTECTION_REASON_IDS,
  isWeakProtectionReason,
  normalizeProtectionReason,
} from '@declutrmail/shared/copy';

import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

/**
 * Wire shape for one row in the Triage queue. Mirrors the FE
 * `TriageDecisionRow` (apps/web/src/features/triage/data.ts) so the
 * JSON envelope can be passed straight into `<TriageScreen state={...}/>`.
 */
export interface TriageQueueRow {
  id: string;
  /**
   * `senders.id` uuid — the selector the destructive-action pipeline
   * takes (`POST /api/actions` resolves senderId → sender_key server-
   * side). The row carries it so the FE never has to ask for a second
   * lookup before enqueueing a verb (D226 wiring).
   */
  senderId: string;
  senderKey: string;
  senderName: string;
  senderEmail: string;
  senderDomain: string;
  /**
   * Whether a brand mark for `senderDomain` is already cached server-side
   * (ADR-0034).
   *
   * ASK-BEFORE-REQUESTING. `Avatar` paints the mark as a CSS
   * `background-image`, which has no failure callback and no way to check
   * first, so a queue of N rows fires N `/api/icons/:domain` requests and
   * every domain without a mark burns a round trip to be answered 204.
   * The cost is worst on a COLD cache — i.e. a new user's first triage
   * session, when no domain has been resolved yet and every request is
   * wasted.
   *
   * Not triage state — a property of the GLOBAL icon cache at the instant
   * of the response, on a table this feature does not own (D204). The
   * controller resolves it for the whole page in one batched read.
   */
  brandMark: boolean;
  gmailCategory: 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
  /**
   * Sender unsubscribe capability. NULLABLE — null means the sender
   * index has not derived a method yet, which is NOT the same fact as
   * 'this sender publishes no unsubscribe' (D248).
   */
  unsubscribeMethod: 'one_click' | 'mailto' | 'none' | null;
  verdict: TriageVerdict;
  confidence: number;
  reasoning: string;
  /**
   * ISO-8601 — when the engine produced this read.
   *
   * `verdict`, `confidence` and `reasoning` are STORED; every stat
   * beside them on the row (`last90dMessages`, `readRate`, `inboxCount`,
   * …) is recomputed on each request. The two drift apart the moment
   * the sender's mail changes, which is how a card came to read
   * "60 messages monthly, 1% read rate" next to "0% read in 90d ·
   * 209 messages". Surfaced so the row can state its own age instead of
   * presenting a three-week-old recommendation as current.
   */
  scoredAt: string;
  /**
   * Whether the engine's read is past its TTL (`triage_decisions.
   * expires_at`, D25). Server-computed — the BE owns the TTL. Mirrors
   * `Recommendation.stale` on Sender Detail so both surfaces mean the
   * same thing by the word.
   *
   * Drives the on-attention refresh, never whether the row is shown: a
   * visibly old read is honest, a missing one is a blank queue.
   */
  stale: boolean;
  signals: string[];
  protectionReason: 'manual' | 'replied' | 'starred' | 'gmail-important' | null;
  /**
   * Does the recorded `protectionReason` still hold? See
   * `ProtectionFlags.protectionEvidenceCurrent` — same rule, same
   * `null`-means-unmeasurable contract.
   *
   * Load-bearing on the D245 protection review: the header names the
   * stale shields, so a row that keeps asserting the old reason
   * contradicts the screen it sits on.
   */
  protectionEvidenceCurrent: boolean | null;
  monthlyVolume: number;
  /**
   * Raw last-90-day message count. Used by the FE to render an honest
   * rolling-window signal ("N in last 90d") rather than the derived
   * `monthlyVolume = round(last90 / 3)` which rounds to 0 for senders
   * quiet within the window.
   */
  last90dMessages: number;
  /**
   * `null` when the sender sent nothing in the window — NOT 0.
   *
   * A fabricated 0 is indistinguishable from "sends constantly, never
   * opened", which is the best possible score under any low-read-rate
   * ranking. On a real 98k mailbox that put silent one-off senders at
   * the front of onboarding's first review. `senders.types.ts` already
   * types this `number | null`; Triage was the outlier.
   */
  readRate: number | null;
  /**
   * Whole days since this sender's newest message, or `null` when that date
   * cannot be read. Never 0-as-unknown: a confident "today" for a sender who
   * has not written in six weeks is a false statement about the user's own mail.
   */
  lastDays: number | null;
  totalAllTime: number;
  /**
   * Messages from this sender sitting in INBOX right now — what an
   * Archive / Later / Delete would actually move. `totalAllTime` counts
   * everything indexed including already-archived mail, so it does NOT
   * measure the payoff of an action.
   */
  inboxCount: number;
  /**
   * The UNREAD subset of `inboxCount` — for a Protected sender, exactly
   * the mail the protection is shielding from bulk and automatic
   * cleanup, which is what makes a wrong protection expensive.
   *
   * Always ≤ `inboxCount`, and resolved from the SAME message set an
   * action would move (`senderInboxActionWhere`), so "shielding 33
   * unread" and "Archive moves 34 emails" can never disagree.
   */
  unreadInboxCount: number;
}

/**
 * A queue row as the READ SERVICE produces it — every triage fact, minus
 * the brand-mark decoration the controller adds. Keeps the read service
 * selecting only triage-owned tables (D204), and makes it a type error to
 * serve a row that never answered the question.
 */
export type TriageQueueFacts = Omit<TriageQueueRow, 'brandMark'>;

/** Result of {@link TriageReadService.readProtectionReview}. */
export interface ProtectionReviewRead {
  /**
   * Senders protected by two-way correspondence whose evidence STILL
   * holds — at least three messages addressed to them, at least one
   * received back. The reassurance count.
   */
  strong: number;
  /**
   * Senders protected by two-way correspondence whose evidence no longer
   * holds (mig 0063 / F010).
   *
   * They were shielded on a count that credited every outbound message
   * in a thread to every inbound sender in it, so some were granted on
   * mail that was never addressed to them at all. THE SHIELD IS NOT
   * WITHDRAWN — the sweep never unprotects a `replied` row. They surface
   * here so the user keeps or removes each one deliberately, because a
   * shield that disappears without being mentioned is the worse failure.
   *
   * Zero on a mailbox with no outbound mail indexed: the rule is then
   * unmeasurable, not failed.
   */
  unsupported: number;
  /** Senders protected by one star or repeated Gmail importance. */
  weak: number;
  /**
   * Senders the user protected themselves. Never reviewed — but counted,
   * so a caller cannot mistake "no automatic protection" for "nothing
   * is protected".
   */
  manual: number;
  /**
   * Up to `limit` sender keys worth reviewing: the `unsupported` ones
   * FIRST, then the weakly-protected ones, each group ordered by the
   * UNREAD inbox mail its protection is shielding.
   *
   * Unsupported leads because its evidence is ABSENT, while a weak
   * protection's evidence is real but one-way — a star did happen. Within
   * each group, senders shielding nothing are still returned (a wrong
   * protection over an empty inbox is still wrong); they rank last.
   */
  senderKeys: string[];
  /**
   * The subset of `senderKeys` whose protection is `unsupported`.
   *
   * Returned separately because the caller has to treat them
   * differently in two places a merged list cannot express: they are
   * `replied` rows, so a weak-reason filter drops them, and they lead
   * the review as a GROUP rather than by shielded mail.
   */
  unsupportedSenderKeys: string[];
}

/** Optional presentation ordering applied before the queue limit. */
export type TriageQueueOrdering = 'actionable' | 'newsletter-first' | 'promotions-first';

/**
 * D214 — the "Today" strip atop Triage. Situational awareness for the
 * daily ritual, computed from real rows (no fake completion §10):
 *
 *   You received {receivedToday} emails from {sendersToday} senders.
 *   DeclutrMail handled {handledAutomatically} automatically.
 *   {queuedDecisions} sender decisions; {noiseSenderCount} of them sent N% of
 *   ~{noiseReductionPct}%.
 *
 * `noiseReductionPct` is the queued non-Keep senders' share of the
 * mailbox's last-90-day inbound volume — the same rolling window every
 * other triage signal uses. `null` when the queue is empty or the
 * mailbox has no 90-day volume to take a share of.
 */
export interface TodaySummary {
  receivedToday: number;
  sendersToday: number;
  /** Messages moved today by Autopilot (`activity_log.source='autopilot'`). */
  handledAutomatically: number;
  /** Queue length the user will actually see (D30 clamp applied). */
  queuedDecisions: number;
  /**
   * How many of `queuedDecisions` actually contribute to
   * `noiseReductionPct` — the non-Keep rows. Surfaced separately because the
   * two numbers describe DIFFERENT sender sets: the count is every queued row,
   * the percentage excludes Keep. Copy that attributes the percentage to all
   * `queuedDecisions` is false whenever a Keep row is queued, which is most
   * mailboxes and was invisible on the one where every row happened to be
   * an unsubscribe.
   */
  noiseSenderCount: number;
  noiseReductionPct: number | null;
}

/** Stats for the daily ritual empty state — mirrors the FE shape. */
export interface TriageSessionStats {
  decidedToday: number;
  archivedToday: number;
  unsubscribedToday: number;
  laterToday: number;
  freeRemaining: number | null;
  tier: 'free' | 'plus' | 'pro';
}

/** Route-level read model before the controller adds global icon availability. */
export interface TriageBootstrapFacts {
  queue: TriageQueueFacts[];
  stats: TriageSessionStats;
  todaySummary: TodaySummary;
}

/**
 * D30 — "not seen by user in last 7 days". A sender the user has
 * DECIDED on (a K/A/U/L/D `activity_log` row whose undo has not been
 * reverted) within this window is excluded from the queue, so a row
 * leaves the queue only once the server has durably confirmed the
 * decision (D226 — no optimistic removal). Shared with
 * `ActionsService.recordKeepIntent`'s replay window so "already
 * decided" means the same thing on both the read and the write side.
 */
export const TRIAGE_DECIDED_WINDOW_DAYS = 7;

/**
 * Retrieval priority for finite, goal-led queue windows. The normal
 * Triage surface keeps its destructive-first D227 order; onboarding
 * can move the evidence relevant to the selected relief goal ahead of
 * the SQL limit, then apply its richer signal ordering in memory.
 */
/**
 * postgres.js and PGlite disagree about raw `sql` timestamp fragments — one
 * hands back a string, the other a `Date` — and a raw fragment gets no drizzle
 * decoder either way, so the declared generic proves nothing. Mirrors the same
 * helper in `lapse-reengagement.worker.ts`.
 */
/**
 * Start of the trailing-90-day window — anchored to the UTC day, so that
 * every caller deriving it independently gets the SAME instant.
 *
 * Determinism is the whole point, and it is why this is not
 * `Date.now() - 90d`. The share divides a per-sender count (from
 * `listQueue`) by a mailbox-wide count, and those two numbers reach the
 * user through DIFFERENT HTTP requests: the rows come from `/queue`, the
 * strip above them from `/today-summary`, and a decision invalidates both
 * caches independently. There is no instant to share across two requests —
 * only a rule they can both re-derive. A rolling cutoff cannot be
 * re-derived: two calls a second apart produce two windows, so the strip
 * could claim "~100%" above a row whose own 90-day count read 0.
 *
 * The original defect was never that anchoring is wrong. It was that the
 * numerator anchored one way and the denominator another. Anchoring BOTH
 * fixes it and survives the request boundary; making both rolling fixed
 * only the half that lives inside a single request.
 */
function noiseWindowStartFrom(now: Date | undefined): Date {
  const at = now ?? new Date();
  const dayStartUtc = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  return new Date(dayStartUtc - 90 * 86_400_000);
}

/**
 * The queued share of 90-day inbound volume, or `null` when no honest
 * number exists.
 *
 * Extracted so the impossible-ratio branch is reachable by a test. The
 * state that produces `queuedNoise > total` — a sync reclassifying mail as
 * outbound between two non-transactional reads — cannot be staged through
 * the database from a spec, so behind the query this branch was untestable.
 * An untested branch guarding a user-visible claim is the shape this repo
 * keeps shipping.
 */
export function noiseSharePct(queuedNoise: number, total: number): number | null {
  // `Math.min(100, …)` used to sit here. It printed exactly "100%" for a
  // ratio above 1 — the most confident claim available, produced from
  // evidence that the two reads disagreed. Say nothing instead.
  if (total <= 0 || queuedNoise > total) return null;
  return Math.round((queuedNoise / total) * 100);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function queueGoalPriority(ordering: TriageQueueOrdering) {
  switch (ordering) {
    // Both cleanup orderings push `later` to the BACK, and that is
    // load-bearing rather than tidy. This ORDER BY feeds a 50-row pool
    // that onboarding then filters, and `later` is `insufficient_signal`
    // which onboarding always drops. Ranking it first — as
    // `promotions-first` did, bucketing `promotions AND (archive OR
    // later)` together — filled all 50 slots with rows the caller was
    // guaranteed to discard, so Step 5 rendered EMPTY on a mailbox with
    // 1,443 emails of promotions cleanup available. A pool ordering that
    // disagrees with its consumer's filter starves it silently; there is
    // no error, just nothing.
    case 'newsletter-first':
      return sql`CASE
        WHEN ${triageDecisions.verdict} = 'later' THEN 9
        WHEN ${triageDecisions.verdict} = 'unsubscribe' THEN 0
        WHEN ${senders.gmailCategory} = 'promotions' THEN 1
        ELSE 2 END`;
    case 'promotions-first':
      return sql`CASE
        WHEN ${triageDecisions.verdict} = 'later' THEN 9
        WHEN ${senders.gmailCategory} = 'promotions'
          AND ${triageDecisions.verdict} IN ('archive', 'unsubscribe') THEN 0
        WHEN ${senders.gmailCategory} = 'promotions' THEN 1
        WHEN ${triageDecisions.verdict} IN ('archive', 'unsubscribe') THEN 2
        ELSE 3 END`;
    case 'actionable':
      return null;
  }
}

/**
 * TriageReadService (D20, D29, D33, D204).
 *
 * READ-ONLY per D204: this service NEVER mutates `triage_decisions`.
 * It joins decisions to senders + aggregates message-level signals
 * into the `TriageQueueRow` the FE renders one at a time. The write
 * surface — re-score triggers — lives in TriageService.
 *
 * D7 / D228: every column read is metadata. The snippet is allow-
 * listed (D7 § 2.1) but THIS read path doesn't need it — the queue
 * row shows reasoning + signals, not the snippet.
 *
 * The protectionReason mapping retains the exact observed evidence so
 * the UI can explain every automatic protection and offer an override.
 */
@Injectable()
export class TriageReadService {
  private readonly logger = new Logger(TriageReadService.name);
  private readonly entitlements: EntitlementsService;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    // Free-cap position for the stats block (A3 — 50 cleanup actions
    // per month; replaces the old 25/day display counter). `@Optional()`
    // + fallback so the existing `new TriageReadService(db)` test
    // wiring keeps working (the service is stateless over the db).
    @Optional() entitlements?: EntitlementsService,
  ) {
    this.entitlements = entitlements ?? new EntitlementsService(db);
  }

  /**
   * Return up to `limit` triage decisions for the mailbox, joined with
   * sender identity + aggregate signals. Ordered "most actionable
   * first" — Archive/Unsubscribe verdicts before Keep, then by
   * confidence DESC.
   *
   * Per D227 the order is: archive, unsubscribe, later, keep — destructive
   * verbs first so the user makes the highest-impact decisions while
   * attention is fresh.
   */
  async listQueue(input: {
    mailboxAccountId: string;
    limit: number;
    ordering?: TriageQueueOrdering;
    /**
     * Apply the CLEANUP consumer's own rejections before the limit.
     *
     * Onboarding's Step 5 filters on inbox mail, but this pool ranks by
     * indexed volume (`senders.total_received`), which counts archived
     * mail too. A sender with 2,000 filed messages and an empty inbox
     * therefore leads the pool and is then discarded — and with enough of
     * them all `limit` slots go to rows the caller cannot use. Step 5
     * rendered blank on a 98k mailbox for that reason, silently: a pool
     * that disagrees with its consumer's filter starves it with no error.
     *
     * It has to mirror every rejection onboarding makes, not just one.
     * Filtering only on inbox mail still let `keep` and Protected rows
     * take slots — and `promotions-first` ranks a Protected *promotions*
     * sender ABOVE an actionable non-promotions one, so those are exactly
     * the rows that crowd in first. `later` needs no clause: the ordering
     * already sends it to the back, so it can only occupy slots nothing
     * better wanted.
     *
     * Off by default. The main Triage queue deliberately shows Keep,
     * Protected and empty-inbox senders — a decision about a sender is
     * still meaningful there.
     */
    requireCleanupCandidate?: boolean;
    /**
     * Restrict the read to these sender keys. For callers that already
     * chose their senders by some other ranking (the D245 protection
     * review picks by shielded unread mail) and want this projection —
     * not this ordering — for them.
     *
     * An EMPTY array means "no senders", and short-circuits to `[]`. It
     * must never fall through to the unrestricted read: that is how a
     * narrowed query silently returns the whole mailbox.
     */
    senderKeys?: readonly string[];
    /**
     * Start of the trailing-90-day window for `last90dMessages`.
     *
     * The Today strip divides this projection's 90-day counts by a
     * mailbox-wide 90-day count taken in a SEPARATE statement. When each
     * half picked its own cutoff the two windows differed by up to a full
     * day, so the share was computed across mismatched spans. The caller
     * passes ONE instant to both halves instead.
     */
    windowStart?: Date;
  }): Promise<TriageQueueFacts[]> {
    if (input.senderKeys?.length === 0) {
      return [];
    }
    // The CASE ordering encodes the verdict priority. `confidence` is
    // a numeric text on the wire — cast to numeric so DESC sorts as a
    // number, not lex.
    const verdictPriority = sql`
      CASE ${triageDecisions.verdict}
        WHEN 'archive'     THEN 0
        WHEN 'unsubscribe' THEN 1
        WHEN 'later'       THEN 2
        WHEN 'keep'        THEN 3
      END`;
    const ordering = input.ordering ?? 'actionable';
    const goalPriority = queueGoalPriority(ordering);
    // Onboarding applies richer payoff ordering after this read, but the
    // SQL limit happens first. Put the maintained sender count ahead of
    // confidence for cleanup goals so a high-volume sender cannot be
    // crowded out of the candidate pool by dozens of one-off rows.
    const payoffPriority =
      ordering === 'newsletter-first' || ordering === 'promotions-first'
        ? desc(senders.totalReceived)
        : null;
    // `senderKey` last, on EVERY path, so the ORDER BY is a total order.
    // Built as one list rather than a branch per ordering: the daily
    // (`actionable`) route takes the null-goal path, and when that path was
    // spelled separately it omitted the tiebreak. Confidence ties are not rare
    // there — the engine emits a handful of discrete values, so a real mailbox
    // had 33 decisions tied at 0.87 contending for the last 4 of 12 LIMIT
    // slots. Without a tiebreak, Postgres may return any of them in any order,
    // so which senders appear at all was undefined and any write to
    // `triage_decisions` reshuffled the queue under the reader mid-decision.
    const queueOrder = [
      ...(goalPriority ? [goalPriority] : []),
      ...(payoffPriority ? [payoffPriority] : []),
      verdictPriority,
      desc(triageDecisions.confidence),
      triageDecisions.senderKey,
    ];

    // Exclude senders the user has already decided on within the D30
    // window — the "decided" record is the K/A/U/L/D `activity_log` row
    // (written by the label-action worker on `done` for Archive/Later/
    // Delete, by the intent endpoints for Keep/Unsubscribe). A decision
    // whose undo has been REVERTED no longer counts: the user changed
    // their mind, so the sender returns to the queue. Raw SQL (no
    // column interpolation) because a correlated `sql` template emits
    // bare column names that mis-bind across the three tables
    // (LEARNINGS 2026-06 — Drizzle correlated-subquery pitfall).
    const notDecidedRecently = sql`NOT EXISTS (
      SELECT 1
      FROM activity_log al
      LEFT JOIN undo_journal uj ON uj.token = al.undo_token
      WHERE al.mailbox_account_id = triage_decisions.mailbox_account_id
        AND al.sender_key = triage_decisions.sender_key
        AND al.action IN ('keep', 'archive', 'unsubscribe', 'later', 'delete')
        AND al.occurred_at >= now() - make_interval(days => ${TRIAGE_DECIDED_WINDOW_DAYS})
        AND (al.undo_token IS NULL OR uj.reverted_at IS NULL)
    )`;

    const rows = await this.db
      .select({
        decisionId: triageDecisions.id,
        senderId: senders.id,
        senderKey: triageDecisions.senderKey,
        verdict: triageDecisions.verdict,
        confidence: triageDecisions.confidence,
        reasoning: triageDecisions.reasoning,
        producedAt: triageDecisions.producedAt,
        expiresAt: triageDecisions.expiresAt,
        senderName: senders.displayName,
        senderEmail: senders.email,
        senderDomain: senders.domain,
        gmailCategory: senders.gmailCategory,
        unsubscribeMethod: senders.unsubscribeMethod,
        firstSeenAt: senders.firstSeenAt,
        lastSeenAt: senders.lastSeenAt,
        protectionReason: senderPolicies.protectionReason,
        isProtected: senderPolicies.isProtected,
        wroteToCount: senders.wroteToCount,
        totalReceived: senders.totalReceived,
      })
      .from(triageDecisions)
      .innerJoin(
        senders,
        and(
          eq(senders.mailboxAccountId, triageDecisions.mailboxAccountId),
          eq(senders.senderKey, triageDecisions.senderKey),
        ),
      )
      // ADR-0008 §3 exception: triage reads senders-owned
      // `sender_policies` (protection flag + reason ride every queue
      // row). Read-only; ratified in the ADR's exception table.
      .leftJoin(
        senderPolicies,
        and(
          eq(senderPolicies.mailboxAccountId, triageDecisions.mailboxAccountId),
          eq(senderPolicies.senderKey, triageDecisions.senderKey),
        ),
      )
      .where(
        and(
          eq(triageDecisions.mailboxAccountId, input.mailboxAccountId),
          notDecidedRecently,
          ...(input.senderKeys ? [inArray(triageDecisions.senderKey, [...input.senderKeys])] : []),
          ...(input.requireCleanupCandidate
            ? [
                ne(triageDecisions.verdict, 'keep'),
                // `is_protected` ALONE, mirroring `mapProtectionReason`,
                // which returns null the moment that flag is false. An
                // `IS NULL protection_reason` clause here also excluded
                // DEMOTED senders — ones the user explicitly unprotected,
                // which keep their reason as the record of what they were
                // (D245: "preserve a manual Unprotect as a sticky
                // override"). Unprotecting is the user asking for cleanup
                // to reach a sender, so hiding it from Step 5 inverts the
                // very intent.
                or(isNull(senderPolicies.isProtected), eq(senderPolicies.isProtected, false))!,
                senderHasActionableMail(input.mailboxAccountId, senders.senderKey),
              ]
            : []),
        ),
      )
      .orderBy(...queueOrder)
      .limit(input.limit);

    if (rows.length === 0) {
      return [];
    }

    // Mailbox-level, read once per call rather than per row: without
    // outbound mail indexed, "you wrote to them" is unmeasurable and
    // every correspondence shield would otherwise read as unsupported.
    const mailboxHasOutbound = await this.mailboxHasOutboundIndexed(input.mailboxAccountId);

    // Aggregate per-sender message stats in a single follow-up query
    // (cheaper than a correlated subquery per row).
    const senderKeys = rows.map((r) => r.senderKey);
    // Bind the cutoff as an ISO STRING cast to timestamptz, not a JS
    // Date. The postgres.js driver rejects a raw `Date` interpolated
    // into a `sql` fragment with "The string argument must be of type
    // string … Received an instance of Date" (Codex smoke 2026-05-27).
    // `gte()` in a `.where()` handles Dates fine; only raw `sql`
    // fragments need the manual ISO + cast.
    const ninetyDaysAgoIso = (input.windowStart ?? noiseWindowStartFrom(undefined)).toISOString();
    const aggRows = await this.db
      .select({
        senderKey: mailMessages.senderKey,
        total: count(),
        unread: sql<number>`SUM(CASE WHEN ${mailMessages.isUnread} THEN 1 ELSE 0 END)`,
        // INBOUND only, in both halves. Mail the user SENT is not the
        // sender's volume, and it is never unread, so counting it
        // inflated the denominator and the numerator together — worst on
        // exactly the correspondents a wrong verdict costs most.
        last90Total: sql<number>`SUM(CASE WHEN ${mailMessages.isOutbound} = false AND ${mailMessages.internalDate} >= ${ninetyDaysAgoIso}::timestamptz THEN 1 ELSE 0 END)`,
        // Decontaminated numerator (mig 0064, F012) — a message a
        // third-party sweeper marked read is not evidence the USER read
        // it. #583 applied this to the senders list and the timeseries
        // reconcile and stopped there, so Triage and Senders reported
        // DIFFERENT read rates for the same sender on the same day.
        // Numerator only: the message still arrived.
        last90Read: sql<number>`SUM(CASE WHEN ${mailMessages.isOutbound} = false AND ${mailMessages.internalDate} >= ${ninetyDaysAgoIso}::timestamptz AND NOT ${mailMessages.isUnread} AND ${readStateNotSweeperMarked(input.mailboxAccountId, getTableName(mailMessages))} THEN 1 ELSE 0 END)`,
        // `unknown`, not `Date` — a raw `sql` fragment carries no decoder
        // (drizzle's `SQL.decoder` is a no-op), so the declared generic is an
        // unchecked assertion about the driver's wire shape rather than a
        // guarantee. It resolved to a STRING under postgres.js while PGlite
        // handed back a Date, which is why no test could reproduce the bug it
        // caused. Normalise through `toDate` at the consumer instead.
        // INBOUND only, like `last90Total` above. A sender's "last seen" is
        // when THEY last wrote to you. Mail you SENT is stored under the
        // hash of its own `From`, so a message to your own address or a
        // sending alias shares the sender key — and an unfiltered MAX let
        // today's outbound mail render "LAST SEEN today" for a sender whose
        // newest inbound message was months old. `senders.lastSeenAt`, the
        // fallback below, is already derived from inbound rows only, so the
        // filter aligns the aggregate with what it falls back to. NULL when
        // a sender has only outbound rows — which falls back correctly.
        lastInternalDate: sql<unknown>`MAX(CASE WHEN ${mailMessages.isOutbound} = false THEN ${mailMessages.internalDate} END)`,
      })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.mailboxAccountId, input.mailboxAccountId),
          // `inArray` emits `sender_key IN ($2, $3, …)` — the correct
          // shape. A `sql\`… = ANY(${senderKeys})\`` template expands
          // the JS array into a ROW expression `($2,$3,…)`, which PG
          // rejects with "op ANY/ALL (array) requires array on right
          // side" (Codex smoke 2026-05-27).
          inArray(mailMessages.senderKey, senderKeys),
        ),
      )
      .groupBy(mailMessages.senderKey);

    // `inboxCount` is what an action would MOVE, so it must resolve the
    // same message set the preview, the enqueue count and the worker
    // resolve — which is why `senderInboxActionWhere` exists and why this
    // does not hand-roll the equivalent SQL. A sixth private copy of that
    // predicate is exactly the drift the 2026-07-26 action-surface finding
    // was about: one caller filtered `is_outbound`, four did not, and mail
    // absent from the preview moved at execution anyway. Separate query
    // because the aggregate above deliberately spans ALL stored mail
    // (totals, 90-day window) rather than the inbox-only action set.
    const inboxRows = await this.db
      .select({
        senderKey: mailMessages.senderKey,
        inboxCount: count(),
        // Same rows, unread subset — so the shielded figure a Protected
        // row shows is a strict subset of the figure its Archive preview
        // shows, by construction rather than by two matching queries.
        // `::int` because postgres.js returns an uncast SUM as a string
        // (bigint) — the declared `number` would otherwise be a lie the
        // `Number()` at the consumer papers over.
        unreadInboxCount: sql<number>`SUM(CASE WHEN ${mailMessages.isUnread} THEN 1 ELSE 0 END)::int`,
      })
      .from(mailMessages)
      .where(senderInboxActionWhere({ mailboxAccountId: input.mailboxAccountId, senderKeys }))
      .groupBy(mailMessages.senderKey);
    const inboxBySender = new Map(
      inboxRows.map((r) => [
        r.senderKey,
        { inbox: Number(r.inboxCount), unread: Number(r.unreadInboxCount) },
      ]),
    );

    const aggBySender = new Map<string, (typeof aggRows)[number]>();
    for (const a of aggRows) aggBySender.set(a.senderKey, a);

    const now = Date.now();
    return rows.map((r) => {
      const agg = aggBySender.get(r.senderKey);
      const total = Number(agg?.total ?? 0);
      const last90Total = Number(agg?.last90Total ?? 0);
      const last90Read = Number(agg?.last90Read ?? 0);
      // Mirrors senders.read-service `computeReadRate`: no denominator
      // means unknown, not zero.
      const readRate = last90Total > 0 ? last90Read / last90Total : null;
      const inbox = inboxBySender.get(r.senderKey) ?? { inbox: 0, unread: 0 };
      const inboxCount = inbox.inbox;
      const monthlyVolume = Math.round(last90Total / 3);
      // `??` on the RAW value would pick an unreadable non-null and shadow
      // `r.lastSeenAt`, which is a correctly-typed column read — that is the
      // exact shape of the defect this replaced. Normalise first, then fall
      // back, so the fallback can actually do its job.
      const lastInternal = toDate(agg?.lastInternalDate) ?? toDate(r.lastSeenAt);
      // Unknown stays unknown. The previous `: 0` answered "I could not read
      // this date" with the most recent date possible, so a sender last seen 45
      // days ago rendered "LAST SEEN today" — the same rule this file already
      // applies to `readRate` ("no denominator means unknown, not zero").
      const lastDays =
        lastInternal === null
          ? null
          : Math.max(0, Math.floor((now - lastInternal.getTime()) / 86_400_000));

      // Protection overrides the recommendation (2026-07-10 founder
      // dogfood): a row reading "PROTECTED" and "Unsubscribe · 95% ·
      // RECOMMENDED" at once is a contradiction — the user asked us
      // (or the engine's protect rules did) to keep this sender, so
      // the RECOMMENDATION must be Keep. Display-layer only: the
      // engine's verdict stays in `triage_decisions` untouched, every
      // K/A/U/L/D action remains available on the row, and the override
      // is annotated in the reasoning so the user sees why.
      const protectionReason = mapProtectionReason(r.isProtected, r.protectionReason);
      const isProtected = protectionReason !== null;
      const protectionEvidenceCurrent = evaluateProtectionEvidence({
        isProtected: r.isProtected ?? false,
        reason: normalizeProtectionReason(r.protectionReason),
        wroteToCount: Number(r.wroteToCount ?? 0),
        receivedCount: Number(r.totalReceived ?? 0),
        mailboxHasOutbound,
      });

      return {
        id: r.decisionId,
        senderId: r.senderId,
        senderKey: r.senderKey,
        senderName: r.senderName || r.senderEmail,
        senderEmail: r.senderEmail,
        senderDomain: r.senderDomain,
        gmailCategory: r.gmailCategory,
        unsubscribeMethod: r.unsubscribeMethod,
        verdict: isProtected ? 'keep' : r.verdict,
        confidence: Number(r.confidence),
        reasoning:
          isProtected && r.verdict !== 'keep'
            ? `This sender is protected (${protectionReason}), so Keep is recommended. Without protection the engine would suggest: ${r.verdict}. ${r.reasoning ?? ''}`.trimEnd()
            : r.reasoning,
        scoredAt: r.producedAt.toISOString(),
        // Same rule as `buildRecommendation` on Sender Detail: past the
        // TTL is stale, and `expires_at` is NOT NULL so there is no
        // unmeasurable case to guard here. Compared against the `now`
        // this map already froze, so every row in one response agrees
        // on what "now" was.
        stale: r.expiresAt.getTime() <= now,
        signals: buildSignals({
          readRate,
          monthlyVolume,
          unsubscribeMethod: r.unsubscribeMethod,
        }),
        protectionReason,
        protectionEvidenceCurrent,
        monthlyVolume,
        /**
         * Raw last-90-day count — the underlying signal `monthlyVolume`
         * is derived from (`monthlyVolume = round(last90Messages / 3)`).
         * Surfaced separately so the FE can render an honest rolling
         * window ("N in last 90d") instead of the derived "/mo" that
         * silently rounds to 0 for senders quiet within the window
         * (FOUNDER 2026-06-06 smoke — every triage row read "0/mo"
         * because the only mail from these senders was older than 90d).
         */
        last90dMessages: last90Total,
        readRate,
        lastDays,
        totalAllTime: total,
        inboxCount,
        unreadInboxCount: inbox.unread,
      };
    });
  }

  /**
   * The D245 protection review (onboarding step 5 for the
   * `protect_important` goal).
   *
   * Automatic protection is silent — it shields senders from bulk and
   * automatic cleanup before the user has seen a single screen (515 on
   * the founder's mailbox). This read answers the two questions that
   * makes reviewable: how much of it rests on a REPLY (nothing to
   * check), and which of the rest is shielding the most mail (the
   * costliest place to be wrong).
   *
   * Ordering is literal, not a composite score: "volume × unread%"
   * reduces to the unread count, so that is what it ranks by and what
   * the row says. The mail set is `senderInboxActionWhere` — what a
   * cleanup verb would actually move — so a sender whose whole history
   * is already archived correctly ranks as shielding nothing.
   *
   * Counts and rows come from different scopes on purpose. The counts
   * are protection STATE (every protected sender, decided or not),
   * because "we protected 460 senders you write back to" is a claim
   * about protection. The keys feed a queue read, which applies the
   * queue's own exclusions.
   */
  /**
   * Does this mailbox have ANY outbound mail indexed? Gates the
   * unsupported-evidence split — see `evaluateProtectionEvidence`.
   * `LIMIT 1` so it stops at the first row.
   */
  private async mailboxHasOutboundIndexed(mailboxAccountId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: mailMessages.id })
      .from(mailMessages)
      .where(
        and(eq(mailMessages.mailboxAccountId, mailboxAccountId), eq(mailMessages.isOutbound, true)),
      )
      .limit(1);
    return row !== undefined;
  }

  async readProtectionReview(input: {
    mailboxAccountId: string;
    limit: number;
  }): Promise<ProtectionReviewRead> {
    // ADR-0008 §3 exception: triage reads senders-owned
    // `sender_policies` directly (here and in the weak-keys query
    // below). Read-only; ratified in the ADR's exception table.
    //
    // GROUP BY + TS bucketing rather than three SQL FILTER literals:
    // the literals were a second copy of the reason taxonomy the shared
    // module owns, and a fifth enum value would have changed which rows
    // the review shows without changing these counts. Bucketing through
    // `normalizeProtectionReason` / `isWeakProtectionReason` keeps one
    // source, and an unrecognized reason is LOGGED and excluded rather
    // than silently absorbed — never guessed into a bucket.
    //
    // `replied` rows additionally split on whether their evidence still
    // holds (mig 0063). The join to `senders` carries `wrote_to_count`
    // and `total_received`; the mailbox-level "is this measurable at
    // all" gate is read separately below, because a mailbox with no
    // indexed outbound would otherwise report every shield unsupported.
    const reasonRows = await this.db
      .select({
        reason: senderPolicies.protectionReason,
        wroteToCount: senders.wroteToCount,
        receivedCount: senders.totalReceived,
        n: count(),
      })
      .from(senderPolicies)
      .leftJoin(
        senders,
        and(
          eq(senders.mailboxAccountId, senderPolicies.mailboxAccountId),
          eq(senders.senderKey, senderPolicies.senderKey),
        ),
      )
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, input.mailboxAccountId),
          eq(senderPolicies.isProtected, true),
        ),
      )
      .groupBy(senderPolicies.protectionReason, senders.wroteToCount, senders.totalReceived);

    const mailboxHasOutbound = await this.mailboxHasOutboundIndexed(input.mailboxAccountId);

    let strong = 0;
    let unsupported = 0;
    let weak = 0;
    let manual = 0;
    for (const row of reasonRows) {
      const id = normalizeProtectionReason(row.reason);
      const n = Number(row.n);
      if (id === 'replied') {
        const holds = evaluateProtectionEvidence({
          isProtected: true,
          reason: 'replied',
          wroteToCount: Number(row.wroteToCount ?? 0),
          receivedCount: Number(row.receivedCount ?? 0),
          mailboxHasOutbound,
        });
        // `false` is the ONLY value that surfaces a shield. `null` means
        // unmeasurable and rides with the reassurance — see
        // `evaluateProtectionEvidence`.
        if (holds === false) unsupported += n;
        else strong += n;
      } else if (id !== null && isWeakProtectionReason(id)) weak += n;
      else if (id === 'user_defined') manual += n;
      else {
        this.logger.warn(
          `protection_review.unbucketed_reason mailbox=${input.mailboxAccountId} ` +
            `reason=${row.reason ?? 'null'} n=${n}`,
        );
      }
    }

    if (weak === 0 && unsupported === 0) {
      return { strong, unsupported, weak, manual, senderKeys: [], unsupportedSenderKeys: [] };
    }

    // ADR-0008 §3 exception: see the marker above.
    const weakRows = await this.db
      .select({ senderKey: senderPolicies.senderKey })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, input.mailboxAccountId),
          eq(senderPolicies.isProtected, true),
          inArray(senderPolicies.protectionReason, [...WEAK_PROTECTION_REASON_IDS]),
        ),
      );
    const weakKeys = weakRows.map((r) => r.senderKey);

    // The `replied` shields whose evidence no longer holds. Same
    // predicate as the bucketing above, expressed in SQL so the row set
    // and the count cannot drift; `mailboxHasOutbound` gates it entirely,
    // matching `evaluateProtectionEvidence`'s `null` branch.
    const unsupportedRows = mailboxHasOutbound
      ? await this.db
          .select({ senderKey: senderPolicies.senderKey })
          .from(senderPolicies)
          .innerJoin(
            senders,
            and(
              eq(senders.mailboxAccountId, senderPolicies.mailboxAccountId),
              eq(senders.senderKey, senderPolicies.senderKey),
            ),
          )
          .where(
            and(
              eq(senderPolicies.mailboxAccountId, input.mailboxAccountId),
              eq(senderPolicies.isProtected, true),
              eq(senderPolicies.protectionReason, 'replied'),
              sql`(${senders.wroteToCount} < ${PROTECTION_WROTE_TO_THRESHOLD} OR ${senders.totalReceived} = 0)`,
            ),
          )
      : [];
    const unsupportedKeys = unsupportedRows.map((r) => r.senderKey);

    // Ranked by shielded unread mail. LEFT-side aggregation only covers
    // senders that HAVE inbox mail, so the ranked list is padded from
    // the remaining weak keys below rather than silently shortened —
    // a review that hides the protections shielding nothing would never
    // let the user reach the ones set on a stray star years ago.
    const shielded = await this.db
      .select({
        senderKey: mailMessages.senderKey,
        unread: sql<number>`SUM(CASE WHEN ${mailMessages.isUnread} THEN 1 ELSE 0 END)::int`,
        inbox: count(),
      })
      .from(mailMessages)
      .where(
        senderInboxActionWhere({
          mailboxAccountId: input.mailboxAccountId,
          senderKeys: [...unsupportedKeys, ...weakKeys],
        }),
      )
      .groupBy(mailMessages.senderKey);

    const byKey = new Map(
      shielded.map((r) => [r.senderKey, { unread: Number(r.unread), inbox: Number(r.inbox) }]),
    );
    const byShieldedMail = (a: string, b: string) => {
      const left = byKey.get(a) ?? { unread: 0, inbox: 0 };
      const right = byKey.get(b) ?? { unread: 0, inbox: 0 };
      return right.unread - left.unread || right.inbox - left.inbox || a.localeCompare(b);
    };
    // Unsupported first as a GROUP, not merged and re-sorted: an absent
    // justification outranks a real-but-one-way one regardless of how
    // much mail either shields, and interleaving them would let a single
    // heavily-shielding star push every stale shield off a 5-row review.
    const ranked = [
      ...[...unsupportedKeys].sort(byShieldedMail),
      ...[...weakKeys].sort(byShieldedMail),
    ];

    // No silent caps. Truncating the ranked pool is legitimate — the
    // review shows five rows — but a caller that never hears about the
    // truncation cannot tell "50 candidates, showed the top 5" from "5
    // candidates, showed all of them", and the second reads as full
    // coverage. Say what was dropped.
    if (ranked.length > input.limit) {
      this.logger.log(
        `protection_review.pool_capped mailbox=${input.mailboxAccountId} ` +
          `ranked=${ranked.length} kept=${input.limit} dropped=${ranked.length - input.limit}`,
      );
    }

    const kept = ranked.slice(0, input.limit);
    const keptSet = new Set(kept);
    return {
      strong,
      unsupported,
      weak,
      manual,
      senderKeys: kept,
      unsupportedSenderKeys: unsupportedKeys.filter((key) => keptSet.has(key)),
    };
  }

  /**
   * Aggregate today's activity + the workspace tier into the empty-
   * state stats block. Streak / future-emails-skipped / minutes-saved
   * are derived from `activity_log` counts × monthly_volume estimates.
   */
  async getSessionStats(input: {
    mailboxAccountId: string;
    now?: Date;
  }): Promise<TriageSessionStats> {
    const now = input.now ?? new Date();
    const todayStartUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    // Tier comes from the mailbox's workspace. Team/enterprise rank AT
    // pro for the stats union (the plan's Pro gates unlock for
    // tier ∈ {pro, team, enterprise} — see `satisfiesActionTier`).
    const [tierRow] = await this.db
      .select({ tier: workspaces.tier, workspaceId: workspaces.id })
      .from(mailboxAccounts)
      .innerJoin(workspaces, eq(workspaces.id, mailboxAccounts.workspaceId))
      .where(eq(mailboxAccounts.id, input.mailboxAccountId))
      .limit(1);
    const tierEnum = tierRow?.tier ?? 'free';
    const tier: TriageSessionStats['tier'] =
      tierEnum === 'plus' ? 'plus' : tierEnum === 'free' ? 'free' : 'pro';

    // Today's decision counts by verb.
    const todayCounts = await this.db
      .select({ action: activityLog.action, n: count() })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.mailboxAccountId, input.mailboxAccountId),
          gte(activityLog.occurredAt, todayStartUtc),
        ),
      )
      .groupBy(activityLog.action);

    let decidedToday = 0;
    let archivedToday = 0;
    let unsubscribedToday = 0;
    let laterToday = 0;
    for (const row of todayCounts) {
      const n = Number(row.n);
      // Skip non-K/A/U/L/D bookkeeping actions like followup-dismiss.
      if (row.action === 'archive') {
        archivedToday = n;
        decidedToday += n;
      } else if (row.action === 'unsubscribe') {
        unsubscribedToday = n;
        decidedToday += n;
      } else if (row.action === 'later') {
        laterToday = n;
        decidedToday += n;
      } else if (row.action === 'keep') {
        decidedToday += n;
      } else if (row.action === 'delete') {
        decidedToday += n;
      }
    }

    // D19/A3 quota position — cleanup units left THIS PERIOD. One
    // authority: `cleanupSummary` owns the anniversary period + the
    // counting rule; this read must never recompute either.
    const freeRemaining =
      cleanupActionsPerMonthFor(tierEnum) === null || !tierRow
        ? null
        : (await this.entitlements.cleanupSummary(tierRow.workspaceId)).remaining;

    return {
      decidedToday,
      archivedToday,
      unsubscribedToday,
      laterToday,
      freeRemaining,
      tier,
    };
  }

  /**
   * One route bootstrap for the three Triage reads mounted together.
   *
   * `getTodaySummary()` needs the exact D30-clamped queue to compute its
   * decision count and noise share. Fetching `/queue` and `/today-summary`
   * separately therefore executed the same four-statement queue projection
   * twice, behind two independent auth/mailbox guard passes. Share that
   * promise here while stats and the Today aggregates run concurrently.
   */
  async getBootstrap(input: {
    mailboxAccountId: string;
    limit: number;
    now?: Date;
  }): Promise<TriageBootstrapFacts> {
    // ONE window instant for both halves of the noise share — see
    // `noiseWindowStartFrom`.
    const windowStart = noiseWindowStartFrom(input.now);
    const queuePromise = this.listQueue({
      mailboxAccountId: input.mailboxAccountId,
      limit: input.limit,
      windowStart,
    });
    const [queue, stats, todaySummary] = await Promise.all([
      queuePromise,
      this.getSessionStats({
        mailboxAccountId: input.mailboxAccountId,
        ...(input.now === undefined ? {} : { now: input.now }),
      }),
      this.getTodaySummaryFromQueue(input, queuePromise, windowStart),
    ]);
    return { queue, stats, todaySummary };
  }

  /**
   * D214 — aggregate the "Today" strip. Four cheap reads:
   *
   *   1. Today's inbound volume + distinct senders (`mail_messages`,
   *      `internal_date >= today start UTC`, inbound only).
   *   2. Autopilot's handled count (`activity_log.source='autopilot'`,
   *      SUM(affected_count) — messages moved, not rule fires).
   *   3. The queue itself via `listQueue` (same D30 clamp + decided-
   *      sender exclusion the user's queue read uses, so the strip's
   *      decision count can never disagree with the queue below it).
   *   4. The mailbox's last-90d inbound total, for the noise share.
   *
   * D7 / D228: counts over metadata only.
   */
  async getTodaySummary(input: { mailboxAccountId: string; now?: Date }): Promise<TodaySummary> {
    const windowStart = noiseWindowStartFrom(input.now);
    return this.getTodaySummaryFromQueue(
      input,
      this.listQueue({ mailboxAccountId: input.mailboxAccountId, limit: 12, windowStart }),
      windowStart,
    );
  }

  private async getTodaySummaryFromQueue(
    input: { mailboxAccountId: string; now?: Date },
    queuePromise: Promise<TriageQueueFacts[]>,
    windowStart: Date,
  ): Promise<TodaySummary> {
    const now = input.now ?? new Date();
    const todayStartUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    const receivedPromise = this.db
      .select({
        total: count(),
        senders: sql<number>`COUNT(DISTINCT ${mailMessages.senderKey})`,
      })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.mailboxAccountId, input.mailboxAccountId),
          eq(mailMessages.isOutbound, false),
          gte(mailMessages.internalDate, todayStartUtc),
        ),
      );

    const autopilotPromise = this.db
      .select({
        handled: sql<number>`COALESCE(SUM(${activityLog.affectedCount}), 0)`,
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.mailboxAccountId, input.mailboxAccountId),
          eq(activityLog.source, 'autopilot'),
          gte(activityLog.occurredAt, todayStartUtc),
        ),
      );

    // The queue the user will see — same clamp, ordering, and decided-
    // sender exclusion as GET /api/triage/queue. In the bootstrap path
    // this is the SAME promise used for the queue payload, not a repeat.
    const [[received], [autopilot], queueRows] = await Promise.all([
      receivedPromise,
      autopilotPromise,
      queuePromise,
    ]);
    const noiseRows = queueRows.filter((r) => r.verdict !== 'keep');
    const queuedNoise = noiseRows.reduce((sum, r) => sum + r.last90dMessages, 0);

    let noiseReductionPct: number | null = null;
    if (queueRows.length > 0 && queuedNoise > 0) {
      const [volume] = await this.db
        .select({ total: count() })
        .from(mailMessages)
        .where(
          and(
            eq(mailMessages.mailboxAccountId, input.mailboxAccountId),
            eq(mailMessages.isOutbound, false),
            // The SAME cutoff the numerator used. These were two different
            // rules — rolling here, midnight-anchored there — so the share
            // was a ratio between two spans that could differ by a day.
            gte(mailMessages.internalDate, windowStart),
          ),
        );
      noiseReductionPct = noiseSharePct(queuedNoise, Number(volume?.total ?? 0));
    }

    return {
      receivedToday: Number(received?.total ?? 0),
      sendersToday: Number(received?.senders ?? 0),
      handledAutomatically: Number(autopilot?.handled ?? 0),
      queuedDecisions: queueRows.length,
      noiseSenderCount: noiseRows.length,
      noiseReductionPct,
    };
  }
}

/**
 * Render a small fixed set of signals from the aggregated numbers.
 * Lossless w.r.t. user data — these are summaries of fields already
 * shown in the row footer, formatted for the row's expanded view.
 */
function buildSignals(input: {
  readRate: number | null;
  monthlyVolume: number;
  unsubscribeMethod: 'one_click' | 'mailto' | 'none' | null;
}): string[] {
  const signals: string[] = [
    input.readRate === null
      ? 'Read rate: no mail in the last 90 days, so there is nothing to measure'
      : `Read rate: ${Math.round(input.readRate * 100)}% over the last 90 days`,
    `Volume: ${input.monthlyVolume} messages/month (90-day average)`,
  ];
  if (input.unsubscribeMethod === 'one_click') {
    signals.push('List-Unsubscribe header present (RFC 8058 one-click)');
  } else if (input.unsubscribeMethod === 'mailto') {
    signals.push('List-Unsubscribe header is mailto-only (no one-click)');
  }
  return signals;
}

/**
 * Map the DB protection-reason enum to the FE's superset.
 *
 * GATED on `is_protected` (2026-07-10): `protection_reason` MAY be
 * non-NULL while `is_protected = false` — the user-agency-wins memory
 * pin (a manually-demoted sender keeps its reason so the next sync
 * skips re-protect; see sender-policies.ts). Reading the raw reason
 * without the flag showed demoted senders as still protected — and
 * would have forced a Keep recommendation onto a sender the user
 * explicitly demoted.
 */
function mapProtectionReason(
  isProtected: boolean | null | undefined,
  reason: string | null | undefined,
): TriageQueueRow['protectionReason'] {
  if (!isProtected) return null;
  if (reason === 'user_defined') return 'manual';
  if (reason === 'replied') return 'replied';
  if (reason === 'starred') return 'starred';
  if (reason === 'gmail_important') return 'gmail-important';
  return null;
}
