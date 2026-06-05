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
import { and, count, desc, eq, gte, lt, or } from 'drizzle-orm';

import { activityLog, senders, undoJournal } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type { ActivityRow, ActivityStats, ActivityWindow, UndoState } from './activity.types.js';
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

export interface ListActivityParams {
  mailboxAccountId: string;
  window: ActivityWindow;
  source: ActivityLogEntry['source'] | null;
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
    const { mailboxAccountId, window, source, cursor, limit, nowMs } = params;
    const windowStart = resolveWindowStart(window, nowMs);

    const whereParts = [eq(activityLog.mailboxAccountId, mailboxAccountId)];
    if (windowStart) whereParts.push(gte(activityLog.occurredAt, windowStart));
    if (source) whereParts.push(eq(activityLog.source, source));
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
        undoState: resolveUndoState({
          token: row.undoToken,
          expiresAt: row.undoExpiresAt,
          executedAt: row.undoExecutedAt,
          revertedAt: row.undoRevertedAt,
          nowMs,
        }),
      };
    });

    const stats = await this.aggregateStats({
      mailboxAccountId,
      windowStart,
    });

    return { rows: projected, stats };
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
    windowStart: Date | null;
  }): Promise<ActivityStats> {
    const whereParts = [eq(activityLog.mailboxAccountId, args.mailboxAccountId)];
    if (args.windowStart) whereParts.push(gte(activityLog.occurredAt, args.windowStart));

    const rows = await this.db
      .select({
        action: activityLog.action,
        n: count(activityLog.id),
      })
      .from(activityLog)
      .where(and(...whereParts))
      .groupBy(activityLog.action);

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
      needsAttention: 0,
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
