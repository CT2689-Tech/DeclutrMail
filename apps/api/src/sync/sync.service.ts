import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { providerSyncState } from '@declutrmail/db';
import { ensureInitialSyncJob } from '@declutrmail/workers';
import type { InitialSyncJobData } from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

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
   * Mark a mailbox `queued` and (best-effort) enqueue its full-mailbox
   * backfill (D157, D224).
   *
   * Codex adversarial review iter 5, 2026-05-22 — durable-intent
   * contract:
   *
   *   `provider_sync_state.readiness_status = 'queued'` IS the durable
   *   sync intent. BullMQ is an execution cache.
   *
   * The DB write happens FIRST so it cannot be lost to a Redis outage.
   * The enqueue is delegated to `ensureInitialSyncJob` (the single
   * scheduling implementation, shared with the worker's periodic
   * reconciler). If the enqueue throws, we LOG and SWALLOW — the
   * `queued` row remains in place, and the worker's reconciler picks it
   * up on its next tick. This is the inversion of the prior contract:
   * we no longer require BullMQ to be reachable for sync intent to
   * survive.
   */
  async enqueueInitialSync(mailboxAccountId: string): Promise<void> {
    // 1. Durable intent. Survives a Redis outage; the reconciler will
    //    materialize the missing job on its next tick.
    await this.db
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

    // 2. Best-effort enqueue. Failure here MUST NOT erase the durable
    //    intent above — the reconciler is the safety net.
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
}
