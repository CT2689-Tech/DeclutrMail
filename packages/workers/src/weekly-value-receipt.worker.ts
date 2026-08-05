import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
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

export interface WeeklyValueReceiptWorkerDeps {
  db: WorkerDb;
  now?: () => Date;
  /** API-owned renderer/token signer injected at the composition root. */
  prepareEmail(input: {
    userId: string;
    pendingCount: number;
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

/**
 * D189 amended by D251 — hourly cron producer for the opt-in Plus/Pro
 * weekly Screener value cue.
 *
 * The producer filters tier, local schedule, preference, and `N > 0`,
 * then hands the final send to `EmailSendWorker`. That worker re-reads
 * the preference and enforces the commercial postal-address gate at
 * execution time. Dedup remains the existing outcome-aware
 * `enqueueEmailSend` contract: a recorded `sent` suppresses forever for
 * this logical week; known-unsent outcomes may be retried.
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
        const [row] = await this.deps.db
          .select({ pending: count() })
          .from(screenerQuarantine)
          .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, screenerQuarantine.mailboxAccountId))
          .where(and(eq(mailboxAccounts.userId, user.id), isNull(screenerQuarantine.decidedAt)));
        const pendingCount = Number(row?.pending ?? 0);
        if (pendingCount === 0) {
          emptyQueueSkips += 1;
          continue;
        }

        const prepared = await this.deps.prepareEmail({ userId: user.id, pendingCount });
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
}
