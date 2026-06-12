import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { cronRuns, mailboxAccounts, providerSyncState } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { persistGmailWatchState } from './gmail-watch-state.js';
import { TransientError } from './worker-errors.js';
import type { GmailWatchAccess } from './ports.js';
import type { WorkerContext } from './worker-context.js';
import type { WorkerObserver } from './worker-observer.js';

/** The Drizzle client, bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * Periodic renewal payload. The cron scheduler enqueues one job per
 * tick keyed on `(worker_name, scheduled_at_minute)` per D225; the
 * payload carries no per-mailbox state because the worker sweeps every
 * eligible mailbox itself.
 */
export interface WatchRenewalJobData {
  /**
   * The scheduling minute — the BullMQ jobId component AND the
   * `cron_runs.run_key` suffix (D225 cron idempotency). ISO-8601
   * minute (`2026-06-11T14:35`), derived by the scheduler from `now()`.
   */
  scheduledAtMinute: string;
}

/**
 * Counts returned by one sweep — logged on `worker.succeeded`.
 * Metric-only per the `BaseDeclutrWorker.processJob` contract: counts
 * and durations, never message content or tokens (D7).
 */
export interface WatchRenewalResult {
  /**
   * `swept` — this run claimed the `cron_runs` slot and ran the sweep.
   * `duplicate_run_key` — another run already SUCCEEDED for this
   * run-key (double-fired tick / second replica); clean no-op.
   * `skipped_disabled` — `topicName` is null (env `GMAIL_PUBSUB_TOPIC`
   * unset; local dev / not-yet-provisioned env). The worker stays
   * registered but idles — mirrors `GmailWatchService`'s
   * `skipped_disabled`. No `cron_runs` claim, no Gmail call.
   */
  outcome: 'swept' | 'duplicate_run_key' | 'skipped_disabled';
  /** Mailboxes eligible for renewal (active + sync-ready + token). */
  eligible: number;
  /** `users.watch` calls that succeeded + persisted state. */
  watched: number;
  /** Mailboxes that failed — recorded + skipped, never sweep-fatal. */
  failed: number;
  /** Total wall-clock ms. */
  durationMs: number;
}

export interface WatchRenewalDeps {
  db: WorkerDb;
  /** Per-mailbox token-bound client resolver (composition root). */
  gmailWatch: GmailWatchAccess;
  /**
   * Full Pub/Sub topic resource (env `GMAIL_PUBSUB_TOPIC`), or null
   * when the watch pipeline is off (local dev). A null topic makes
   * every sweep a clean `skipped_disabled` no-op — registered-but-idle,
   * never absent (CLAUDE.md §10 no-fake-completion).
   */
  topicName: string | null;
  /**
   * D159 seam for PER-MAILBOX failures. The base class captures a
   * TERMINAL job failure exactly once (D203); failures inside a sweep
   * that records-and-continues are not terminal, so they route through
   * `captureBackgroundFailure` here — same Sentry adapter, per-mailbox
   * granularity. Optional: tests + dev run without one.
   */
  observer?: WorkerObserver;
}

/**
 * WatchRenewalWorker (D8, D225, D229) — keeps Gmail `users.watch`
 * subscriptions alive so the Pub/Sub push webhook keeps receiving
 * change notifications.
 *
 * Policy: `cronPolicy` (D225 named exception — "Runs every 6h; renews
 * Gmail watch subscriptions for all active mailboxes"). The scheduler
 * in the composition root ticks every `WATCH_RENEWAL_INTERVAL_MS`.
 *
 * Idempotency — TWO layers per D225:
 *   1. BullMQ `jobId = WatchRenewalWorker:<minute>` dedups enqueues.
 *   2. A `cron_runs` row claims `(worker_name, scheduled_at_minute)`
 *      durably: `INSERT … ON CONFLICT (run_key) DO UPDATE … WHERE
 *      status <> 'succeeded'` — a fresh run inserts, a RETRY of a
 *      crashed/failed run takes the slot back over, and a run that
 *      already succeeded returns no row → clean `duplicate_run_key`
 *      no-op. Re-watching is also idempotent at the Gmail level
 *      (`users.watch` extends an existing subscription), so even a
 *      double sweep is harmless.
 *
 * Eligibility: `mailbox_accounts.status = 'active'` AND
 * `provider_sync_state.readiness_status = 'ready'` AND a stored OAuth
 * token. Not-yet-ready mailboxes get their first watch at OAuth
 * connect (see `GmailWatchService.watchMailbox`); the sweep covers
 * them once ready (a failed connect-time watch is healed within ≤6h,
 * and the 5-min incremental drift sweep masks the gap meanwhile).
 *
 * FAILURE ISOLATION (the U16 contract): one bad grant must not stop
 * the sweep. Each mailbox renews inside its own try/catch — a failure
 * is logged, Sentry'd via `deps.observer`, counted, and the sweep
 * continues. The JOB only fails (→ retry/dead-letter + the base
 * class's single capture) when EVERY eligible mailbox failed, which
 * indicates a systemic fault (Redis-side topic misconfig, Gmail
 * outage) rather than one revoked grant.
 *
 * Privacy (D7/D228): `users.watch` requests/responses carry topic
 * name, label ids, historyId, expiration — no message content can
 * cross this worker.
 */
