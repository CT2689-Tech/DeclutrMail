import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { eq, inArray, sql } from 'drizzle-orm';
import { providerSyncState } from '@declutrmail/db';
import {
  ensureIncrementalSyncJob,
  ensureInitialSyncJob,
  type IncrementalSyncJobData,
} from '@declutrmail/workers';
import type { InitialSyncJobData } from '@declutrmail/workers';
import type { SyncReadiness, SyncStatus } from '@declutrmail/shared/contracts';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

/**
 * The Drizzle executor a `markQueued` call accepts — either the
 * top-level DB connection or a transaction-bound client. Same insert
 * surface; using a type alias instead of structural duck-typing keeps
 * callers honest.
 */
type DrizzleExecutor = DrizzleDb | Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

/**
 * Result of {@link SyncService.advanceHistoryId}.
 *
 *   - `advanced`: row existed with NON-NULL last_history_id, incoming > last_history_id, UPDATE applied
 *   - `stale`:    row existed but incoming <= last_history_id (last value returned)
 *   - `uninitialized`: no provider_sync_state row exists for this mailbox
 *   - `deferred_initial_sync_in_flight`: row existed but `last_history_id IS NULL`.
 *     InitialSync has NOT yet written its snapshot S via `markReady` (the row
 *     was created by `markQueued` in OAuth-connect and `markReady` runs AFTER
 *     the metadata fetch). Advancing the cursor NULL → H here would strand the
 *     (S, H] range: InitialSync's `markReady` uses GREATEST(stored, snapshot),
 *     so its later write of S would be rejected once the webhook had already
 *     written H>S, and the history events in (S, H] would never be paged.
 *     The deferred path leaves the cursor NULL so InitialSync writes S
 *     unimpeded; the next webhook (or the 10-min drift sweep, which uses the
 *     stored cursor as both start and end) then enqueues from S, recovering
 *     the range. (D38 webhook-vs-InitialSync race fix, 2026-06-09.)
 *
 * Bootstrap of a missing row is the OAuth-connect / InitialSyncWorker
 * flow's responsibility (D109, D224) — `advanceHistoryId` never creates
 * the row. Callers map `uninitialized` to a successful no-op so Pub/Sub
 * stops retrying a delivery that initial sync wouldn't fix.
 */
export type AdvanceHistoryIdResult =
  | { kind: 'advanced'; previousHistoryId: bigint }
  | { kind: 'stale'; lastHistoryId: bigint | null }
  | { kind: 'uninitialized' }
  | { kind: 'deferred_initial_sync_in_flight' };

/** NestJS DI token for the initial-sync BullMQ queue (D157). */
export const INITIAL_SYNC_QUEUE_TOKEN = 'INITIAL_SYNC_QUEUE';

/**
 * NestJS DI token for the incremental-sync BullMQ queue (D8, D229).
 *
 * Owned by SyncModule — the sync feature is the canonical producer
 * (D204 boundary; provider_sync_state is its table). WebhooksModule
 * imports SyncModule and consumes via this same token, so a Pub/Sub
 * push and a "Sync now" button click both share one Queue instance
 * (= one Redis connection, one observability surface).
 */
export const INCREMENTAL_SYNC_QUEUE_TOKEN = 'INCREMENTAL_SYNC_QUEUE';

/**
 * Result of {@link SyncService.enqueueManualIncrementalSync}.
 *
 *   - `enqueued`   — new job added; reconciler will pick up + advance cursor.
 *   - `noop`       — a job for the same cursor is already in-flight (BullMQ
 *                    dedups by `${mailbox}:${historyId}`). The button still
 *                    feels "successful" but it does not double-enqueue.
 *   - `not_ready`  — initial sync has not completed for this mailbox yet, so
 *                    there is no `last_history_id` to advance from. The
 *                    controller maps this to a 409 with `code: 'SYNC_NOT_READY'`.
 */
export type ManualIncrementalSyncResult =
  | { kind: 'enqueued'; cursorHistoryId: string }
  | { kind: 'noop'; cursorHistoryId: string }
  | { kind: 'not_ready' };

