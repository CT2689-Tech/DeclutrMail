import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { mailboxAccounts, webhookDedup } from '@declutrmail/db';
import { ensureIncrementalSyncJob, type IncrementalSyncJobData } from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { SyncService } from '../sync/sync.service.js';

/** DI token for the BullMQ `Queue<IncrementalSyncJobData>` producer. */
export const INCREMENTAL_SYNC_QUEUE_TOKEN = 'INCREMENTAL_SYNC_QUEUE';

/**
 * Gmail Pub/Sub webhook service (D8, D229).
 *
 * Owns the dedup + monotonic-historyId state transitions that
 * follow OIDC verification. Split out of the controller so the
 * decision branches are unit-testable without an HTTP harness.
 *
 * Responsibility split:
 *   - Controller: HTTP-level concerns (header parse, body parse,
 *     status codes). Calls verify() then process().
 *   - Service (this file): owns DB writes for steps 7 + 8 plus
 *     the enqueue of the incremental-sync job.
 *
 * The full incremental-sync worker lands later; this PR records the
 * cursor advance and returns the `enqueue intent`. The follow-up
 * worker PR wires the BullMQ producer for `incremental-sync` jobs.
 */

/** Pub/Sub envelope's inner data — Gmail-specific payload. */
export interface GmailPubSubPayload {
  emailAddress: string;
  historyId: string;
}

/** Outcome of `processVerifiedPush` — drives the controller's response. */
export type ProcessOutcome =
  | { kind: 'duplicate_message_id'; messageId: string }
  | { kind: 'unknown_mailbox'; emailAddress: string }
  | { kind: 'sync_state_uninitialized'; mailboxAccountId: string }
  | { kind: 'stale_history_id'; lastHistoryId: bigint | null; incomingHistoryId: bigint }
  | {
      kind: 'enqueued';
      mailboxAccountId: string;
      previousHistoryId: bigint | null;
      historyId: bigint;
    };

