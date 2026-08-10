import { and, count, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  activityLog,
  briefRuns,
  mailboxAccounts,
  type schema,
  screenerQuarantine,
  users,
  workspaces,
} from '@declutrmail/db';
import { parseEmailPrefs } from '@declutrmail/shared/contracts';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { validTimeZoneOrUtc } from './brief-timezone.js';
import type { EmailSendJobData } from './email-send.worker.js';
import type { WorkerContext } from './worker-context.js';

type WorkerDb = PostgresJsDatabase<typeof schema>;

export interface WeeklyValueReceiptJobData {
  /** ISO-8601 minute boundary. D225 cron idempotency key. */
  scheduledAtMinute: string;
}

export interface WeeklyValueReceiptResult {
  paidUsersChecked: number;
  receiptsQueued: number;
  scheduleSkips: number;
  preferenceSkips: number;
  emptyQueueSkips: number;
  dedupSkips: number;
  usersFailed: number;
  durationMs: number;
}

export interface PreparedWeeklyValueReceipt {
  subject: string;
  text: string;
  headers: Record<string, string>;
}

/**
 * What the receipt is allowed to say — every field an aggregate over
 * RECORDED OUTCOMES in the trailing week, never a projection.
 *
 * D189's five example lines do not all survive contact with the shipped
 * schema, and the honest response to that is to drop a line rather than
 * to invent a number for it:
 *
 *   - "messages held during Quiet Hours" has no source. Quiet Hours
 *     defers DECLUTRMAIL'S OWN autopilot sweeps (`AutopilotActionWorker`
 *     re-enqueues past the window); it never holds the user's incoming
 *     mail, and `mailbox_accounts.quiet_state` records current state
 *     only, with no per-message counter. There is no event to count, so
 *     the line is gone — not rendered as 0, which would assert that a
 *     thing which cannot happen did not happen this week.
 *
 *   - "~N minutes saved" is D189's `(decisions × 30s) + (actions × 5s)`.
 *     Those coefficients are estimates nobody measured, so the product
 *     is an estimate too. Dropped rather than dressed up; the counts it
 *     was derived FROM are already on the receipt, and they are true.
 *
 * `briefSurfaced` is `null` — not 0 — when the Brief produced no run in
 * the window. "The Brief did not run" and "the Brief ran and surfaced
 * nobody" are different facts, and only the second is a zero.
 */
export interface WeeklyValueReceiptFacts {
  /** Messages moved out of the inbox by automation, net of reversals. */
  automatedMessages: number;
  /** Decisions the user made by hand, in Triage or on a sender. */
  ownDecisions: number;
  /** Distinct senders the Brief surfaced; null when the Brief never ran. */
  briefSurfaced: number | null;
  /** Senders awaiting a Screener decision RIGHT NOW (current state). */
  pendingScreener: number;
  /** Actions the user reversed inside the window. */
  undone: number;
}

export interface WeeklyValueReceiptWorkerDeps {
  db: WorkerDb;
  now?: () => Date;
  /** API-owned renderer/token signer injected at the composition root. */
  prepareEmail(input: {
    userId: string;
    facts: WeeklyValueReceiptFacts;
  }): Promise<PreparedWeeklyValueReceipt>;
  /** Existing outcome-aware email queue seam. */
  enqueueEmail(data: EmailSendJobData): Promise<'added' | 'noop'>;
}

interface LocalSchedule {
  ready: boolean;
  weekStarting: string;
}

