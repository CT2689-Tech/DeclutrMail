import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import {
  activityLog,
  mailMessages,
  mailboxAccounts,
  senderPolicies,
  senders,
  triageDecisions,
  workspaces,
  type TriageVerdict,
} from '@declutrmail/db';

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
  gmailCategory: 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
  unsubscribeMethod: 'one_click' | 'mailto' | 'none';
  verdict: TriageVerdict;
  confidence: number;
  reasoning: string;
  signals: string[];
  protectionReason: 'vip' | 'engagement' | 'auto-receipts' | 'auto-financial' | null;
  monthlyVolume: number;
  /**
   * Raw last-90-day message count. Used by the FE to render an honest
   * rolling-window signal ("N in last 90d") rather than the derived
   * `monthlyVolume = round(last90 / 3)` which rounds to 0 for senders
   * quiet within the window.
   */
  last90dMessages: number;
  readRate: number;
  lastDays: number;
  totalAllTime: number;
}

/** Stats for the daily ritual empty state — mirrors the FE shape. */
export interface TriageSessionStats {
  decidedToday: number;
  archivedToday: number;
  unsubscribedToday: number;
  laterToday: number;
  streakDays: number;
  freeRemaining: number | null;
  futureEmailsSkipped: number | null;
  minutesSavedPerWeek: number | null;
  tier: 'free' | 'plus' | 'pro';
}

/**
 * D19 — Free-tier cleanup-action limit (display path only). Previously
 * misattributed to D77 (Screener Pro-gating); the Free cap is a D19
 * decision. NOTE: D19 locks the Free limit at 5 LIFETIME cleanup
 * actions — this 25/day counter predates the entitlement manifest
 * (`@declutrmail/shared/entitlements`, `cleanupActionsLifetimeFor`) and
 * its display path is superseded by manifest-driven lifetime
 * enforcement in a later unit. Behavior intentionally unchanged here.
 */
const FREE_TIER_DAILY_LIMIT = 25;

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

/** Average seconds saved per inbox message deflected — D33 worked example. */
const SECONDS_SAVED_PER_DEFLECTED_EMAIL = 6;

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
 * The protectionReason mapping is intentional: the DB enum is
 * `user_defined | engagement_based | vip`; the FE enum is
 * `vip | engagement | auto-receipts | auto-financial`. Today we map
 * `user_defined → null` (no UX surface for it), `engagement_based →
 * engagement`, and `vip → vip`. The auto-receipts / auto-financial
 * paths land with the D21 Phase-A receipt detector — when it ships
 * the DB enum gains those values and this mapper extends.
 */
