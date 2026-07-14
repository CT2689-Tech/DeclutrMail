// apps/api/src/activity/activity.read-service.ts — read surface for the
// Activity feed (D55-D60, tracer-bullet).
//
// Owns the SELECT against `activity_log` joined to `senders` (identity)
// and `undo_journal` (D58 button state), plus the verb-aggregated stats
// the D59 header shows.
//
// Privacy posture (D7, D228) unchanged: the schema does not expose any
// body-adjacent columns, so the read service cannot leak them.
//
// What's NOT here yet:
//   - Per-sender feed (`GET /senders/:senderKey/activity`) — deferred to a
//     follow-up PR; the current Sender Detail decision-history reads
//     `triage_decisions`, not `activity_log`.
//   - Action-job status join (D56 status filter: In progress / Failed) —
//     the join path is `activity_log → undo_journal → action_jobs` which
//     hits the schema gap noted in the gap map; deferred until the
//     `action_jobs.activity_log_id` denormalization or the read-time
//     join lands.
//   - "Senders" + "Brief" source chips — there is no `'senders'` or
//     `'brief'` value on `activity_source`; would need an enum migration
//     + a corresponding writer change. See FOUNDER-FOLLOWUPS.

import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  min,
  or,
  sql,
  sum,
} from 'drizzle-orm';

import { CANONICAL_SHORTCUTS, type CanonicalVerb } from '@declutrmail/shared/contracts';

import { activityLog, automationRules, mailMessages, senders, undoJournal } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type {
  ActivityRow,
  ActivityStats,
  ActivitySummary,
  ActivityVerbFilter,
  ActivityWindow,
  UndoState,
} from './activity.types.js';
import type { ActivityLogEntry } from '@declutrmail/db';

/** D55 — number of days each window covers; `'all'` returns `null`. */
const WINDOW_DAYS: Record<Exclude<ActivityWindow, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/**
 * Page limit bounds for `GET /api/activity`. Page size matches the
 * Senders list (D202 conventional default) — the Activity feed is a
 * scrolling list, not an infinite feed, so a generous default keeps
 * scroll fluid without inviting unbounded scans.
 */
export const ACTIVITY_LIMIT = { def: 25, min: 1, max: 100 };

/**
 * The five canonical verbs (K/A/U/L/D — D227 + ADR-0019) the DQ16
 * summary counts. Derived from `CANONICAL_SHORTCUTS` (the verb
 * registry's letter map) so a future verb addition propagates here
 * without a parallel literal list. Feature-specific `activity_action`
 * values (`followup-dismiss`, VIP/Protect toggles) are intentionally
 * outside this set — they are not cleanup decisions.
 */
const SUMMARY_VERBS = Object.keys(CANONICAL_SHORTCUTS) as CanonicalVerb[];

export interface SummarizeActivityParams {
  mailboxAccountId: string;
  window: ActivityWindow;
  /** Injected "now" (same contract as `ListActivityParams.nowMs`). */
  nowMs: number;
}

export interface ListActivityParams {
  mailboxAccountId: string;
  window: ActivityWindow;
  source: ActivityLogEntry['source'] | null;
  /**
   * Optional verb filter (B-track Activity power-options). Empty array
   * = no verb filter (all verbs match). Multi-select on the wire — the
   * controller parses CSV / repeat params into this list. Optional on
   * the type so existing call sites that don't filter by verb stay
   * compatible.
   */
  verbs?: ActivityVerbFilter[];
  /**
   * Optional sender substring filter — case-insensitive ILIKE against
   * the joined `senders.display_name` and `senders.email`. Empty
   * string = no filter. Trimmed by the controller before reaching here.
   */
  senderQuery?: string;
  /**
   * Custom date range overrides the `window`-derived lower bound:
   *   - `dateFrom` non-null → `occurred_at >= dateFrom`
   *   - `dateTo`   non-null → `occurred_at <  dateTo`  (exclusive upper)
   * Either may be null/undefined. When set, the window param still
   * echoes back to the FE but no longer affects the rows query.
   */
  dateFrom?: Date | null;
  dateTo?: Date | null;
  cursor: { occurredAt: Date; id: string } | null;
  limit: number;
  /**
   * Injected by the controller / tests so the window boundary is
   * deterministic. The service treats this as "now" for both the
   * rows query and the stats aggregation.
   */
  nowMs: number;
}