/** Sunday 18:00-or-later in the user's IANA timezone; invalid zones fall back to UTC. */
function localSchedule(now: Date, candidateTimeZone: string | null): LocalSchedule {
  const timeZone = validTimeZoneOrUtc(candidateTimeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const weekStarting = `${value('year')}-${value('month')}-${value('day')}`;
  const hour = Number.parseInt(value('hour'), 10);
  return {
    ready: value('weekday') === 'Sun' && Number.isFinite(hour) && hour >= 18,
    weekStarting,
  };
}

/** One logical receipt per user and local Sunday. BullMQ rejects colons in job IDs. */
export function weeklyValueReceiptEmailJobId(userId: string, weekStarting: string): string {
  return `email__weekly-value-receipt__${userId}__${weekStarting}`;
}

/** Trailing window the receipt reports on (D189 — "from past 7 days"). */
const RECEIPT_WINDOW_DAYS = 7;

/** Verbs that actually move mail. `keep` moves nothing; outcome rows are not decisions. */
const MAIL_MOVING_ACTIONS = ['archive', 'later', 'delete'] as const;
/** The K/A/U/L/D decisions a person makes (D227). Excludes bookkeeping + outcome rows. */
const CANONICAL_DECISIONS = ['keep', 'archive', 'unsubscribe', 'later', 'delete'] as const;

function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/**
 * D189 amended by D251 — hourly cron producer for the opt-in Plus/Pro
 * weekly value receipt.
 *
 * The producer filters tier, local schedule, and preference, then
 * computes the week's facts and suppresses the send when nothing
 * happened (D189's empty state: "Sending 'you did nothing this week' is
 * worse than silence"). `EmailSendWorker` re-reads the preference and
 * enforces the commercial postal-address gate at execution time.
 *
 * Dedup remains the existing outcome-aware `enqueueEmailSend` contract:
 * a recorded `sent` suppresses forever for this logical week; known-
 * unsent outcomes may be retried.
 */
export class WeeklyValueReceiptWorker extends BaseDeclutrWorker<
  WeeklyValueReceiptJobData,
  WeeklyValueReceiptResult
> {
  override readonly workerName = 'WeeklyValueReceiptWorker';
  override readonly policy = 'cronPolicy' as const;

  constructor(private readonly deps: WeeklyValueReceiptWorkerDeps) {
    super();
  }

  protected override getIdempotencyKey(payload: WeeklyValueReceiptJobData): string {
    return `${this.workerName}:${payload.scheduledAtMinute}`;
  }

  override async processJob(
    _payload: WeeklyValueReceiptJobData,
    _ctx: WorkerContext,
  ): Promise<WeeklyValueReceiptResult> {
    const startedAt = Date.now();
    const now = (this.deps.now ?? (() => new Date()))();
    const paidUsers = await this.deps.db
      .select({
        id: users.id,
        preferences: users.preferences,
        timezone: users.timezone,
      })
      .from(users)
      .innerJoin(workspaces, eq(workspaces.id, users.workspaceId))
      .where(inArray(workspaces.tier, ['plus', 'pro']));

    let receiptsQueued = 0;
    let scheduleSkips = 0;
    let preferenceSkips = 0;
    let emptyQueueSkips = 0;
    let dedupSkips = 0;
    let usersFailed = 0;

    for (const user of paidUsers) {
      const schedule = localSchedule(now, user.timezone);
      if (!schedule.ready) {
        scheduleSkips += 1;
        continue;
      }
      if (!parseEmailPrefs(user.preferences).weeklyReceipt) {
        preferenceSkips += 1;
        continue;
      }

      try {
        const facts = await this.collectFacts(user.id, now);
        if (isEmptyWeek(facts)) {
          emptyQueueSkips += 1;
          continue;
        }

        const prepared = await this.deps.prepareEmail({ userId: user.id, facts });
        const enqueueOutcome = await this.deps.enqueueEmail({
          kind: 'weekly-value-receipt',
          userId: user.id,
          subject: prepared.subject,
          text: prepared.text,
          headers: prepared.headers,
          idempotencyKey: weeklyValueReceiptEmailJobId(user.id, schedule.weekStarting),
        });
        if (enqueueOutcome === 'added') receiptsQueued += 1;
        else dedupSkips += 1;
      } catch (error) {
        usersFailed += 1;
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'weekly_value_receipt.user_failed',
            worker: this.workerName,
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    return {
      paidUsersChecked: paidUsers.length,
      receiptsQueued,
      scheduleSkips,
      preferenceSkips,
      emptyQueueSkips,
      dedupSkips,
      usersFailed,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * The week's recorded outcomes, scoped to every mailbox the user
   * owns. Three reads: the Activity ledger aggregate, the Brief runs,
   * and the current Screener backlog.
   */
  private async collectFacts(userId: string, now: Date): Promise<WeeklyValueReceiptFacts> {
    const windowStart = new Date(now.getTime() - RECEIPT_WINDOW_DAYS * 24 * 60 * 60 * 1_000);

    // One aggregate pass over the ledger. Fully-qualified column names
    // inside the FILTER clauses: a `sql` template emits BARE names that
    // could bind to the joined table (LEARNINGS 2026-06 — Drizzle
    // raw-sql pitfalls).
    const [ledger] = await this.deps.db
      .select({
        automatedMessages: sql<number>`COALESCE(SUM(activity_log.affected_count) FILTER (
          WHERE activity_log.source IN ('autopilot', 'screener')
            AND activity_log.action IN (${sql.raw(sqlList(MAIL_MOVING_ACTIONS))})
            AND activity_log.reverted_at IS NULL
        ), 0)::int`,
        ownDecisions: sql<number>`COUNT(*) FILTER (
          WHERE activity_log.source IN ('triage', 'manual')
            AND activity_log.action IN (${sql.raw(sqlList(CANONICAL_DECISIONS))})
            AND activity_log.reverted_at IS NULL
        )::int`,
        undone: sql<number>`COUNT(*) FILTER (WHERE activity_log.reverted_at IS NOT NULL)::int`,
      })
      .from(activityLog)
      .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, activityLog.mailboxAccountId))
      .where(and(eq(mailboxAccounts.userId, userId), gte(activityLog.occurredAt, windowStart)));

    // At most one Brief per mailbox per day, so this is a handful of
    // rows. Counting distinct senders in JS beats a jsonb LATERAL that
    // would have to be right on two drivers.
    const runs = await this.deps.db
      .select({ payload: briefRuns.briefPayload })
      .from(briefRuns)
      .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, briefRuns.mailboxAccountId))
      .where(and(eq(mailboxAccounts.userId, userId), gte(briefRuns.generatedAt, windowStart)));

    const surfaced = new Set<string>();
    for (const run of runs) {
      for (const item of [...(run.payload?.reply ?? []), ...(run.payload?.fyi ?? [])]) {
        surfaced.add(item.senderKey);
      }
    }

    const [screener] = await this.deps.db
      .select({ pending: count() })
      .from(screenerQuarantine)
      .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, screenerQuarantine.mailboxAccountId))
      .where(and(eq(mailboxAccounts.userId, userId), isNull(screenerQuarantine.decidedAt)));

    return {
      automatedMessages: Number(ledger?.automatedMessages ?? 0),
      ownDecisions: Number(ledger?.ownDecisions ?? 0),
      // No run means the number is unknown, not zero.
      briefSurfaced: runs.length === 0 ? null : surfaced.size,
      pendingScreener: Number(screener?.pending ?? 0),
      undone: Number(ledger?.undone ?? 0),
    };
  }
}

/** D189's empty state — nothing happened and nothing waits, so say nothing. */
export function isEmptyWeek(facts: WeeklyValueReceiptFacts): boolean {
  return (
    facts.automatedMessages === 0 &&
    facts.ownDecisions === 0 &&
    (facts.briefSurfaced ?? 0) === 0 &&
    facts.pendingScreener === 0 &&
    facts.undone === 0
  );
}