/**
 * SyncService — the sync feature's facade (D201/D204).
 *
 * It owns `provider_sync_state` (its own table) and the initial-sync
 * queue producer. The auth feature triggers a backfill by importing
 * `SyncModule` and calling `enqueueInitialSync` — it never touches the
 * queue or `provider_sync_state` directly.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(INITIAL_SYNC_QUEUE_TOKEN) private readonly queue: Queue<InitialSyncJobData>,
    @Inject(INCREMENTAL_SYNC_QUEUE_TOKEN)
    private readonly incrementalQueue: Queue<IncrementalSyncJobData>,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  /**
   * Write the durable `queued` sync intent for one mailbox (D157, D224).
   *
   * Codex iter 5/6 contract:
   *
   *   `provider_sync_state.readiness_status = 'queued'` IS the durable
   *   sync intent. BullMQ is the execution cache.
   *
   * Accepts a `DrizzleExecutor` (top-level db OR a transaction client)
   * so callers can include this write in the SAME transaction as a
   * mailbox upsert — connect MUST be atomic across "mailbox persisted"
   * and "sync intent recorded" (Codex iter 6 high finding). The OAuth
   * refresh token is single-use; a mailbox row without a durable sync
   * intent would strand the user (no row for the reconciler to find).
   */
  async markQueued(executor: DrizzleExecutor, mailboxAccountId: string): Promise<void> {
    await executor
      .insert(providerSyncState)
      .values({
        mailboxAccountId,
        currentStage: 'queued',
        readinessStatus: 'queued',
        progressPct: 0,
      })
      .onConflictDoUpdate({
        target: providerSyncState.mailboxAccountId,
        set: {
          currentStage: 'queued',
          readinessStatus: 'queued',
          progressPct: 0,
          errorCode: null,
          updatedAt: sql`now()`,
        },
      });
  }

  /**
   * Best-effort BullMQ enqueue (D157). Delegates to
   * `ensureInitialSyncJob` — the SINGLE scheduling implementation
   * shared with the worker's periodic reconciler. Failure here MUST
   * NOT propagate: the durable intent row is the safety net, and the
   * reconciler will materialize the missing job on its next tick.
   */
  async schedule(mailboxAccountId: string, opts: { force?: boolean } = {}): Promise<void> {
    try {
      await ensureInitialSyncJob(this.queue, mailboxAccountId, opts);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'sync.enqueue_failed',
          mailboxAccountId,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  /**
   * Composite — non-tx callers that have already committed (or never
   * needed to combine writes) get the full "mark + schedule" in one
   * call. The reconciler uses `schedule` directly because it works
   * from already-committed `queued` rows.
   */
  async enqueueInitialSync(mailboxAccountId: string): Promise<void> {
    await this.markQueued(this.db, mailboxAccountId);
    await this.schedule(mailboxAccountId);
  }

  /**
   * Advance `provider_sync_state.last_history_id` for one mailbox,
   * inside a SERIALIZABLE-equivalent SELECT-FOR-UPDATE + UPDATE
   * transaction (D229 step 8 monotonic cursor).
   *
   * Cross-feature facade (D204): the webhooks module calls this rather
   * than touching `provider_sync_state` directly. The sync feature owns
   * the table and the lock semantics; webhook is just the trigger.
   *
   * No `incrementalSync` enqueue here — the BullMQ producer for the
   * follow-up incremental-sync job lands in the next PR (`processVerifiedPush`
   * documents the gap). The dedup row + advanced cursor are the atomic
   * effect for this PR.
   */
  async advanceHistoryId(args: {
    mailboxAccountId: string;
    incomingHistoryId: bigint;
  }): Promise<AdvanceHistoryIdResult> {
    return this.db.transaction((tx) => this.advanceHistoryIdWithExecutor(tx, args));
  }

  /**
   * Same SELECT-FOR-UPDATE + UPDATE as {@link advanceHistoryId} but
   * runs inside a caller-provided executor (transaction client).
   *
   * Exposed so callers that need to fold the cursor advance into a
   * LARGER atomic unit (e.g. the Gmail webhook's dedup-write + cursor-advance
   * critical section, P1 fix) can share one transaction. The row lock
   * acquired by `.for('update')` is held by the caller's transaction
   * until that transaction commits or rolls back — exactly the semantics
   * we want when the dedup row + cursor advance must commit together.
   */
  async advanceHistoryIdWithExecutor(
    executor: DrizzleExecutor,
    args: { mailboxAccountId: string; incomingHistoryId: bigint },
  ): Promise<AdvanceHistoryIdResult> {
    const rows = await executor
      .select({ lastHistoryId: providerSyncState.lastHistoryId })
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, args.mailboxAccountId))
      .for('update')
      .limit(1);
    if (rows.length === 0) {
      return { kind: 'uninitialized' };
    }
    const previousHistoryId = rows[0]!.lastHistoryId ?? null;
    // D38 race fix: cursor IS NULL means InitialSync's `markReady` has not
    // yet written the snapshot S. Advancing NULL → H here would orphan
    // (S, H] because `markReady`'s GREATEST(stored=H, snapshot=S) keeps H
    // and never writes S. Leave the cursor NULL; InitialSync will write S
    // when it finishes, and the next webhook / drift sweep will enqueue
    // from S, which covers all history events including (S, H].
    if (previousHistoryId === null) {
      return { kind: 'deferred_initial_sync_in_flight' };
    }
    if (previousHistoryId >= args.incomingHistoryId) {
      return { kind: 'stale', lastHistoryId: previousHistoryId };
    }
    await executor
      .update(providerSyncState)
      .set({
        lastHistoryId: args.incomingHistoryId,
        historyIdUpdatedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(providerSyncState.mailboxAccountId, args.mailboxAccountId));
    return { kind: 'advanced', previousHistoryId };
  }

  /**
   * Read the `provider_sync_state` row for one mailbox and project it
   * into the D224 `SyncStatus` wire shape.
   *
   * Returns `null` when the mailbox has no row yet — caller maps that
   * to a 404. The controller is the only allowed caller; it is the
   * boundary where the projection is Zod-validated against
   * `SyncStatusSchema` before being returned to the client (D224).
   *
   * No body data, no headers — stage + numeric progress + an
   * allowlisted boolean (D7/§2.1).
   */
  async getStatus(mailboxAccountId: string): Promise<SyncStatus | null> {
    const rows = await this.db
      .select({
        readinessStatus: providerSyncState.readinessStatus,
        currentStage: providerSyncState.currentStage,
        progressPct: providerSyncState.progressPct,
        errorCode: providerSyncState.errorCode,
        lastSyncedAt: providerSyncState.lastSyncedAt,
        lastIncrementalErrorAt: providerSyncState.lastIncrementalErrorAt,
        lastIncrementalErrorCode: providerSyncState.lastIncrementalErrorCode,
      })
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const base = {
      readiness_status: row.readinessStatus,
      current_stage: row.currentStage,
      progress_pct: row.progressPct,
      is_ready_for_triage: row.readinessStatus === 'ready',
      // Wall-clock freshness for the "synced Xm ago" label + the
      // Sync-now completion watch. Null until the first run finishes.
      last_synced_at: row.lastSyncedAt === null ? null : row.lastSyncedAt.toISOString(),
      // Incremental terminal-failure marker — lets the completion watch
      // fail fast instead of waiting on a stamp that will never move.
      last_sync_error_at:
        row.lastIncrementalErrorAt === null ? null : row.lastIncrementalErrorAt.toISOString(),
      last_sync_error_code: row.lastIncrementalErrorCode,
    } as const;

    // `exactOptionalPropertyTypes`: include `error_code` ONLY when set,
    // never as `undefined`.
    return row.errorCode === null ? base : { ...base, error_code: row.errorCode };
  }

  /**
   * Batch readiness lookup for a set of mailboxes (D116). This is the
   * sync-feature facade the account switcher reads through, so the
   * mailboxes feature never joins `provider_sync_state` itself (D204 —
   * this table is owned here). Mailboxes with no sync row are simply
   * absent from the returned map; callers default those to `null`.
   */
  async getReadinessByMailbox(mailboxAccountIds: string[]): Promise<Map<string, SyncReadiness>> {
    if (mailboxAccountIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        mailboxAccountId: providerSyncState.mailboxAccountId,
        readinessStatus: providerSyncState.readinessStatus,
      })
      .from(providerSyncState)
      .where(inArray(providerSyncState.mailboxAccountId, mailboxAccountIds));
    return new Map(rows.map((r) => [r.mailboxAccountId, r.readinessStatus]));
  }

  /**
   * Enqueue an on-demand incremental sync for one mailbox.
   *
   * Surfaces:
   *   - `POST /api/v1/sync/incremental` (the user-facing "Sync now" button).
   *   - The 5-min reconciliation cron in `apps/api/src/worker.ts`
   *     (catch-up path while Pub/Sub is still being wired in prod, and
   *     drift safety net even after Pub/Sub lands).
   *
   * Contract:
   *   1. Look up the mailbox's current cursor (`provider_sync_state.last_history_id`).
   *      Null cursor → `{ kind: 'not_ready' }`; initial sync hasn't completed.
   *   2. Use the cursor as BOTH `startHistoryId` and `endHistoryId` so the
   *      BullMQ `jobId = ${mailbox}:${cursor}` dedups consecutive clicks
   *      against the same cursor (returns `noop`). Once the worker advances
   *      the cursor, a new click yields a fresh `jobId` → `enqueued`.
   *   3. Failure to enqueue propagates as a thrown error — the controller
   *      maps it to 500; the reconciler swallows + logs.
   *
   * No body data, no PII, no message-derived state — this method only
   * speaks to BullMQ + `provider_sync_state` (privacy posture §2.1).
   */
  async enqueueManualIncrementalSync(
    mailboxAccountId: string,
    trigger: 'manual' | 'cron',
  ): Promise<ManualIncrementalSyncResult> {
    const rows = await this.db
      .select({ lastHistoryId: providerSyncState.lastHistoryId })
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId))
      .limit(1);

    const lastHistoryId = rows[0]?.lastHistoryId ?? null;
    if (lastHistoryId === null) {
      return { kind: 'not_ready' };
    }

    const cursor = lastHistoryId.toString();
    const outcome = await ensureIncrementalSyncJob(this.incrementalQueue, {
      mailboxAccountId,
      startHistoryId: cursor,
      endHistoryId: cursor,
    });

    // Structured log so the cron path is observable in Cloud Logging
    // without a separate metrics surface. `trigger` lets us distinguish
    // user clicks from drift recovery.
    this.logger.log(
      JSON.stringify({
        kind: 'sync.manual_enqueue',
        mailboxAccountId,
        trigger,
        outcome,
        cursorHistoryId: cursor,
      }),
    );

    return outcome === 'added'
      ? { kind: 'enqueued', cursorHistoryId: cursor }
      : { kind: 'noop', cursorHistoryId: cursor };
  }

  /**
   * Drift sweep — for the cron in `apps/api/src/worker.ts`. Returns the
   * list of mailbox ids that have a `last_history_id` AND haven't been
   * advanced in `staleAfterMs`. The cron then walks each one through
   * `enqueueManualIncrementalSync` with `trigger='cron'`.
   *
   * Predicate (Drizzle SQL, see `provider_sync_state.history_id_updated_at`
   * idx D229): `last_history_id IS NOT NULL AND history_id_updated_at < now() - staleAfterMs`.
   */
  async listMailboxesNeedingDriftSweep(staleAfterMs: number): Promise<string[]> {
    const cutoff = sql`now() - ${sql.raw(`interval '${staleAfterMs} milliseconds'`)}`;
    const rows = await this.db
      .select({ mailboxAccountId: providerSyncState.mailboxAccountId })
      .from(providerSyncState)
      .where(
        sql`${providerSyncState.lastHistoryId} IS NOT NULL AND ${providerSyncState.historyIdUpdatedAt} < ${cutoff}`,
      );
    return rows.map((r) => r.mailboxAccountId);
  }
}

/**
 * Throw a 409 with a structured `code` for the FE to render a real
 * state. Mirrors the `CurrentMailboxGuard` 409s the FE already handles
 * (SELECT_MAILBOX / NO_ACTIVE_MAILBOX) — `SYNC_NOT_READY` is a designed
 * state per CLAUDE.md §8 "guard-4xx-as-designed-state".
 *
 * `ConflictException` maps to HTTP 409 in Nest (not `BadRequestException`'s
 * 400 — earlier draft of this code used BadRequestException by mistake;
 * architecture-guardian flagged the contract drift 2026-06-06).
 */
export function syncNotReady(): ConflictException {
  return new ConflictException({
    code: 'SYNC_NOT_READY',
    message: 'Initial sync has not completed for this mailbox yet.',
  });
}