export interface ListActivityResult {
  /**
   * `limit + 1` rows (the +1 sentinel powers cursor pagination — the
   * controller slices it off and turns it into `nextCursor`).
   */
  rows: ActivityRow[];
  stats: ActivityStats;
  /**
   * All-time stats — ignores the window / verb / sender / date filters.
   * Powers the B-track "all-time totals" line. Computed in the same
   * call so the FE doesn't need a second round-trip.
   */
  allTimeStats: ActivityStats;
}

@Injectable()
export class ActivityReadService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * List activity rows for a mailbox, newest first.
   *
   * Returns `limit + 1` rows so the controller can detect there's a
   * next page via the sentinel pattern (same as the senders list). The
   * stats counts honour the time window but ignore the source filter
   * — the FE renders source chips on top of an unchanged stats line so
   * "47 archived this month" stays stable as the user switches chips.
   *
   * Index path: `activity_log_account_sender_occurred_idx` covers the
   * `(mailbox, occurred_at DESC)` scan when sender_key is unfiltered.
   * The sender join is a per-row lookup against `senders` (PK on
   * (mailbox, sender_key) — see senders schema), so the page-sized
   * row set drives a bounded N lookup count.
   *
   * The undo journal join resolves `undoState` server-side so the FE
   * branches on a closed discriminator instead of timestamp math
   * (D58: the button is "live" when token exists AND `expires_at > now`
   * AND `executed_at IS NULL`).
   */
  async listActivity(params: ListActivityParams): Promise<ListActivityResult> {
    const {
      mailboxAccountId,
      window,
      source,
      verbs = [],
      senderQuery = '',
      dateFrom = null,
      dateTo = null,
      cursor,
      limit,
      nowMs,
    } = params;
    // Custom date range, when supplied, REPLACES the window-derived
    // lower bound — the FE picker shows whichever wins. When neither
    // dateFrom nor dateTo is set, fall back to the window default
    // (D55 behaviour unchanged).
    const useCustomRange = dateFrom !== null || dateTo !== null;
    const windowStart = useCustomRange ? null : resolveWindowStart(window, nowMs);

    const whereParts = [eq(activityLog.mailboxAccountId, mailboxAccountId)];
    if (windowStart) whereParts.push(gte(activityLog.occurredAt, windowStart));
    if (dateFrom) whereParts.push(gte(activityLog.occurredAt, dateFrom));
    if (dateTo) whereParts.push(lt(activityLog.occurredAt, dateTo));
    if (source) whereParts.push(eq(activityLog.source, source));
    if (verbs.length > 0) whereParts.push(inArray(activityLog.action, verbs));
    if (senderQuery.length > 0) {
      // ILIKE pattern: match anywhere in display_name OR email.
      // sender_key NULL rows (account-scoped actions) drop out — the
      // sender join in the SELECT is a LEFT JOIN, so a sender_q filter
      // implicitly narrows to rows with a resolved sender.
      const pattern = `%${escapeIlikeWildcards(senderQuery)}%`;
      whereParts.push(or(ilike(senders.displayName, pattern), ilike(senders.email, pattern))!);
    }
    if (cursor) {
      // Strict-after-cursor pagination on `(occurred_at DESC, id DESC)`.
      // Same OR-chain shape as senders.list — the boundary row belongs
      // on the prior page (we use `<` not `<=`).
      whereParts.push(
        or(
          lt(activityLog.occurredAt, cursor.occurredAt),
          and(eq(activityLog.occurredAt, cursor.occurredAt), lt(activityLog.id, cursor.id)),
        )!,
      );
    }

    const rows = await this.db
      .select({
        id: activityLog.id,
        occurredAt: activityLog.occurredAt,
        source: activityLog.source,
        action: activityLog.action,
        affectedCount: activityLog.affectedCount,
        senderKey: activityLog.senderKey,
        undoToken: activityLog.undoToken,
        ruleId: activityLog.ruleId,
        ruleName: automationRules.name,
        senderDisplayName: senders.displayName,
        senderEmail: senders.email,
        undoCreatedAt: undoJournal.createdAt,
        undoExpiresAt: undoJournal.expiresAt,
        undoExecutedAt: undoJournal.executedAt,
        undoRevertedAt: undoJournal.revertedAt,
      })
      .from(activityLog)
      .leftJoin(
        senders,
        and(
          eq(senders.mailboxAccountId, activityLog.mailboxAccountId),
          // sender_key is nullable; the join naturally drops to null
          // for account-scoped rows, which is what `ActivityRow.sender`
          // null encodes. Drizzle column refs emit fully-qualified
          // `"table"."col"` SQL — the correlated-subquery footgun
          // from MISTAKES.md 2026-05-23 does not apply here because
          // we're not using `sql.raw`.
          eq(senders.senderKey, activityLog.senderKey),
        ),
      )
      .leftJoin(undoJournal, eq(undoJournal.token, activityLog.undoToken))
      // D57 rule attribution — `rule_id` is non-null only for
      // autopilot-attributed rows, and the FK's `onDelete: 'set null'`
      // keeps a non-null id resolvable; LEFT JOIN stays the defensive
      // shape (a null id simply yields no rule).
      .leftJoin(automationRules, eq(automationRules.id, activityLog.ruleId))
      .where(and(...whereParts))
      .orderBy(desc(activityLog.occurredAt), desc(activityLog.id))
      .limit(limit + 1);

    const projected = rows.map((row): ActivityRow => {
      const sender =
        row.senderKey && row.senderEmail
          ? {
              senderKey: row.senderKey,
              displayName: row.senderDisplayName ?? row.senderEmail,
              email: row.senderEmail,
              domain: domainOf(row.senderEmail),
            }
          : null;

      return {
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        source: row.source,
        action: row.action,
        affectedCount: row.affectedCount,
        sender,
        rule: row.ruleId && row.ruleName !== null ? { id: row.ruleId, name: row.ruleName } : null,
        undoState: resolveUndoState({
          token: row.undoToken,
          expiresAt: row.undoExpiresAt,
          executedAt: row.undoExecutedAt,
          revertedAt: row.undoRevertedAt,
          nowMs,
        }),
      };
    });

    // Stats follow the same window/date bound as the rows query, but
    // IGNORE source/verb/sender so the line stays stable as chips toggle
    // (the chip group narrows the rows; the stats line answers
    // "in this window/date range, what HAPPENED?"). All-time stats
    // ignore EVERY filter and provide a stable running total.
    const statsLowerBound = useCustomRange ? dateFrom : windowStart;
    const statsUpperBound = useCustomRange ? dateTo : null;
    const [stats, allTimeStats] = await Promise.all([
      this.aggregateStats({
        mailboxAccountId,
        lowerBound: statsLowerBound,
        upperBound: statsUpperBound,
      }),
      this.aggregateStats({
        mailboxAccountId,
        lowerBound: null,
        upperBound: null,
      }),
    ]);

    return { rows: projected, stats, allTimeStats };
  }

  /**
   * Verb-aggregated counts within the window. Independent of the source
   * filter so the stats line stays stable as the user toggles source
   * chips — it represents the bucket the rows are drawn from, not the
   * currently-visible subset.
   *
   * Schema gap: D59 "needing attention" maps to failed `action_jobs`
   * rows that the current schema does not surface alongside
   * activity_log; we return 0 until the join lands.
   */
  private async aggregateStats(args: {
    mailboxAccountId: string;
    lowerBound: Date | null;
    upperBound: Date | null;
  }): Promise<ActivityStats> {
    const whereParts = [eq(activityLog.mailboxAccountId, args.mailboxAccountId)];
    if (args.lowerBound) whereParts.push(gte(activityLog.occurredAt, args.lowerBound));
    if (args.upperBound) whereParts.push(lt(activityLog.occurredAt, args.upperBound));

    const rows = await this.db
      .select({
        action: activityLog.action,
        n: count(activityLog.id),
      })
      .from(activityLog)
      .where(and(...whereParts))
      .groupBy(activityLog.action);

    // D33 payoff — summed last-90d volume of the window's deflected
    // senders, projected to per-month. Same join + formula as
    // TriageReadService.projectImpact, windowed to THIS stats range.
    const ninetyDaysAgoIso = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const deflectWhere = [
      eq(activityLog.mailboxAccountId, args.mailboxAccountId),
      sql`${activityLog.action} IN ('archive','unsubscribe','later')`,
    ];
    if (args.lowerBound) deflectWhere.push(gte(activityLog.occurredAt, args.lowerBound));
    if (args.upperBound) deflectWhere.push(lt(activityLog.occurredAt, args.upperBound));
    const [impact] = await this.db
      .select({
        deflectedSenders: sql<number>`COUNT(DISTINCT ${activityLog.senderKey})`,
        last90Total: sql<number>`COALESCE(SUM(CASE WHEN ${mailMessages.internalDate} >= ${ninetyDaysAgoIso}::timestamptz THEN 1 ELSE 0 END), 0)`,
      })
      .from(activityLog)
      .leftJoin(
        mailMessages,
        and(
          eq(mailMessages.mailboxAccountId, activityLog.mailboxAccountId),
          eq(mailMessages.senderKey, activityLog.senderKey),
        ),
      )
      .where(and(...deflectWhere));
    const noisePreventedPerMonth =
      Number(impact?.deflectedSenders ?? 0) > 0
        ? Math.round(Number(impact?.last90Total ?? 0) / 3)
        : null;

    const byVerb = new Map<ActivityLogEntry['action'], number>(
      rows.map((r) => [r.action, Number(r.n)]),
    );
    return {
      archived: byVerb.get('archive') ?? 0,
      // D227 K/A/U/L/D — Delete verb count (ADR-0019).
      deleted: byVerb.get('delete') ?? 0,
      unsubscribed: byVerb.get('unsubscribe') ?? 0,
      kept: byVerb.get('keep') ?? 0,
      later: byVerb.get('later') ?? 0,
      followupsDismissed: byVerb.get('followup-dismiss') ?? 0,
      needsAttention:
        (byVerb.get('unsubscribe_failed') ?? 0) + (byVerb.get('unsubscribe_unconfirmed') ?? 0),
      noisePreventedPerMonth,
    };
  }

  /**
   * Aggregate cleanup totals for one mailbox — the DQ16 share-receipt
   * numbers (see {@link ActivitySummary} for field semantics).
   *
   * Read-only (D204): three aggregate SELECTs, no writes, no events.
   *
   * Sources:
   *   - `activity_log` (append-only, exact) → byVerb / emailsHandled /
   *     decidedSenders / since. Canonical verbs only.
   *   - `undo_journal` (pruned ~1d after expiry) → undoCount, a floor.
   *
   * Index path (D235 awareness): the activity_log aggregates take the
   * same path as {@link aggregateStats} — leading-column equality on
   * `mailbox_account_id` via `activity_log_account_sender_occurred_idx`,
   * then filter/aggregate over the per-mailbox slice. The undo_journal
   * count uses `undo_journal_account_expires_idx`'s leading column the
   * same way, and the journal stays small by construction (expiry
   * pruning). No new index needed at current scale.
   */
  async summarizeActivity(params: SummarizeActivityParams): Promise<ActivitySummary> {
    const { mailboxAccountId, window, nowMs } = params;
    const windowStart = resolveWindowStart(window, nowMs);

    const verbScope = and(
      eq(activityLog.mailboxAccountId, mailboxAccountId),
      inArray(activityLog.action, SUMMARY_VERBS),
      ...(windowStart ? [gte(activityLog.occurredAt, windowStart)] : []),
    );
    // Undos are bounded by WHEN THE UNDO HAPPENED (`reverted_at`), not
    // when the undone action occurred — the receipt answers "how many
    // times did you change your mind in this window?".
    const undoScope = and(
      eq(undoJournal.mailboxAccountId, mailboxAccountId),
      isNotNull(undoJournal.revertedAt),
      ...(windowStart ? [gte(undoJournal.revertedAt, windowStart)] : []),
    );

    const [verbRows, senderRows, undoRows] = await Promise.all([
      this.db
        .select({
          action: activityLog.action,
          n: count(activityLog.id),
          handled: sum(activityLog.affectedCount),
          earliest: min(activityLog.occurredAt),
        })
        .from(activityLog)
        .where(verbScope)
        .groupBy(activityLog.action),
      // COUNT(DISTINCT sender_key) skips NULLs per SQL semantics, so
      // account-scoped rows (sender_key IS NULL) never count as a
      // "decided sender".
      this.db
        .select({ n: countDistinct(activityLog.senderKey) })
        .from(activityLog)
        .where(verbScope),
      this.db
        .select({ n: count(undoJournal.token) })
        .from(undoJournal)
        .where(undoScope),
    ]);

    const byVerb: Record<CanonicalVerb, number> = {
      keep: 0,
      archive: 0,
      unsubscribe: 0,
      later: 0,
      delete: 0,
    };
    let emailsHandled = 0;
    let since: Date | null = null;
    for (const row of verbRows) {
      // The WHERE clause restricts `action` to SUMMARY_VERBS — the
      // narrowing cast cannot observe a non-canonical value.
      byVerb[row.action as CanonicalVerb] = Number(row.n);
      emailsHandled += Number(row.handled ?? 0);
      if (row.earliest && (since === null || row.earliest < since)) since = row.earliest;
    }

    return {
      window,
      since: since ? since.toISOString() : null,
      decidedSenders: Number(senderRows[0]?.n ?? 0),
      byVerb,
      emailsHandled,
      undoCount: Number(undoRows[0]?.n ?? 0),
    };
  }
}

