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
import { parseEmailPrefs } from '@declutrmail/shared/contracts';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { hasInFlightDeletion } from './deletion-pause.js';
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
 * Dormancy-band candidates examined per tick.
 *
 * The scan is bounded because `cronPolicy`'s 60s timeout is a bare
 * `Promise.race` — it does not abort this loop. An unbounded scan past
 * 60s "fails" the job and a retry starts a SECOND concurrent copy from
 * the top.
 *
 * The original justification for the ordering was wrong and is worth
 * keeping visible: it claimed `created_at, id` ordering plus "the hourly
 * cadence against a 24h band leaves ~24 passes to cover a backlog". It
 * left 24 passes over the SAME 500 rows. `created_at` is immutable and
 * this pass writes nothing to `users`, so the page could never move, and
 * the band was checked in TypeScript AFTER the limit — so the limit
 * bounded the whole user table, not the candidates.
 *
 * The band now lives in the query, which is what makes this cap bound
 * something meaningful, and the ordering is random so that reaching it
 * delays a user rather than excluding them permanently.
 */
export const CANDIDATE_BATCH_SIZE = 500;

/**
 * The Triage queue's "already decided" exclusion, copied verbatim from
 * `TriageReadService` (apps/api/src/triage/triage.read-service.ts,
 * `notDecidedRecently`). A sender is out of the queue when a K/A/U/L/D
 * `activity_log` row landed inside the window and was not reverted.
 *
 * This predicate is the ONLY part shared with the queue read, and the
 * copy must not imply otherwise. The count here is deliberately a
 * different quantity: it spans every ACTIVE mailbox on the account
 * (the queue read is scoped to ONE — `triage.read-service.ts:372`), and
 * it further drops Keep verdicts and protected senders, which the queue
 * does show. So it is "senders awaiting a first decision across the
 * account", not "the number on the Triage screen". The founder's own
 * workspace has two connected accounts, so an equality claim would
 * diverge on the first real smoke.
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
  preferenceSkips: number;
  deletionSkips: number;
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
 * request. The `users.created_at` floor exists so a null `max()` can
 * never read as "seen just now" — it is a null guard, NOT a path to a
 * send: creation-as-last-contact requires an account 5-6 days old,
 * which the 7-day age floor already excludes. The signed-up-and-never-
 * returned user is D126's Day-3 step, which this does not build.
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

    // Dormant for at least DORMANT_DAYS but less than one band-width
    // more. Expressed as an instant range on "last seen" so the two
    // comparisons cannot drift apart.
    const bandNewestLastSeen = new Date(now.getTime() - DORMANT_DAYS * DAY_MS);
    const bandOldestLastSeen = new Date(now.getTime() - (DORMANT_DAYS + SEND_BAND_DAYS) * DAY_MS);

    // The band is applied in SQL, not only in the loop below.
    //
    // It used to run only in TypeScript, which meant `LIMIT 500` bounded
    // THE WHOLE USER TABLE rather than the candidates — ordered by
    // `created_at ASC`, which is immutable, in a pass that writes
    // nothing back to `users`. Past 500 accounts older than a week the
    // query returned the same 500 oldest users every hour forever, and
    // nobody who signed up after them could ever receive a win-back
    // email. It reported itself healthy while doing it:
    // `candidatesChecked: 500, bandSkips: 500, emailsQueued: 0` reads
    // exactly like "nobody is dormant right now". (Repo sweep after the
    // D253 starvation fixes, 2026-08-13 — same defect, purer instance,
    // since `created_at` cannot rotate even in principle.)
    //
    // Filtering here makes the cap bound real candidates, and a one-day
    // dormancy band is narrow enough that 500 becomes a number this
    // product would have to be enormous to reach.
    //
    // `GREATEST` ignores NULLs in Postgres, so a user who never opened a
    // session falls back to `created_at` — the same rule the loop below
    // applies, kept identical deliberately. The loop keeps its own check
    // as the authority: `bandSkips` staying at zero is the signal that
    // the two agree, and a non-zero count means they have drifted.
    // Dates go in as ISO text with an explicit cast; postgres.js rejects
    // a bare JS Date in a raw fragment.
    const lastSeenExpr = sql`GREATEST(max(${activeSessions.lastUsedAt}), ${users.createdAt})`;
    const candidates = await this.deps.db
      .select({
        id: users.id,
        createdAt: users.createdAt,
        preferences: users.preferences,
        lastSessionAt: sql<unknown>`max(${activeSessions.lastUsedAt})`,
      })
      .from(users)
      .leftJoin(activeSessions, eq(activeSessions.userId, users.id))
      .where(lte(users.createdAt, new Date(now.getTime() - ACCOUNT_AGE_DAYS * DAY_MS)))
      .groupBy(users.id, users.createdAt, users.preferences)
      .having(
        sql`${lastSeenExpr} > ${bandOldestLastSeen.toISOString()}::timestamptz AND ${lastSeenExpr} <= ${bandNewestLastSeen.toISOString()}::timestamptz`,
      )
      // Random, not `created_at ASC`. The band makes the cap practically
      // unreachable; this covers the case where it is reached anyway, so
      // a full page truncates at different users each tick instead of
      // the same ones — the bug above, in miniature.
      .orderBy(sql`random()`)
      .limit(CANDIDATE_BATCH_SIZE);

    if (candidates.length >= CANDIDATE_BATCH_SIZE) {
      // Never silent. A full page means dormant users went unexamined
      // this tick, and no counter below can show it.
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'lapse_reengagement.batch_capped',
          candidates: candidates.length,
          cap: CANDIDATE_BATCH_SIZE,
        }),
      );
    }

    let emailsQueued = 0;
    let bandSkips = 0;
    let preferenceSkips = 0;
    let deletionSkips = 0;
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
      // Cheap opt-out check first. `EmailSendWorker` re-reads this at
      // execution time and remains the authority, but short-circuiting
      // here avoids signing a fresh JWT and rendering a body every
      // hourly tick for someone who turned reminders off.
      if (!parseEmailPrefs(candidate.preferences).reminders) {
        preferenceSkips += 1;
        continue;
      }

      try {
        // D232 — never advertise to someone mid-erasure. A deletion
        // request keeps `status='pending'` for
        // `max(now+7d, latest_undo_expires_at)`, and a user who asked to
        // be deleted stops using the app BY DEFINITION, so they land in
        // this exact dormancy band inside their own grace window. This
        // kind is commercial; win-back mail to an account being erased
        // is not a tradeoff. `hasInFlightDeletion` is the same
        // chokepoint every sync entry path already uses.
        if (await hasInFlightDeletion(this.deps.db, candidate.id)) {
          deletionSkips += 1;
          continue;
        }

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
      } catch (err) {
        usersFailed += 1;
        const error = err instanceof Error ? err : new Error(String(err));
        // A per-user failure must reach Sentry, not just stdout. The
        // job still RETURNS SUCCESS, and `sanitizeWorkerResult`'s
        // allowlist decides what survives into `worker.succeeded` — so
        // without this call a total outage looks exactly like a quiet
        // hour. `signUnsubscribeToken` throwing on an unset or short
        // `UNSUBSCRIBE_TOKEN_SECRET` hits this catch for EVERY
        // candidate: zero mail sends, the cron reports success, and
        // nobody is paged. Same reasoning `EmailSendWorker` gives for
        // riding both channels on a not-delivered send.
        this.observer.captureBackgroundFailure(error, {
          kind: 'lapse_reengagement.user_failed',
          tags: { worker: this.workerName },
        });
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'lapse_reengagement.user_failed',
            worker: this.workerName,
            userId: candidate.id,
            error: error.message,
          }),
        );
      }
    }

    return {
      candidatesChecked: candidates.length,
      emailsQueued,
      bandSkips,
      preferenceSkips,
      deletionSkips,
      emptyQueueSkips,
      dedupSkips,
      usersFailed,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Senders awaiting a first decision across the user's ACTIVE
   * mailboxes — an ACCOUNT-WIDE total, not one mailbox's queue length.
   *
   * Non-Keep verdicts only: D126's copy says "noisy senders", and a
   * Keep row asks nothing of the user. Protected senders are excluded
   * because Triage renders their verdict AS Keep (D245), so counting
   * them would inflate a number that asks for no decision.
   *
   * Both narrowings, plus the account-wide scope, are why the email
   * says "across your mailboxes" and never claims to equal the queue.
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
