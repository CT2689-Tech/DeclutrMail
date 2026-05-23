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
   * D224).
   *
   * Reconnect / retry semantics (Codex adversarial review 2026-05-22):
   * BullMQ's `jobId = mailboxAccountId` provides the concurrency cap
   * (only one running per mailbox), but a `queue.add()` with an existing
   * `jobId` is a no-op — a completed-but-retained or failed-and-kept
   * job would silently block a reconnect from ever running. We
   * inspect the prior job's state before enqueueing:
   *   - `active` / `waiting` / `delayed` / `prioritized` / `waiting-children`
   *     — already in flight or queued; skip the add (no double-enqueue).
   *   - `completed` / `failed` — terminal; remove the stale job so the
   *     fresh add creates a runnable replacement.
   *   - none — just add.
   */
  async enqueueInitialSync(mailboxAccountId: string): Promise<void> {
    const existing = await this.queue.getJob(mailboxAccountId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') {
        await existing.remove();
      } else {
        // active / waiting / delayed / prioritized / waiting-children /
        // unknown — a sync is in flight or queued. Don't double-enqueue.
        return;
      }
    }

    // Add the BullMQ job BEFORE touching `provider_sync_state` (Codex
    // adversarial review 2026-05-22). If `add()` throws (Redis down /
    // BullMQ misbehaving), the DB state stays at whatever it was — the
    // mailbox never advertises `queued` without a runnable job to back
    // it. If the remove-then-add window crashed between the two Redis
    // calls, the next reconnect's `getJob` returns null and just adds
    // cleanly — no permanent stranding.
    await this.queue.add(
      INITIAL_SYNC_JOB,
      { mailboxAccountId },
      initialSyncJobOptions(mailboxAccountId),
    );

    // Job is queued. Now write the gate-visible `queued` state. If this
    // DB write fails, the worker's first stage upserts the state itself
    // (`upsertSyncState`) — never blocks the sync.
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
  }
}
