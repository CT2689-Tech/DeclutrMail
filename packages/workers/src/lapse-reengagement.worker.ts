import { and, count, eq, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  activeSessions,
  mailboxAccounts,
  type schema,
  senderPolicies,
  triageDecisions,
  users,
} from '@declutrmail/db';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { lapseReengagementEmailJobId } from './email-send.queue.js';
import type { EmailSendJobData } from './email-send.worker.js';
import type { WorkerContext } from './worker-context.js';

type WorkerDb = PostgresJsDatabase<typeof schema>;

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * D126 Part 3 — "Day 7 if not active in 5 days".
 *
 * Two separate conditions, both required:
 *   - the account is at least 7 days old (`ACCOUNT_AGE_DAYS`), so a
 *     brand-new signup still inside onboarding is never chased;
 *   - the user has not been seen for at least 5 days (`DORMANT_DAYS`).
 */
export const ACCOUNT_AGE_DAYS = 7;
export const DORMANT_DAYS = 5;

/**
 * Width of the send band, in days past `DORMANT_DAYS`.
 *
 * The trigger is not "dormant for 5 days or more" — that predicate stays
 * true forever and would re-send the moment a completed job aged out of
 * BullMQ's retention. It is "dormant for between 5 and 6 days", a window
 * each dormancy episode crosses exactly once. The hourly tick lands in it
 * roughly 24 times and the jobId collapses those to one send; after it
 * closes, nothing re-enqueues, so a permanently dormant user is emailed
 * once per episode rather than once per retention window.
 *
 * One day rather than one hour so a worker outage of a few hours cannot
 * silently drop the episode.
 */
export const SEND_BAND_DAYS = 1;

/**
 * The Triage queue's own "already decided" exclusion, copied verbatim
 * from `TriageReadService` (apps/api/src/triage/triage.read-service.ts,
 * `notDecidedRecently`) so the count this email states is the count the
 * user finds when they arrive. A sender is out of the queue when a
 * K/A/U/L/D `activity_log` row landed inside the window and was not
 * reverted.
 *
 * Raw column text, no Drizzle column interpolation: a correlated `sql`
 * template emits BARE column names that mis-bind across the three
 * tables (LEARNINGS 2026-06 — Drizzle correlated-subquery pitfall).
 *
 * `TRIAGE_DECIDED_WINDOW_DAYS` is duplicated here as a literal because
 * `packages/workers` cannot import from `apps/api`. Its source of truth
 * is the read service; the two must move together.
 */
const TRIAGE_DECIDED_WINDOW_DAYS = 7;
const NOT_DECIDED_RECENTLY = sql`NOT EXISTS (
  SELECT 1
  FROM activity_log al
  LEFT JOIN undo_journal uj ON uj.token = al.undo_token
  WHERE al.mailbox_account_id = triage_decisions.mailbox_account_id
    AND al.sender_key = triage_decisions.sender_key
    AND al.action IN ('keep', 'archive', 'unsubscribe', 'later', 'delete')
    AND al.occurred_at >= now() - make_interval(days => ${TRIAGE_DECIDED_WINDOW_DAYS})
    AND (al.undo_token IS NULL OR uj.reverted_at IS NULL)
)`;

export interface LapseReengagementJobData {
  /** ISO-8601 minute boundary. D225 cron idempotency key. */
  scheduledAtMinute: string;
}

export interface LapseReengagementResult {
  candidatesChecked: number;
  emailsQueued: number;
  bandSkips: number;
  emptyQueueSkips: number;
  dedupSkips: number;
  usersFailed: number;
  durationMs: number;
}

export interface PreparedLapseEmail {
  subject: string;
  text: string;
  headers: Record<string, string>;
}

export interface LapseReengagementWorkerDeps {
  db: WorkerDb;
  now?: () => Date;
  /** API-owned renderer/token signer injected at the composition root. */
  prepareEmail(input: { userId: string; pendingCount: number }): Promise<PreparedLapseEmail>;
  /** Existing outcome-aware email queue seam. */
  enqueueEmail(data: EmailSendJobData): Promise<'added' | 'noop'>;
}

/** postgres.js and PGlite both hand back Dates here; be defensive anyway. */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * D126 Part 3 — the lapse re-engagement producer.
 *
 * Closes the gap where a user who stopped coming back after day 5 was
 * never contacted again: the only lapse-adjacent mail was the 24h sync
 * reminder, which fires once and only for a fresh mailbox.
 *
 * The producer filters account age, the dormancy band, and `N > 0`. The
 * `EmailSendWorker` then owns every execution-time decision, as it does
 * for the other kinds: the D165 `reminders` opt-out, the "user came
 * back" session check, and the commercial postal-address gate — which
 * refuses this kind outright until `BUSINESS_POSTAL_ADDRESS` is set.
 *
 * Dedup is the existing outcome-aware `enqueueEmailSend` contract: a
 * recorded `sent` suppresses this episode forever, while every
 * known-unsent outcome (opted out, returned, refused for the postal
 * address) stays reapable so fixing the cause restores delivery.
 *
 * "Last seen" is `max(latest session activity, account creation)`.
 * `active_sessions.last_used_at` is bumped on every authenticated
 * request; falling back to `users.created_at` covers the user whose
 * session rows are gone, and is itself a recorded fact rather than an
 * assumption — an account with no session ever was last in contact when
 * it was created.
 */
