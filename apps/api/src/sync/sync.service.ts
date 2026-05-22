import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { providerSyncState } from '@declutrmail/db';
import { INITIAL_SYNC_JOB, initialSyncJobOptions } from '@declutrmail/workers';
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
   * Mark a mailbox `queued` and enqueue its full-mailbox backfill (D157,
   * D224). Idempotent: the `provider_sync_state` row is upserted and the
   * job uses `jobId = mailboxAccountId`, so a duplicate connect cannot
   * start a second concurrent backfill.
   */
  async enqueueInitialSync(mailboxAccountId: string): Promise<void> {
    // Write the `queued` row first so the onboarding gate (D224) has a
    // state to read before the worker picks the job up.
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

    await this.queue.add(
      INITIAL_SYNC_JOB,
      { mailboxAccountId },
      initialSyncJobOptions(mailboxAccountId),
    );
  }
}
