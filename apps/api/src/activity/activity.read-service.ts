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
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  min,
  notExists,
  or,
  sql,
  sum,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { CANONICAL_SHORTCUTS, type CanonicalVerb } from '@declutrmail/shared/contracts';

import {
  actionJobs,
  activityLog,
  automationRules,
  mailMessages,
  productFeedback,
  ruleMatchLog,
  senders,
  undoJournal,
} from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type {
  ActivityRow,
  ActivityExecutionState,
  ActivityReviewOutcome,
  ActivityStats,
  ActivitySummary,
  ActivityVerbFilter,
  ActivityWindow,
  ActivityWeeklyReview,
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
 * values (`followup-dismiss`, Protect toggles) are intentionally
 * outside this set — they are not cleanup decisions.
 */
const SUMMARY_VERBS = Object.keys(CANONICAL_SHORTCUTS) as CanonicalVerb[];

const EXECUTION_VERBS = ['archive', 'later', 'delete'] as const;
type ExecutionVerb = (typeof EXECUTION_VERBS)[number];
type ExecutionAttempt = Pick<
  typeof actionJobs.$inferSelect,
  | 'id'
  | 'rootActionId'
  | 'verb'
  | 'status'
  | 'selector'
  | 'requestedCount'
  | 'errorCode'
  | 'createdAt'
  | 'updatedAt'
  | 'recoveryAttempt'
>;

interface ExecutionLineage {
  root: ExecutionAttempt;
  current: ExecutionAttempt;
  sender: ActivityRow['sender'];
}

export interface SummarizeActivityParams {
  mailboxAccountId: string;
  window: ActivityWindow;
  /** Injected "now" (same contract as `ListActivityParams.nowMs`). */
  nowMs: number;
}

export interface ListActivityParams {
  mailboxAccountId: string;
  /**
   * Current user whose Activity feedback should be projected. Null/omitted for
   * support-bundle iteration, where user-specific feedback is intentionally absent.
   */
  userId?: string | null;
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
  /** Optional D246 evidence-link outcome filter. Empty = all rows. */
  outcomes?: ActivityReviewOutcome[];
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

export type IterateActivityParams = Omit<ListActivityParams, 'cursor' | 'limit'>;

export interface ActivityIterationSnapshot {
  readonly createdAt: Date;
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
    const { mailboxAccountId, window, dateFrom = null, dateTo = null, nowMs } = params;
    // Custom date range, when supplied, REPLACES the window-derived
    // lower bound — the FE picker shows whichever wins. When neither
    // dateFrom nor dateTo is set, fall back to the window default
    // (D55 behaviour unchanged).
    const useCustomRange = dateFrom !== null || dateTo !== null;
    const windowStart = useCustomRange ? null : resolveWindowStart(window, nowMs);

    const executionLineages = await this.loadExecutionLineages(mailboxAccountId);
    const rows = await this.loadActivityRows(params, executionLineages);

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
        executionLineages,
      }),
      this.aggregateStats({
        mailboxAccountId,
        lowerBound: null,
        upperBound: null,
        executionLineages,
      }),
    ]);

    return { rows, stats, allTimeStats };
  }

  /**
   * Iterate the complete filtered Activity result with the same keyset
   * semantics as the paginated screen. Callers choose a bounded batch size;
   * no row array grows with mailbox history.
   */
  async *iterateActivity(
    params: IterateActivityParams,
    batchSize = 500,
    snapshot?: ActivityIterationSnapshot,
  ): AsyncGenerator<ActivityRow> {
    const activeSnapshot =
      snapshot ?? (await this.captureIterationSnapshot(params.mailboxAccountId));
    const persisted = this.iteratePersistedActivity(params, batchSize, activeSnapshot.createdAt);
    const executions = this.iterateExecutionActivity(params, batchSize, activeSnapshot.createdAt);
    let [persistedNext, executionNext] = await Promise.all([persisted.next(), executions.next()]);

    while (!persistedNext.done || !executionNext.done) {
      if (
        executionNext.done ||
        (!persistedNext.done &&
          compareActivityRowsNewestFirst(persistedNext.value, executionNext.value) <= 0)
      ) {
        yield persistedNext.value;
        persistedNext = await persisted.next();
      } else {
        yield executionNext.value;
        executionNext = await executions.next();
      }
    }
  }

  private async *iteratePersistedActivity(
    params: IterateActivityParams,
    batchSize: number,
    snapshotCreatedAt: Date,
  ): AsyncGenerator<ActivityRow> {
    let cursor: ListActivityParams['cursor'] = null;
    for (;;) {
      const rows = await this.loadActivityRows(
        { ...params, cursor, limit: batchSize },
        [],
        snapshotCreatedAt,
      );
      const page = rows.slice(0, batchSize);
      for (const row of page) yield row;
      if (rows.length <= batchSize || page.length === 0) return;
      const last = page[page.length - 1]!;
      cursor = { occurredAt: new Date(last.occurredAt), id: last.id };
    }
  }

  private async *iterateExecutionActivity(
    params: IterateActivityParams,
    batchSize: number,
    snapshotCreatedAt: Date,
  ): AsyncGenerator<ActivityRow> {
    if (params.source !== null && params.source !== 'manual') return;
    const useCustomRange = params.dateFrom !== null && params.dateFrom !== undefined;
    const hasCustomUpperBound = params.dateTo !== null && params.dateTo !== undefined;
    const lowerBound =
      useCustomRange || hasCustomUpperBound
        ? (params.dateFrom ?? null)
        : resolveWindowStart(params.window, params.nowMs);
    const upperBound = params.dateTo ?? null;
    let cursor: { occurredAt: Date; id: string } | null = null;

    for (;;) {
      const attempts = await this.loadCurrentExecutionAttempts({
        ...params,
        lowerBound,
        upperBound,
        cursor,
        limit: batchSize,
        snapshotCreatedAt,
      });
      if (attempts.length === 0) return;
      const lineages = await this.hydrateCurrentExecutionLineages(
        params.mailboxAccountId,
        attempts,
      );
      const rows = projectExecutionRows(lineages, {
        source: params.source,
        verbs: params.verbs ?? [],
        senderQuery: params.senderQuery ?? '',
        lowerBound,
        upperBound,
        cursor: null,
      });
      for (const row of rows) yield row;
      if (attempts.length < batchSize) return;
      const last = attempts[attempts.length - 1]!;
      cursor = { occurredAt: executionOutcomeTime(last), id: last.id };
    }
  }

  async captureIterationSnapshot(mailboxAccountId: string): Promise<ActivityIterationSnapshot> {
    void mailboxAccountId;
    return { createdAt: new Date() };
  }

  private async loadCurrentExecutionAttempts(args: {
    mailboxAccountId: string;
    verbs?: ActivityVerbFilter[];
    lowerBound: Date | null;
    upperBound: Date | null;
    cursor: { occurredAt: Date; id: string } | null;
    limit: number;
    snapshotCreatedAt: Date;
  }): Promise<ExecutionAttempt[]> {
    const current = alias(actionJobs, 'activity_export_current');
    const later = alias(actionJobs, 'activity_export_later');
    const outcomeTime = sql<Date>`case
      when ${current.status} = 'failed' then ${current.updatedAt}
      else ${current.createdAt}
    end`;
    const whereParts = [
      eq(current.mailboxAccountId, args.mailboxAccountId),
      eq(current.direction, 'forward' as const),
      inArray(current.verb, EXECUTION_VERBS),
      inArray(current.status, ['queued', 'executing', 'failed'] as const),
      lte(outcomeTime, timestamptzParam(args.snapshotCreatedAt)),
      notExists(
        this.db
          .select({ id: later.id })
          .from(later)
          .where(
            and(
              eq(later.mailboxAccountId, args.mailboxAccountId),
              eq(later.direction, 'forward' as const),
              lte(later.createdAt, args.snapshotCreatedAt),
              sql`coalesce(${later.rootActionId}, ${later.id}) = coalesce(${current.rootActionId}, ${current.id})`,
              gt(later.recoveryAttempt, current.recoveryAttempt),
            ),
          ),
      ),
    ];
    if (args.verbs && args.verbs.length > 0) {
      const executionVerbs = args.verbs.filter((verb): verb is ExecutionVerb =>
        EXECUTION_VERBS.includes(verb as ExecutionVerb),
      );
      if (executionVerbs.length === 0) return [];
      whereParts.push(inArray(current.verb, executionVerbs));
    }
    if (args.lowerBound) whereParts.push(gte(outcomeTime, timestamptzParam(args.lowerBound)));
    if (args.upperBound) whereParts.push(lt(outcomeTime, timestamptzParam(args.upperBound)));
    if (args.cursor) {
      const cursorTime = timestamptzParam(args.cursor.occurredAt);
      whereParts.push(
        or(
          lt(outcomeTime, cursorTime),
          and(eq(outcomeTime, cursorTime), lt(current.id, args.cursor.id)),
        )!,
      );
    }
    return this.db
      .select({
        id: current.id,
        rootActionId: current.rootActionId,
        verb: current.verb,
        status: current.status,
        selector: current.selector,
        requestedCount: current.requestedCount,
        errorCode: current.errorCode,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        recoveryAttempt: current.recoveryAttempt,
      })
      .from(current)
      .where(and(...whereParts))
      .orderBy(desc(outcomeTime), desc(current.id))
      .limit(args.limit);
  }

  private async hydrateCurrentExecutionLineages(
    mailboxAccountId: string,
    attempts: readonly ExecutionAttempt[],
  ): Promise<ExecutionLineage[]> {
    const rootIds = [...new Set(attempts.map((attempt) => attempt.rootActionId ?? attempt.id))];
    const roots = await this.db
      .select({
        id: actionJobs.id,
        rootActionId: actionJobs.rootActionId,
        verb: actionJobs.verb,
        status: actionJobs.status,
        selector: actionJobs.selector,
        requestedCount: actionJobs.requestedCount,
        errorCode: actionJobs.errorCode,
        createdAt: actionJobs.createdAt,
        updatedAt: actionJobs.updatedAt,
        recoveryAttempt: actionJobs.recoveryAttempt,
      })
      .from(actionJobs)
      .where(
        and(eq(actionJobs.mailboxAccountId, mailboxAccountId), inArray(actionJobs.id, rootIds)),
      );
    const rootsById = new Map(roots.map((root) => [root.id, root]));
    const senderKeys = [
      ...new Set(
        roots.flatMap((root) => (root.selector.type === 'sender' ? [root.selector.senderKey] : [])),
      ),
    ];
    const senderRows =
      senderKeys.length === 0
        ? []
        : await this.db
            .select({
              senderKey: senders.senderKey,
              displayName: senders.displayName,
              email: senders.email,
            })
            .from(senders)
            .where(
              and(
                eq(senders.mailboxAccountId, mailboxAccountId),
                inArray(senders.senderKey, senderKeys),
              ),
            );
    const sendersByKey = new Map(
      senderRows.map((sender) => [
        sender.senderKey,
        {
          senderKey: sender.senderKey,
          displayName: sender.displayName ?? sender.email,
          email: sender.email,
          domain: domainOf(sender.email),
        },
      ]),
    );
    return attempts.flatMap((current): ExecutionLineage[] => {
      const root = rootsById.get(current.rootActionId ?? current.id);
      if (!root) return [];
      const senderKey = root.selector.type === 'sender' ? root.selector.senderKey : null;
      return [{ root, current, sender: senderKey ? (sendersByKey.get(senderKey) ?? null) : null }];
    });
  }

  private async loadActivityRows(
    params: ListActivityParams,
    executionLineages: readonly ExecutionLineage[],
    snapshotCreatedAt: Date | null = null,
  ): Promise<ActivityRow[]> {
    const {
      mailboxAccountId,
      userId = null,
      window,
      source,
      verbs = [],
      senderQuery = '',
      dateFrom = null,
      dateTo = null,
      outcomes = [],
      cursor,
      limit,
      nowMs,
    } = params;
    const useCustomRange = dateFrom !== null || dateTo !== null;
    const windowStart = useCustomRange ? null : resolveWindowStart(window, nowMs);
    const whereParts = [eq(activityLog.mailboxAccountId, mailboxAccountId)];
    const reviewOutcomeExpression = persistedReviewOutcomeExpression();
    if (windowStart) whereParts.push(gte(activityLog.occurredAt, windowStart));
    if (dateFrom) whereParts.push(gte(activityLog.occurredAt, dateFrom));
    if (dateTo) whereParts.push(lt(activityLog.occurredAt, dateTo));
    if (snapshotCreatedAt) whereParts.push(lte(activityLog.createdAt, snapshotCreatedAt));
    if (source) whereParts.push(eq(activityLog.source, source));
    if (verbs.length > 0) whereParts.push(inArray(activityLog.action, verbs));
    if (outcomes.length > 0) whereParts.push(inArray(reviewOutcomeExpression, outcomes));
    if (senderQuery.length > 0) {
      const pattern = `%${escapeIlikeWildcards(senderQuery)}%`;
      whereParts.push(or(ilike(senders.displayName, pattern), ilike(senders.email, pattern))!);
    }
    if (cursor) {
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
        actionJobId: activityLog.actionJobId,
        ruleId: activityLog.ruleId,
        ruleName: automationRules.name,
        senderDisplayName: senders.displayName,
        senderEmail: senders.email,
        undoExpiresAt: undoJournal.expiresAt,
        undoExecutedAt: undoJournal.executedAt,
        undoRevertedAt: undoJournal.revertedAt,
        feedbackRating: userId
          ? sql<'expected' | 'surprising' | null>`(
              SELECT ${productFeedback.rating}
              FROM ${productFeedback}
              WHERE ${productFeedback.activityLogId} = ${activityLog.id}
                AND ${productFeedback.mailboxAccountId} = ${activityLog.mailboxAccountId}
                AND ${productFeedback.userId} = ${userId}
                AND ${productFeedback.surface} = 'activity'
              LIMIT 1
            )`
          : sql<'expected' | 'surprising' | null>`NULL`,
        reviewOutcome: reviewOutcomeExpression,
      })
      .from(activityLog)
      .leftJoin(
        senders,
        and(
          eq(senders.mailboxAccountId, activityLog.mailboxAccountId),
          eq(senders.senderKey, activityLog.senderKey),
        ),
      )
      .leftJoin(undoJournal, eq(undoJournal.token, activityLog.undoToken))
      .leftJoin(
        automationRules,
        and(
          eq(automationRules.id, activityLog.ruleId),
          eq(automationRules.mailboxAccountId, activityLog.mailboxAccountId),
        ),
      )
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
        feedbackRating:
          row.feedbackRating === 'expected' || row.feedbackRating === 'surprising'
            ? row.feedbackRating
            : null,
        undoState: resolveUndoState({
          token: row.undoToken,
          expiresAt: row.undoExpiresAt,
          executedAt: row.undoExecutedAt,
          revertedAt: row.undoRevertedAt,
          nowMs,
        }),
        executionState: null,
        reviewOutcome: row.reviewOutcome,
      };
    });
    const executionRows = projectExecutionRows(executionLineages, {
      source,
      verbs,
      senderQuery,
      lowerBound: dateFrom ?? windowStart,
      upperBound: dateTo,
      cursor,
      outcomes,
    });
    const ruleReviewRows = await this.loadRuleReviewRows(params);
    return [...projected, ...executionRows, ...ruleReviewRows]
      .sort(compareActivityRowsNewestFirst)
      .slice(0, limit + 1);
  }

  /** Project resolved Observe skips/protection blocks as factual Activity evidence. */
  private async loadRuleReviewRows(params: ListActivityParams): Promise<ActivityRow[]> {
    const {
      mailboxAccountId,
      window,
      source,
      verbs = [],
      senderQuery = '',
      dateFrom = null,
      dateTo = null,
      outcomes = [],
      cursor,
      limit,
      nowMs,
    } = params;
    if (source !== null && source !== 'autopilot') return [];
    if (!outcomes.some((value) => value === 'skipped' || value === 'protected')) {
      return [];
    }
    const actionVerbs = verbs.filter(
      (verb): verb is 'archive' | 'unsubscribe' | 'later' =>
        verb === 'archive' || verb === 'unsubscribe' || verb === 'later',
    );
    if (verbs.length > 0 && actionVerbs.length === 0) return [];
    const useCustomRange = dateFrom !== null || dateTo !== null;
    const windowStart = useCustomRange ? null : resolveWindowStart(window, nowMs);
    // Column reference, not a raw `sql` wrapper: postgres.js only accepts
    // Date params when drizzle can map them through a column's encoder.
    const reviewTime = ruleMatchLog.resolvedAt;
    const whereParts = [
      eq(ruleMatchLog.mailboxAccountId, mailboxAccountId),
      eq(ruleMatchLog.resolution, 'dismissed' as const),
      inArray(ruleMatchLog.dismissReason, ['user', 'protected'] as const),
      isNotNull(ruleMatchLog.resolvedAt),
    ];
    if (windowStart) whereParts.push(gte(reviewTime, windowStart));
    if (dateFrom) whereParts.push(gte(reviewTime, dateFrom));
    if (dateTo) whereParts.push(lt(reviewTime, dateTo));
    if (actionVerbs.length > 0) whereParts.push(inArray(automationRules.actionKind, actionVerbs));
    if (outcomes.length > 0) {
      const reasons = outcomes.flatMap((outcome) =>
        outcome === 'skipped'
          ? (['user'] as const)
          : outcome === 'protected'
            ? (['protected'] as const)
            : [],
      );
      whereParts.push(inArray(ruleMatchLog.dismissReason, reasons));
    }
    if (senderQuery.length > 0) {
      const pattern = `%${escapeIlikeWildcards(senderQuery)}%`;
      whereParts.push(or(ilike(senders.displayName, pattern), ilike(senders.email, pattern))!);
    }
    if (cursor) {
      whereParts.push(
        or(
          lt(reviewTime, cursor.occurredAt),
          and(eq(reviewTime, cursor.occurredAt), lt(ruleMatchLog.id, cursor.id)),
        )!,
      );
    }
    const rows = await this.db
      .select({
        id: ruleMatchLog.id,
        occurredAt: reviewTime,
        action: automationRules.actionKind,
        ruleId: automationRules.id,
        ruleName: automationRules.name,
        senderKey: ruleMatchLog.senderKey,
        senderDisplayName: senders.displayName,
        senderEmail: senders.email,
        dismissReason: ruleMatchLog.dismissReason,
      })
      .from(ruleMatchLog)
      .innerJoin(
        automationRules,
        and(
          eq(automationRules.id, ruleMatchLog.ruleId),
          eq(automationRules.mailboxAccountId, ruleMatchLog.mailboxAccountId),
        ),
      )
      .leftJoin(
        senders,
        and(
          eq(senders.mailboxAccountId, ruleMatchLog.mailboxAccountId),
          eq(senders.senderKey, ruleMatchLog.senderKey),
        ),
      )
      .where(and(...whereParts))
      .orderBy(desc(reviewTime), desc(ruleMatchLog.id))
      .limit(limit + 1);
    return rows.map((row) => ({
      id: row.id,
      // `resolvedAt` is `isNotNull`-filtered above; the column type stays nullable.
      occurredAt: new Date(row.occurredAt!).toISOString(),
      source: 'autopilot',
      action: row.action,
      affectedCount: 0,
      sender:
        row.senderEmail === null
          ? null
          : {
              senderKey: row.senderKey,
              displayName: row.senderDisplayName ?? row.senderEmail,
              email: row.senderEmail,
              domain: domainOf(row.senderEmail),
            },
      rule: { id: row.ruleId, name: row.ruleName },
      feedbackRating: null,
      undoState: { kind: 'unavailable' },
      executionState: null,
      reviewOutcome: row.dismissReason === 'protected' ? 'protected' : 'skipped',
    }));
  }

  /** Exact factual counts for the seven-day in-app review. */
  async getWeeklyReview(mailboxAccountId: string, nowMs: number): Promise<ActivityWeeklyReview> {
    const cutoff = new Date(nowMs - 7 * 86_400_000);
    const upperBound = new Date(nowMs);
    const reviewOutcome = persistedReviewOutcomeExpression();
    const failedCurrent = alias(actionJobs, 'weekly_failed_current');
    const failedLater = alias(actionJobs, 'weekly_failed_later');
    const [persisted, dismissed, unresolved] = await Promise.all([
      this.db
        .select({
          completed: sql<number>`count(*) filter (where ${reviewOutcome} = 'completed')::int`,
          failed: sql<number>`count(*) filter (where ${reviewOutcome} = 'failed')::int`,
          recovered: sql<number>`count(*) filter (where ${reviewOutcome} = 'recovered')::int`,
        })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.mailboxAccountId, mailboxAccountId),
            gte(activityLog.occurredAt, cutoff),
            lt(activityLog.occurredAt, upperBound),
          ),
        ),
      this.db
        .select({ reason: ruleMatchLog.dismissReason, n: count(ruleMatchLog.id) })
        .from(ruleMatchLog)
        .where(
          and(
            eq(ruleMatchLog.mailboxAccountId, mailboxAccountId),
            eq(ruleMatchLog.resolution, 'dismissed'),
            inArray(ruleMatchLog.dismissReason, ['user', 'protected'] as const),
            isNotNull(ruleMatchLog.resolvedAt),
            gte(ruleMatchLog.resolvedAt, cutoff),
            lt(ruleMatchLog.resolvedAt, upperBound),
          ),
        )
        .groupBy(ruleMatchLog.dismissReason),
      this.db
        .select({ n: count(failedCurrent.id) })
        .from(failedCurrent)
        .where(
          and(
            eq(failedCurrent.mailboxAccountId, mailboxAccountId),
            eq(failedCurrent.direction, 'forward'),
            inArray(failedCurrent.verb, EXECUTION_VERBS),
            eq(failedCurrent.status, 'failed'),
            gte(failedCurrent.updatedAt, cutoff),
            lt(failedCurrent.updatedAt, upperBound),
            notExists(
              this.db
                .select({ id: failedLater.id })
                .from(failedLater)
                .where(
                  and(
                    eq(failedLater.mailboxAccountId, mailboxAccountId),
                    eq(failedLater.direction, 'forward'),
                    sql`coalesce(${failedLater.rootActionId}, ${failedLater.id}) = coalesce(${failedCurrent.rootActionId}, ${failedCurrent.id})`,
                    gt(failedLater.recoveryAttempt, failedCurrent.recoveryAttempt),
                    lt(failedLater.createdAt, upperBound),
                  ),
                ),
            ),
          ),
        ),
    ]);
    const persistedCounts = persisted[0];
    const dismissCounts = new Map(dismissed.map((row) => [row.reason, Number(row.n)]));
    const unresolvedFailures = Number(unresolved[0]?.n ?? 0);
    return {
      window: '7d',
      from: cutoff.toISOString(),
      to: upperBound.toISOString(),
      completed: Number(persistedCounts?.completed ?? 0),
      skipped: dismissCounts.get('user') ?? 0,
      failed: Number(persistedCounts?.failed ?? 0) + unresolvedFailures,
      recovered: Number(persistedCounts?.recovered ?? 0),
      protected: dismissCounts.get('protected') ?? 0,
    };
  }

  /**
   * Load each unresolved forward label-action lineage once. Root rows own
   * the original intent; recovery rows point back through `root_action_id`.
   * A successful recovery resolves the lineage and removes it from Activity,
   * while the latest non-successful attempt supplies the visible state.
   */
  private async loadExecutionLineages(mailboxAccountId: string): Promise<ExecutionLineage[]> {
    const roots = await this.db
      .select({
        id: actionJobs.id,
        rootActionId: actionJobs.rootActionId,
        verb: actionJobs.verb,
        status: actionJobs.status,
        selector: actionJobs.selector,
        requestedCount: actionJobs.requestedCount,
        errorCode: actionJobs.errorCode,
        createdAt: actionJobs.createdAt,
        updatedAt: actionJobs.updatedAt,
        recoveryAttempt: actionJobs.recoveryAttempt,
      })
      .from(actionJobs)
      .where(
        and(
          eq(actionJobs.mailboxAccountId, mailboxAccountId),
          isNull(actionJobs.rootActionId),
          eq(actionJobs.direction, 'forward'),
          inArray(actionJobs.verb, EXECUTION_VERBS),
          inArray(actionJobs.status, ['queued', 'executing', 'failed']),
        ),
      );
    if (roots.length === 0) return [];

    const rootIds = roots.map((root) => root.id);
    const senderKeys = roots.flatMap((root) =>
      root.selector.type === 'sender' ? [root.selector.senderKey] : [],
    );
    const [recoveries, senderRows] = await Promise.all([
      this.db
        .select({
          id: actionJobs.id,
          rootActionId: actionJobs.rootActionId,
          verb: actionJobs.verb,
          status: actionJobs.status,
          selector: actionJobs.selector,
          requestedCount: actionJobs.requestedCount,
          errorCode: actionJobs.errorCode,
          createdAt: actionJobs.createdAt,
          updatedAt: actionJobs.updatedAt,
          recoveryAttempt: actionJobs.recoveryAttempt,
        })
        .from(actionJobs)
        .where(
          and(
            eq(actionJobs.mailboxAccountId, mailboxAccountId),
            eq(actionJobs.direction, 'forward'),
            inArray(actionJobs.rootActionId, rootIds),
          ),
        ),
      senderKeys.length === 0
        ? Promise.resolve([])
        : this.db
            .select({
              senderKey: senders.senderKey,
              displayName: senders.displayName,
              email: senders.email,
            })
            .from(senders)
            .where(
              and(
                eq(senders.mailboxAccountId, mailboxAccountId),
                inArray(senders.senderKey, senderKeys),
              ),
            ),
    ]);

    const recoveriesByRoot = new Map<string, ExecutionAttempt[]>();
    for (const recovery of recoveries) {
      if (!recovery.rootActionId) continue;
      const attempts = recoveriesByRoot.get(recovery.rootActionId) ?? [];
      attempts.push(recovery);
      recoveriesByRoot.set(recovery.rootActionId, attempts);
    }
    const senderByKey = new Map(
      senderRows.map((sender) => [
        sender.senderKey,
        {
          senderKey: sender.senderKey,
          displayName: sender.displayName ?? sender.email,
          email: sender.email,
          domain: domainOf(sender.email),
        },
      ]),
    );

    const lineages: ExecutionLineage[] = [];
    for (const root of roots) {
      const attempts = recoveriesByRoot.get(root.id) ?? [];
      if (attempts.some((attempt) => attempt.status === 'done')) continue;
      const current = attempts.reduce<ExecutionAttempt>(
        (latest, attempt) => (compareExecutionAttempts(attempt, latest) > 0 ? attempt : latest),
        root,
      );
      if (!isUnresolvedExecutionStatus(current.status)) continue;
      const senderKey = root.selector.type === 'sender' ? root.selector.senderKey : null;
      lineages.push({
        root,
        current,
        sender: senderKey ? (senderByKey.get(senderKey) ?? null) : null,
      });
    }
    return lineages;
  }

  /**
   * Verb-aggregated counts within the window. Independent of the source
   * filter so the stats line stays stable as the user toggles source
   * chips — it represents the bucket the rows are drawn from, not the
   * currently-visible subset.
   *
   * Failed label-action lineages are counted from the same synthetic
   * execution projection as the rows, once per original user intent.
   */
  private async aggregateStats(args: {
    mailboxAccountId: string;
    lowerBound: Date | null;
    upperBound: Date | null;
    executionLineages: ExecutionLineage[];
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
    // Historical message-volume context, windowed to THIS stats range.
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
        (byVerb.get('unsubscribe_failed') ?? 0) +
        (byVerb.get('unsubscribe_unconfirmed') ?? 0) +
        countFailedExecutionLineages(args.executionLineages, args.lowerBound, args.upperBound),
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

function projectExecutionRows(
  lineages: readonly ExecutionLineage[],
  filters: {
    source: ActivityLogEntry['source'] | null;
    verbs: ActivityVerbFilter[];
    senderQuery: string;
    lowerBound: Date | null;
    upperBound: Date | null;
    cursor: { occurredAt: Date; id: string } | null;
    outcomes?: ActivityReviewOutcome[];
  },
): ActivityRow[] {
  if (filters.source !== null && filters.source !== 'manual') return [];
  const senderNeedle = filters.senderQuery.toLocaleLowerCase();

  return lineages.flatMap((lineage): ActivityRow[] => {
    const { root, current, sender } = lineage;
    const outcomeTime = current.status === 'failed' ? current.updatedAt : current.createdAt;
    if (!EXECUTION_VERBS.includes(root.verb as ExecutionVerb)) return [];
    const action = root.verb as ExecutionVerb;
    if (filters.verbs.length > 0 && !filters.verbs.includes(action)) return [];
    if (filters.lowerBound && outcomeTime < filters.lowerBound) return [];
    if (filters.upperBound && outcomeTime >= filters.upperBound) return [];
    if (senderNeedle.length > 0) {
      if (!sender) return [];
      const matchesSender =
        sender.displayName.toLocaleLowerCase().includes(senderNeedle) ||
        sender.email.toLocaleLowerCase().includes(senderNeedle);
      if (!matchesSender) return [];
    }
    if (
      filters.cursor &&
      !isStrictlyAfterCursor({ id: current.id, createdAt: outcomeTime }, filters.cursor)
    )
      return [];
    const reviewOutcome: ActivityReviewOutcome | null =
      current.status === 'failed' ? 'failed' : null;
    if (
      (filters.outcomes?.length ?? 0) > 0 &&
      (!reviewOutcome || !filters.outcomes!.includes(reviewOutcome))
    ) {
      return [];
    }

    return [
      {
        id: current.id,
        occurredAt: outcomeTime.toISOString(),
        source: 'manual',
        action,
        affectedCount: 0,
        sender,
        rule: null,
        feedbackRating: null,
        undoState: { kind: 'unavailable' },
        executionState: executionStateFor(lineage),
        reviewOutcome,
      },
    ];
  });
}

/**
 * Classify append-only Activity rows without inventing success. The
 * unsubscribe intent/manual-progress rows remain null until a terminal
 * outcome arrives. Successful linked recovery jobs are recovered.
 *
 * A user-reverted (Undo) action no longer stands, so it belongs to no
 * outcome bucket — counting it as completed/recovered would claim mail
 * the review's own recovery path put back. The journal outlives every
 * 7-day weekly-review window (expiry >= issue + 7d, pruned 1d later);
 * custom date ranges older than that lose undo provenance when the
 * journal is pruned, by design (D232 — no read path after expiry).
 */
function persistedReviewOutcomeExpression() {
  return sql<ActivityReviewOutcome | null>`case
    when ${activityLog.undoToken} is not null and exists (
      select 1 from undo_journal undone
      where undone.token = ${activityLog.undoToken}
        and undone.mailbox_account_id = ${activityLog.mailboxAccountId}
        and undone.reverted_at is not null
    ) then null
    when ${activityLog.actionJobId} is not null and exists (
      select 1 from action_jobs recovery
      where recovery.id = ${activityLog.actionJobId}
        and recovery.mailbox_account_id = ${activityLog.mailboxAccountId}
        and recovery.root_action_id is not null
        and recovery.recovery_attempt > 0
        and recovery.status = 'done'
    ) then 'recovered'
    when ${activityLog.undoToken} is not null and exists (
      select 1 from action_jobs recovery
      where recovery.mailbox_account_id = ${activityLog.mailboxAccountId}
        and recovery.root_action_id is not null
        and recovery.recovery_attempt > 0
        and recovery.status = 'done'
        and recovery.undo_token = ${activityLog.undoToken}
    ) then 'recovered'
    when ${activityLog.action} in (
      'unsubscribe',
      'unsubscribe_action_required',
      'unsubscribe_draft_opened'
    ) then null
    when ${activityLog.action} in (
      'unsubscribe_failed',
      'unsubscribe_unconfirmed',
      'unsubscribe_unavailable'
    ) then 'failed'
    when ${activityLog.action} in (
      'keep',
      'archive',
      'later',
      'delete',
      'followup-dismiss',
      'marked_protected',
      'unmarked_protected',
      'unsubscribe_confirmed',
      'unsubscribe_endpoint_accepted',
      'unsubscribe_user_marked_sent'
    ) then 'completed'
    else null
  end`;
}

function executionOutcomeTime(attempt: ExecutionAttempt): Date {
  return attempt.status === 'failed' ? attempt.updatedAt : attempt.createdAt;
}

function executionStateFor(lineage: ExecutionLineage): ActivityExecutionState {
  const { root, current } = lineage;
  if (current.status === 'queued' || current.status === 'executing') {
    return {
      kind: 'in_progress',
      actionId: current.id,
      requestedCount: current.requestedCount,
      isRecovery: current.rootActionId !== null,
      status: current.status,
    };
  }
  return {
    kind: 'failed',
    actionId: current.id,
    rootActionId: root.id,
    requestedCount: current.requestedCount,
    errorCode: current.errorCode,
    resolution: failureResolution(current.errorCode),
  };
}

function failureResolution(errorCode: string | null): 'review' | 'support' {
  if (errorCode === 'ValidationError' || errorCode === 'PermanentError') return 'support';
  return 'review';
}

function countFailedExecutionLineages(
  lineages: ExecutionLineage[],
  lowerBound: Date | null,
  upperBound: Date | null,
): number {
  return lineages.filter(({ current }) => {
    if (current.status !== 'failed') return false;
    if (lowerBound && current.updatedAt < lowerBound) return false;
    if (upperBound && current.updatedAt >= upperBound) return false;
    return true;
  }).length;
}

function compareExecutionAttempts(left: ExecutionAttempt, right: ExecutionAttempt): number {
  if (left.recoveryAttempt !== right.recoveryAttempt) {
    return left.recoveryAttempt - right.recoveryAttempt;
  }
  const timeDelta = left.createdAt.getTime() - right.createdAt.getTime();
  if (timeDelta !== 0) return timeDelta;
  return left.id > right.id ? 1 : left.id < right.id ? -1 : 0;
}

function isUnresolvedExecutionStatus(
  status: (typeof actionJobs.$inferSelect)['status'],
): status is 'queued' | 'executing' | 'failed' {
  return status === 'queued' || status === 'executing' || status === 'failed';
}

function isStrictlyAfterCursor(
  attempt: Pick<ExecutionAttempt, 'id' | 'createdAt'>,
  cursor: { occurredAt: Date; id: string },
): boolean {
  const attemptTime = attempt.createdAt.getTime();
  const cursorTime = cursor.occurredAt.getTime();
  return attemptTime < cursorTime || (attemptTime === cursorTime && attempt.id < cursor.id);
}

function compareActivityRowsNewestFirst(left: ActivityRow, right: ActivityRow): number {
  const timeDelta = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
  if (timeDelta !== 0) return timeDelta;
  return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
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
 * Encode a Date for comparison against a raw `sql` expression. Drizzle
 * only maps JS Dates through a column's encoder; a Date bound next to a
 * raw expression reaches postgres.js untyped and throws at serialization
 * ("argument must be of type string or Buffer"). PGlite (specs) accepts
 * either shape, so only the ISO-string form is safe on both drivers.
 */
function timestamptzParam(value: Date) {
  return sql`${value.toISOString()}::timestamptz`;
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