export class LapseReengagementWorker extends BaseDeclutrWorker<
  LapseReengagementJobData,
  LapseReengagementResult
> {
  override readonly workerName = 'LapseReengagementWorker';
  override readonly policy = 'cronPolicy' as const;

  constructor(private readonly deps: LapseReengagementWorkerDeps) {
    super();
  }

  protected override getIdempotencyKey(payload: LapseReengagementJobData): string {
    return `${this.workerName}:${payload.scheduledAtMinute}`;
  }

  override async processJob(
    _payload: LapseReengagementJobData,
    _ctx: WorkerContext,
  ): Promise<LapseReengagementResult> {
    const startedAt = Date.now();
    const now = (this.deps.now ?? (() => new Date()))();

    const candidates = await this.deps.db
      .select({
        id: users.id,
        createdAt: users.createdAt,
        lastSessionAt: sql<unknown>`max(${activeSessions.lastUsedAt})`,
      })
      .from(users)
      .leftJoin(activeSessions, eq(activeSessions.userId, users.id))
      .where(lte(users.createdAt, new Date(now.getTime() - ACCOUNT_AGE_DAYS * DAY_MS)))
      .groupBy(users.id, users.createdAt);

    // Dormant for at least DORMANT_DAYS but less than one band-width
    // more. Expressed as an instant range on "last seen" so the two
    // comparisons cannot drift apart.
    const bandNewestLastSeen = new Date(now.getTime() - DORMANT_DAYS * DAY_MS);
    const bandOldestLastSeen = new Date(now.getTime() - (DORMANT_DAYS + SEND_BAND_DAYS) * DAY_MS);

    let emailsQueued = 0;
    let bandSkips = 0;
    let emptyQueueSkips = 0;
    let dedupSkips = 0;
    let usersFailed = 0;

    for (const candidate of candidates) {
      const sessionAt = toDate(candidate.lastSessionAt);
      const lastSeen =
        sessionAt && sessionAt > candidate.createdAt ? sessionAt : candidate.createdAt;
      if (lastSeen > bandNewestLastSeen || lastSeen <= bandOldestLastSeen) {
        bandSkips += 1;
        continue;
      }

      try {
        const pendingCount = await this.countPendingTriageSenders(candidate.id);
        if (pendingCount === 0) {
          // Nothing is waiting, so there is nothing true to say. D189's
          // empty-state instinct applies here too: silence beats a
          // summons to an empty queue.
          emptyQueueSkips += 1;
          continue;
        }

        const prepared = await this.deps.prepareEmail({ userId: candidate.id, pendingCount });
        const enqueueOutcome = await this.deps.enqueueEmail({
          kind: 'lapse-reengagement',
          userId: candidate.id,
          subject: prepared.subject,
          text: prepared.text,
          headers: prepared.headers,
          idempotencyKey: lapseReengagementEmailJobId(candidate.id, lapseEpisodeKeyPart(lastSeen)),
          // Belt and braces with the band: the user can come back
          // between this enqueue and the send, and the EmailSendWorker
          // is the one that can see it.
          skipIfUserActiveSince: lastSeen.toISOString(),
        });
        if (enqueueOutcome === 'added') emailsQueued += 1;
        else dedupSkips += 1;
      } catch (error) {
        usersFailed += 1;
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'lapse_reengagement.user_failed',
            worker: this.workerName,
            userId: candidate.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    return {
      candidatesChecked: candidates.length,
      emailsQueued,
      bandSkips,
      emptyQueueSkips,
      dedupSkips,
      usersFailed,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Senders sitting in Triage awaiting a first decision, across the
   * user's ACTIVE mailboxes.
   *
   * Non-Keep verdicts only — D126's copy says "noisy senders", and a
   * Keep row asks nothing of the user. Protected senders are excluded
   * because the Triage screen renders their verdict AS Keep (D245), so
   * counting them here would state a number the screen contradicts.
   */
  private async countPendingTriageSenders(userId: string): Promise<number> {
    const [row] = await this.deps.db
      .select({ pending: count() })
      .from(triageDecisions)
      .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, triageDecisions.mailboxAccountId))
      .leftJoin(
        senderPolicies,
        and(
          eq(senderPolicies.mailboxAccountId, triageDecisions.mailboxAccountId),
          eq(senderPolicies.senderKey, triageDecisions.senderKey),
        ),
      )
      .where(
        and(
          eq(mailboxAccounts.userId, userId),
          eq(mailboxAccounts.status, 'active'),
          ne(triageDecisions.verdict, 'keep'),
          or(isNull(senderPolicies.isProtected), eq(senderPolicies.isProtected, false)),
          NOT_DECIDED_RECENTLY,
        ),
      );
    return Number(row?.pending ?? 0);
  }
}

/** UTC date of the last-seen instant — the dormancy episode's identity. */
function lapseEpisodeKeyPart(lastSeen: Date): string {
  return lastSeen.toISOString().slice(0, 10);
}