export class WatchRenewalWorker extends BaseDeclutrWorker<WatchRenewalJobData, WatchRenewalResult> {
  override readonly workerName = 'WatchRenewalWorker';
  override readonly policy = 'cronPolicy' as const;

  constructor(private readonly deps: WatchRenewalDeps) {
    super();
  }

  /** D225 cron idempotency key — `(worker_name, scheduled_at_minute)`. */
  protected override getIdempotencyKey(payload: WatchRenewalJobData): string {
    return `${this.workerName}:${payload.scheduledAtMinute}`;
  }

  override async processJob(
    payload: WatchRenewalJobData,
    _ctx: WorkerContext,
  ): Promise<WatchRenewalResult> {
    const startedAt = Date.now();
    const runKey = `${this.workerName}:${payload.scheduledAtMinute}`;

    // Watch pipeline off (GMAIL_PUBSUB_TOPIC unset — local dev). Bail
    // BEFORE the cron_runs claim so an idle dev worker writes nothing.
    const topicName = this.deps.topicName;
    if (!topicName) {
      return {
        outcome: 'skipped_disabled',
        eligible: 0,
        watched: 0,
        failed: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    // D225 durable claim. `setWhere` makes the conflict-update a no-op
    // when the slot already SUCCEEDED — RETURNING is then empty and we
    // bail idempotently. A 'running'/'failed' conflict row is a retry
    // of a crashed or failed attempt of THIS SAME jobId (BullMQ holds
    // one job per run-key), so taking the slot over is safe.
    const claimed = await this.deps.db
      .insert(cronRuns)
      .values({ workerName: this.workerName, runKey, status: 'running' })
      .onConflictDoUpdate({
        target: cronRuns.runKey,
        set: { status: 'running', startedAt: sql`now()`, finishedAt: null },
        setWhere: sql`${cronRuns.status} <> 'succeeded'`,
      })
      .returning({ id: cronRuns.id });

    if (claimed.length === 0) {
      return {
        outcome: 'duplicate_run_key',
        eligible: 0,
        watched: 0,
        failed: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    const eligible = await this.deps.db
      .select({ mailboxAccountId: mailboxAccounts.id })
      .from(mailboxAccounts)
      .innerJoin(providerSyncState, eq(providerSyncState.mailboxAccountId, mailboxAccounts.id))
      .where(
        and(
          eq(mailboxAccounts.status, 'active'),
          eq(providerSyncState.readinessStatus, 'ready'),
          isNotNull(mailboxAccounts.encryptedRefreshToken),
        ),
      )
      .orderBy(mailboxAccounts.createdAt);

    let watched = 0;
    let failed = 0;
    for (const { mailboxAccountId } of eligible) {
      try {
        const client = await this.deps.gmailWatch.getClient(mailboxAccountId);
        const result = await client.watch(topicName);
        await persistGmailWatchState(this.deps.db, mailboxAccountId, {
          history_id: result.historyId,
          expiration: new Date(result.expirationMs).toISOString(),
          renewed_at: new Date().toISOString(),
        });
        watched += 1;
        // Structured renewal trace (D159) — ids + timestamps only.
        console.log(
          JSON.stringify({
            level: 'info',
            kind: 'gmail_watch.renewed',
            mailboxAccountId,
            expiration: new Date(result.expirationMs).toISOString(),
          }),
        );
      } catch (err) {
        // Record + continue — one bad grant must not stop the sweep.
        failed += 1;
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'gmail_watch.renewal_failed',
            mailboxAccountId,
            error: error.name,
            message: error.message,
          }),
        );
        this.deps.observer?.captureBackgroundFailure(error, {
          kind: 'gmail_watch.renewal_failed',
          tags: { mailboxAccountId, worker: this.workerName },
        });
      }
    }

    const allFailed = eligible.length > 0 && watched === 0;
    await this.deps.db
      .update(cronRuns)
      .set({ status: allFailed ? 'failed' : 'succeeded', finishedAt: sql`now()` })
      .where(eq(cronRuns.runKey, runKey));

    if (allFailed) {
      // Systemic fault — every mailbox failed. Throw so the base class
      // applies cronPolicy retries + the single terminal capture; the
      // retry re-claims the 'failed' cron_runs slot (setWhere above).
      throw new TransientError(
        `WatchRenewalWorker: all ${eligible.length} eligible mailboxes failed to renew`,
      );
    }

    return {
      outcome: 'swept',
      eligible: eligible.length,
      watched,
      failed,
      durationMs: Date.now() - startedAt,
    };
  }
}