@Injectable()
export class TriageReadService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

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
  async listQueue(input: { mailboxAccountId: string; limit: number }): Promise<TriageQueueRow[]> {
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
        senderName: senders.displayName,
        senderEmail: senders.email,
        senderDomain: senders.domain,
        gmailCategory: senders.gmailCategory,
        unsubscribeMethod: senders.unsubscribeMethod,
        firstSeenAt: senders.firstSeenAt,
        lastSeenAt: senders.lastSeenAt,
        protectionReason: senderPolicies.protectionReason,
        isVip: senderPolicies.isVip,
      })
      .from(triageDecisions)
      .innerJoin(
        senders,
        and(
          eq(senders.mailboxAccountId, triageDecisions.mailboxAccountId),
          eq(senders.senderKey, triageDecisions.senderKey),
        ),
      )
      .leftJoin(
        senderPolicies,
        and(
          eq(senderPolicies.mailboxAccountId, triageDecisions.mailboxAccountId),
          eq(senderPolicies.senderKey, triageDecisions.senderKey),
        ),
      )
      .where(and(eq(triageDecisions.mailboxAccountId, input.mailboxAccountId), notDecidedRecently))
      .orderBy(verdictPriority, desc(triageDecisions.confidence))
      .limit(input.limit);

    if (rows.length === 0) {
      return [];
    }

    // Aggregate per-sender message stats in a single follow-up query
    // (cheaper than a correlated subquery per row).
    const senderKeys = rows.map((r) => r.senderKey);
    // Bind the cutoff as an ISO STRING cast to timestamptz, not a JS
    // Date. The postgres.js driver rejects a raw `Date` interpolated
    // into a `sql` fragment with "The string argument must be of type
    // string … Received an instance of Date" (Codex smoke 2026-05-27).
    // `gte()` in a `.where()` handles Dates fine; only raw `sql`
    // fragments need the manual ISO + cast.
    const ninetyDaysAgoIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const aggRows = await this.db
      .select({
        senderKey: mailMessages.senderKey,
        total: count(),
        unread: sql<number>`SUM(CASE WHEN ${mailMessages.isUnread} THEN 1 ELSE 0 END)`,
        last90Total: sql<number>`SUM(CASE WHEN ${mailMessages.internalDate} >= ${ninetyDaysAgoIso}::timestamptz THEN 1 ELSE 0 END)`,
        last90Read: sql<number>`SUM(CASE WHEN ${mailMessages.internalDate} >= ${ninetyDaysAgoIso}::timestamptz AND NOT ${mailMessages.isUnread} THEN 1 ELSE 0 END)`,
        lastInternalDate: sql<Date | null>`MAX(${mailMessages.internalDate})`,
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

    const aggBySender = new Map<string, (typeof aggRows)[number]>();
    for (const a of aggRows) aggBySender.set(a.senderKey, a);

    const now = Date.now();
    return rows.map((r) => {
      const agg = aggBySender.get(r.senderKey);
      const total = Number(agg?.total ?? 0);
      const last90Total = Number(agg?.last90Total ?? 0);
      const last90Read = Number(agg?.last90Read ?? 0);
      const readRate = last90Total > 0 ? last90Read / last90Total : 0;
      const monthlyVolume = Math.round(last90Total / 3);
      const lastInternal = agg?.lastInternalDate ?? r.lastSeenAt;
      const lastDays =
        lastInternal instanceof Date
          ? Math.max(0, Math.floor((now - lastInternal.getTime()) / 86_400_000))
          : 0;

      return {
        id: r.decisionId,
        senderId: r.senderId,
        senderKey: r.senderKey,
        senderName: r.senderName || r.senderEmail,
        senderEmail: r.senderEmail,
        senderDomain: r.senderDomain,
        gmailCategory: r.gmailCategory,
        unsubscribeMethod: r.unsubscribeMethod ?? 'none',
        verdict: r.verdict,
        confidence: Number(r.confidence),
        reasoning: r.reasoning,
        signals: buildSignals({
          readRate,
          monthlyVolume,
          unsubscribeMethod: r.unsubscribeMethod ?? 'none',
        }),
        protectionReason: mapProtectionReason(r.isVip, r.protectionReason),
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
      };
    });
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

    // Tier comes from the mailbox's workspace.
    const [tierRow] = await this.db
      .select({ tier: workspaces.tier })
      .from(mailboxAccounts)
      .innerJoin(workspaces, eq(workspaces.id, mailboxAccounts.workspaceId))
      .where(eq(mailboxAccounts.id, input.mailboxAccountId))
      .limit(1);
    const tierEnum = tierRow?.tier ?? 'free';
    const tier: TriageSessionStats['tier'] =
      tierEnum === 'plus' ? 'plus' : tierEnum === 'pro' ? 'pro' : 'free';

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
      // Skip non-K/A/U/L bookkeeping actions like followup-dismiss.
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
      }
    }

    // Streak: how many consecutive UTC dates ending today have at
    // least one K/A/U/L row. Bounded scan (90 days max).
    const streakDays = await this.computeStreak(input.mailboxAccountId, todayStartUtc);

    // Future-emails-skipped: rough projection of today's deflected
    // verbs × monthly_volume × 12. Aggregated from the underlying
    // mail_messages for the touched senders.
    const projection = await this.projectImpact(input.mailboxAccountId, todayStartUtc);

    const freeRemaining =
      tier === 'free' ? Math.max(0, FREE_TIER_DAILY_LIMIT - decidedToday) : null;

    return {
      decidedToday,
      archivedToday,
      unsubscribedToday,
      laterToday,
      streakDays,
      freeRemaining,
      futureEmailsSkipped: projection.futureEmailsSkipped,
      minutesSavedPerWeek: projection.minutesSavedPerWeek,
      tier,
    };
  }

  private async computeStreak(mailboxAccountId: string, todayStartUtc: Date): Promise<number> {
    const ninetyDaysAgo = new Date(todayStartUtc.getTime() - 90 * 86_400_000);
    const rows = await this.db
      .select({
        day: sql<string>`DATE(${activityLog.occurredAt} AT TIME ZONE 'UTC')`,
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.mailboxAccountId, mailboxAccountId),
          gte(activityLog.occurredAt, ninetyDaysAgo),
          sql`${activityLog.action} IN ('archive','unsubscribe','later','keep')`,
        ),
      )
      .groupBy(sql`1`);
    const activeDays = new Set(rows.map((r) => r.day));
    let streak = 0;
    const cursor = new Date(todayStartUtc);
    while (streak < 90 && activeDays.has(toUtcDateString(cursor))) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return streak;
  }

  private async projectImpact(
    mailboxAccountId: string,
    todayStartUtc: Date,
  ): Promise<{
    futureEmailsSkipped: number | null;
    minutesSavedPerWeek: number | null;
  }> {
    // ISO string + ::timestamptz cast — postgres.js rejects raw Date
    // params in `sql` fragments (Codex smoke 2026-05-27).
    const ninetyDaysAgoIso = new Date(todayStartUtc.getTime() - 90 * 86_400_000).toISOString();
    // Total inbound messages over 90d for senders this user
    // archived/unsubscribed/later'd TODAY → monthly volume × 12.
    const [agg] = await this.db
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
      .where(
        and(
          eq(activityLog.mailboxAccountId, mailboxAccountId),
          gte(activityLog.occurredAt, todayStartUtc),
          sql`${activityLog.action} IN ('archive','unsubscribe','later')`,
        ),
      );
    const deflectedSenders = Number(agg?.deflectedSenders ?? 0);
    if (deflectedSenders === 0) {
      return { futureEmailsSkipped: null, minutesSavedPerWeek: null };
    }
    const last90Total = Number(agg?.last90Total ?? 0);
    const annualVolume = Math.round((last90Total / 3) * 12);
    const minutesSaved = Math.round((annualVolume * SECONDS_SAVED_PER_DEFLECTED_EMAIL) / 60 / 52);
    return {
      futureEmailsSkipped: annualVolume,
      minutesSavedPerWeek: minutesSaved,
    };
  }
}

