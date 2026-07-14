import { Inject, Injectable, Optional } from '@nestjs/common';
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
import { cleanupActionsLifetimeFor } from '@declutrmail/shared/entitlements';

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
  gmailCategory: 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
  unsubscribeMethod: 'one_click' | 'mailto' | 'none';
  verdict: TriageVerdict;
  confidence: number;
  reasoning: string;
  signals: string[];
  protectionReason: 'manual' | 'engagement' | 'auto-receipts' | 'auto-financial' | null;
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

/**
 * D214 — the "Today" strip atop Triage. Situational awareness for the
 * daily ritual, computed from real rows (no fake completion §10):
 *
 *   You received {receivedToday} emails from {sendersToday} senders.
 *   DeclutrMail handled {handledAutomatically} automatically.
 *   {queuedDecisions} sender decisions can reduce future noise by
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
  noiseReductionPct: number | null;
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
 * The protectionReason mapping is intentional: user-defined protection
 * maps to `manual`, while engagement-based protection maps to
 * `engagement`. The auto-receipts / auto-financial
 * paths land with the D21 Phase-A receipt detector — when it ships
 * the DB enum gains those values and this mapper extends.
 */
@Injectable()
export class TriageReadService {
  private readonly entitlements: EntitlementsService;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    // Free-cap position for the stats block (D19 — 5 LIFETIME cleanup
    // actions; replaces the old 25/day display counter). `@Optional()`
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
        isProtected: senderPolicies.isProtected,
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

      // Protection overrides the recommendation (2026-07-10 founder
      // dogfood): a row reading "PROTECTED" and "Unsubscribe · 95% ·
      // RECOMMENDED" at once is a contradiction — the user asked us
      // (or the engine's protect rules did) to keep this sender, so
      // the RECOMMENDATION must be Keep. Display-layer only: the
      // engine's verdict stays in `triage_decisions` untouched, every
      // K/A/U/L action remains available on the row, and the override
      // is annotated in the reasoning so the user sees why.
      const protectionReason = mapProtectionReason(r.isProtected, r.protectionReason);
      const isProtected = protectionReason !== null;

      return {
        id: r.decisionId,
        senderId: r.senderId,
        senderKey: r.senderKey,
        senderName: r.senderName || r.senderEmail,
        senderEmail: r.senderEmail,
        senderDomain: r.senderDomain,
        gmailCategory: r.gmailCategory,
        unsubscribeMethod: r.unsubscribeMethod ?? 'none',
        verdict: isProtected ? 'keep' : r.verdict,
        confidence: Number(r.confidence),
        reasoning:
          isProtected && r.verdict !== 'keep'
            ? `This sender is protected (${protectionReason}), so Keep is recommended. Without protection the engine would suggest: ${r.verdict}. ${r.reasoning ?? ''}`.trimEnd()
            : r.reasoning,
        signals: buildSignals({
          readRate,
          monthlyVolume,
          unsubscribeMethod: r.unsubscribeMethod ?? 'none',
        }),
        protectionReason,
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

    // D19 free-cap position — LIFETIME cleanup units left (manifest
    // limit − units consumed), not a daily decision counter. The
    // counting rule lives on `EntitlementsService.cleanupUnitsUsed`.
    const lifetimeLimit = cleanupActionsLifetimeFor(tierEnum);
    const freeRemaining =
      lifetimeLimit === null || !tierRow
        ? null
        : Math.max(
            0,
            lifetimeLimit - (await this.entitlements.cleanupUnitsUsed(tierRow.workspaceId)),
          );

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
    const now = input.now ?? new Date();
    const todayStartUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    const [received] = await this.db
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

    const [autopilot] = await this.db
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
    // sender exclusion as GET /api/triage/queue. `last90dMessages` is
    // already aggregated per row, so the noise share reuses it.
    const queueRows = await this.listQueue({
      mailboxAccountId: input.mailboxAccountId,
      limit: 12,
    });
    const queuedNoise = queueRows
      .filter((r) => r.verdict !== 'keep')
      .reduce((sum, r) => sum + r.last90dMessages, 0);

    let noiseReductionPct: number | null = null;
    if (queueRows.length > 0 && queuedNoise > 0) {
      const ninetyDaysAgo = new Date(todayStartUtc.getTime() - 90 * 86_400_000);
      const [volume] = await this.db
        .select({ total: count() })
        .from(mailMessages)
        .where(
          and(
            eq(mailMessages.mailboxAccountId, input.mailboxAccountId),
            eq(mailMessages.isOutbound, false),
            gte(mailMessages.internalDate, ninetyDaysAgo),
          ),
        );
      const total = Number(volume?.total ?? 0);
      if (total > 0) {
        noiseReductionPct = Math.min(100, Math.round((queuedNoise / total) * 100));
      }
    }

    return {
      receivedToday: Number(received?.total ?? 0),
      sendersToday: Number(received?.senders ?? 0),
      handledAutomatically: Number(autopilot?.handled ?? 0),
      queuedDecisions: queueRows.length,
      noiseReductionPct,
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
  if (reason === 'engagement_based') return 'engagement';
  return null;
}
