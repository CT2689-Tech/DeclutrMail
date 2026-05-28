import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { eq, inArray, sql } from 'drizzle-orm';
import { providerSyncState } from '@declutrmail/db';
import { ensureInitialSyncJob } from '@declutrmail/workers';
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
 *   - `advanced`: row existed, incoming > last_history_id, UPDATE applied
 *   - `stale`:    row existed but incoming <= last_history_id (last value returned)
 *   - `uninitialized`: no provider_sync_state row exists for this mailbox
 *
 * Bootstrap of a missing row is the OAuth-connect / InitialSyncWorker
 * flow's responsibility (D109, D224) — `advanceHistoryId` never creates
 * the row. Callers map `uninitialized` to a successful no-op so Pub/Sub
 * stops retrying a delivery that initial sync wouldn't fix.
 */
export type AdvanceHistoryIdResult =
  | { kind: 'advanced'; previousHistoryId: bigint | null }
  | { kind: 'stale'; lastHistoryId: bigint | null }
  | { kind: 'uninitialized' };

/** NestJS DI token for the initial-sync BullMQ queue (D157). */
export const INITIAL_SYNC_QUEUE_TOKEN = 'INITIAL_SYNC_QUEUE';

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
  constructor(
    @Inject(INITIAL_SYNC_QUEUE_TOKEN) private readonly queue: Queue<InitialSyncJobData>,
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
    if (previousHistoryId !== null && previousHistoryId >= args.incomingHistoryId) {
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
}