/** UTC ISO date (YYYY-MM-DD) for streak day-key comparison. */
function toUtcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Render a small fixed set of signals from the aggregated numbers.
 * Lossless w.r.t. user data — these are summaries of fields already
 * shown in the row footer, formatted for the row's expanded view.
 */
function buildSignals(input: {
  readRate: number;
  monthlyVolume: number;
  unsubscribeMethod: 'one_click' | 'mailto' | 'none';
}): string[] {
  const signals: string[] = [
    `Read rate: ${Math.round(input.readRate * 100)}% over the last 90 days`,
    `Volume: ${input.monthlyVolume} messages/month (90-day average)`,
  ];
  if (input.unsubscribeMethod === 'one_click') {
    signals.push('List-Unsubscribe header present (RFC 8058 one-click)');
  } else if (input.unsubscribeMethod === 'mailto') {
    signals.push('List-Unsubscribe header is mailto-only (no one-click)');
  }
  return signals;
}

/** Map the DB protection-reason enum to the FE's superset. */
function mapProtectionReason(
  isVip: boolean | null | undefined,
  reason: 'user_defined' | 'engagement_based' | 'vip' | null | undefined,
): TriageQueueRow['protectionReason'] {
  if (isVip) return 'vip';
  if (reason === 'vip') return 'vip';
  if (reason === 'engagement_based') return 'engagement';
  return null;
}
