import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { providerSyncState } from '@declutrmail/db';
import { ensureInitialSyncJob } from '@declutrmail/workers';
import type { InitialSyncJobData } from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

/**
 * The Drizzle executor a `markQueued` call accepts — either the
 * top-level DB connection or a transaction-bound client. Same insert
 * surface; using a type alias instead of structural duck-typing keeps
 * callers honest.
 */
type DrizzleExecutor = DrizzleDb | Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

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
  async schedule(mailboxAccountId: string): Promise<void> {
    try {
      await ensureInitialSyncJob(this.queue, mailboxAccountId);
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
}