/**
 * Resolve the start-of-window timestamp for `windowStart <= occurred_at`.
 * `'all'` returns `null` (no lower bound).
 */
function resolveWindowStart(window: ActivityWindow, nowMs: number): Date | null {
  if (window === 'all') return null;
  const days = WINDOW_DAYS[window];
  return new Date(nowMs - days * 24 * 60 * 60 * 1000);
}

/**
 * Escape `%` / `_` / `\` in a user-supplied ILIKE pattern so the search
 * input is treated as a literal substring, not a glob. The pattern is
 * wrapped with `%` at the call site for substring matching; the user
 * can't smuggle their own wildcards through.
 */
function escapeIlikeWildcards(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/[%_]/g, (m) => `\\${m}`);
}

/**
 * Resolve the D58 undo affordance state from the raw journal columns.
 *
 *   no token                          → `unavailable`
 *   token but already executed        → `executed`
 *   token, not executed, expires>now  → `available`
 *   token, not executed, expires≤now  → `expired`
 *
 * `revertedAt` is treated as "executed" for FE purposes — the user
 * already saw the undo land.
 */
function resolveUndoState(args: {
  token: string | null;
  expiresAt: Date | null;
  executedAt: Date | null;
  revertedAt: Date | null;
  nowMs: number;
}): UndoState {
  if (!args.token) return { kind: 'unavailable' };
  if (args.revertedAt) return { kind: 'executed', executedAt: args.revertedAt.toISOString() };
  if (args.executedAt) return { kind: 'executed', executedAt: args.executedAt.toISOString() };
  if (args.expiresAt && args.expiresAt.getTime() > args.nowMs) {
    return { kind: 'available', token: args.token, expiresAt: args.expiresAt.toISOString() };
  }
  return {
    kind: 'expired',
    expiredAt: args.expiresAt ? args.expiresAt.toISOString() : new Date(args.nowMs).toISOString(),
  };
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? email : email.slice(at + 1);
}