/** TTL for dedup rows — 24h, well beyond Pub/Sub's 10-minute ack deadline. */
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class GmailWebhookService {
  private readonly logger = new Logger(GmailWebhookService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly sync: SyncService,
    @Inject(INCREMENTAL_SYNC_QUEUE_TOKEN)
    private readonly incrementalSyncQueue: Queue<IncrementalSyncJobData>,
  ) {}

  /**
   * Process a successfully-OIDC-verified Pub/Sub push. Encapsulates
   * D229 step 7 (messageId dedup) + step 8 (historyId monotonic) +
   * the enqueue of the incremental-sync job.
   *
   * Returns a discriminated outcome. The controller maps each kind
   * to an HTTP status: all return 200 except `unknown_mailbox`
   * which returns 404 so Pub/Sub stops retrying (per Pub/Sub's
   * retry semantics, 4xx is a permanent failure; 5xx triggers
   * redelivery — exactly what we want for stale unknown mailboxes).
   *
   * Note: D229's contract says ALL OIDC failures map to 401. This
   * method is only called AFTER OIDC verify succeeds, so it never
   * returns 401.
   */
  async processVerifiedPush(args: {
    messageId: string;
    payload: GmailPubSubPayload;
  }): Promise<ProcessOutcome> {
    const incomingHistoryId = BigInt(args.payload.historyId);
    const expiresAt = new Date(Date.now() + DEDUP_TTL_MS);

    // The dedup write and the historyId advance MUST commit atomically
    // (P1 review of PR #113). A crash between the two would leave the
    // dedup row durable while the cursor stayed put — Pub/Sub's retry
    // would then return `duplicate_message_id` and skip the cursor
    // advance forever. One transaction = both writes commit or neither
    // does; a Pub/Sub retry of a crashed run re-enters this block fresh.
    return this.db.transaction(async (tx): Promise<ProcessOutcome> => {
      // Step 7: messageId dedup. Atomic PK insert; conflict means
      // we've already processed this delivery. Insert FIRST, before
      // any other state lookup, so a duplicate burst from Pub/Sub
      // cannot race with itself.
      const dedupInsert = await tx
        .insert(webhookDedup)
        .values({ messageId: args.messageId, expiresAt })
        .onConflictDoNothing({ target: webhookDedup.messageId })
        .returning({ messageId: webhookDedup.messageId });

      if (dedupInsert.length === 0) {
        return { kind: 'duplicate_message_id', messageId: args.messageId };
      }

      // Resolve the mailbox by emailAddress (Gmail's provider_account_id).
      const mailboxRows = await tx
        .select({ id: mailboxAccounts.id })
        .from(mailboxAccounts)
        .where(
          and(
            eq(mailboxAccounts.provider, 'gmail'),
            eq(mailboxAccounts.providerAccountId, args.payload.emailAddress),
          ),
        )
        .limit(1);
      const mailbox = mailboxRows[0];
      if (!mailbox) {
        return { kind: 'unknown_mailbox', emailAddress: args.payload.emailAddress };
      }

      // Backfill the dedup row's mailbox_account_id for trace.
      await tx
        .update(webhookDedup)
        .set({ mailboxAccountId: mailbox.id })
        .where(eq(webhookDedup.messageId, args.messageId));

      // Step 8: delegate the monotonic cursor advance to SyncService
      // (D204 — `provider_sync_state` is owned by the sync feature).
      // We pass the current tx so the SELECT-FOR-UPDATE + UPDATE join the
      // same atomic unit as the dedup write above. Bootstrap of a missing
      // row stays out of this path — see `AdvanceHistoryIdResult` and
      // D224's sync gate.
      const advance = await this.sync.advanceHistoryIdWithExecutor(tx, {
        mailboxAccountId: mailbox.id,
        incomingHistoryId,
      });

      if (advance.kind === 'uninitialized') {
        // Successful no-op: 200 to Pub/Sub so it doesn't retry — the
        // mailbox needs OAuth + InitialSyncWorker to seed the cursor
        // first, and Pub/Sub retries won't fix that. Privacy (D7): the
        // mailbox-id-resolution succeeded but sync_state is missing;
        // no message body, no payload — only the resolution outcome.
        this.logger.warn(`webhook.received_for_uninitialized_mailbox mailbox=${mailbox.id}`);
        return { kind: 'sync_state_uninitialized', mailboxAccountId: mailbox.id };
      }

      if (advance.kind === 'stale') {
        return {
          kind: 'stale_history_id',
          lastHistoryId: advance.lastHistoryId,
          incomingHistoryId,
        };
      }

      // D8 — enqueue the incremental-sync job over
      // [previousHistoryId, incomingHistoryId]. The enqueue happens
      // AFTER the tx body but BEFORE the tx commits because BullMQ
      // doesn't participate in PG transactions; if Redis is down the
      // tx still commits (the dedup row + cursor advance are durable)
      // and the future reconciler will pick up the range gap on its
      // next tick. The enqueue itself is idempotent —
      // `ensureIncrementalSyncJob` dedups on
      // `${mailboxAccountId}:${endHistoryId}` so a Pub/Sub redelivery
      // of the same historyId cannot double-enqueue.
      //
      // Stringify the bigints — BullMQ's job payload goes through
      // JSON.stringify, which throws on bigint. The worker parses
      // them back with `BigInt(startHistoryId)`.
      // `previousHistoryId` can be null on the very first advance
      // after an initial sync seeds the row — the worker needs a
      // concrete cursor to page from, so skip enqueue (the initial
      // sync already covers messages up to its snapshot). Subsequent
      // webhooks will have a non-null cursor and enqueue normally.
      if (advance.previousHistoryId === null) {
        this.logger.log(
          `webhook.skipped_first_enqueue mailbox=${mailbox.id} historyId=${incomingHistoryId}`,
        );
        return {
          kind: 'enqueued',
          mailboxAccountId: mailbox.id,
          previousHistoryId: advance.previousHistoryId,
          historyId: incomingHistoryId,
        };
      }
      try {
        await ensureIncrementalSyncJob(this.incrementalSyncQueue, {
          mailboxAccountId: mailbox.id,
          startHistoryId: advance.previousHistoryId.toString(),
          endHistoryId: incomingHistoryId.toString(),
        });
      } catch (err) {
        // An enqueue failure is non-fatal — the dedup + cursor advance
        // remain durable. Log so the reconciler's next-tick range
        // backfill is the observable recovery path. Silent-failure
        // hunter would flag swallowing this; we capture + emit, never
        // throw past the webhook contract.
        this.logger.warn(
          `webhook.incremental_enqueue_failed mailbox=${mailbox.id} error=${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      return {
        kind: 'enqueued',
        mailboxAccountId: mailbox.id,
        previousHistoryId: advance.previousHistoryId,
        historyId: incomingHistoryId,
      };
    });
  }
}
