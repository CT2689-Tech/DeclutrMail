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
      // Non-null — `previousHistoryId === null` is now the dedicated
      // `first_advance_skipped_enqueue` variant below (architecture-
      // guardian 2026-06-05). `enqueued` always means "job dispatched
      // to Redis or its enqueue was attempted post-commit."
      previousHistoryId: bigint;
      historyId: bigint;
    }
  | {
      // First-advance skip — webhook arrived for a mailbox whose
      // `last_history_id` was just seeded by initial-sync (the snapshot
      // taken at sync start) and no prior cursor existed. The
      // InitialSyncWorker already covered messages up to its snapshot,
      // so this delta is empty by construction — the worker would have
      // nothing to page. Cursor advance still commits durably; this
      // variant exists so observability counters split "actually
      // enqueued" from "deliberately skipped first-advance."
      kind: 'first_advance_skipped_enqueue';
      mailboxAccountId: string;
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
    //
    // The BullMQ enqueue (D8) lives OUTSIDE this transaction
    // (architecture-guardian 2026-06-05 [BLOCKING] fix). BullMQ does not
    // participate in PG transactions; awaiting `queue.add` inside the
    // tx would publish the job to Redis BEFORE the tx commits, so a
    // commit failure (PG conn drop / serialization failure / statement
    // timeout) would leave the job durable while the cursor advance is
    // rolled back — the worker would then run against the OLD
    // `last_history_id`, silently regressing the cursor. Symmetric to
    // `SyncModule.connect` which enqueues `initial-sync` AFTER the
    // OAuth tx commits.
    const outcome = await this.db.transaction(async (tx): Promise<ProcessOutcome> => {
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

      // Split here so the outcome's discriminator HONESTLY reflects
      // whether an enqueue will be attempted. `previousHistoryId ===
      // null` is the first-advance case where the InitialSyncWorker
      // already covers the delta — never attempt the enqueue (the
      // worker can't page from a null cursor).
      if (advance.previousHistoryId === null) {
        return {
          kind: 'first_advance_skipped_enqueue',
          mailboxAccountId: mailbox.id,
          historyId: incomingHistoryId,
        };
      }
      return {
        kind: 'enqueued',
        mailboxAccountId: mailbox.id,
        previousHistoryId: advance.previousHistoryId,
        historyId: incomingHistoryId,
      };
    });

    // D8 enqueue — runs ONLY after the tx commits successfully, so a
    // committed `enqueued` outcome is the canonical signal both
    // (a) cursor advanced durably AND (b) job is/will-be in Redis.
    //
    // `ensureIncrementalSyncJob` is idempotent on
    // `${mailboxAccountId}:${endHistoryId}` so a Pub/Sub redelivery
    // re-running this path cannot double-enqueue. BigInts are
    // stringified — BullMQ's payload goes through `JSON.stringify`
    // which throws on bigint; the worker parses back via `BigInt(...)`.
    if (outcome.kind === 'enqueued') {
      try {
        await ensureIncrementalSyncJob(this.incrementalSyncQueue, {
          mailboxAccountId: outcome.mailboxAccountId,
          startHistoryId: outcome.previousHistoryId.toString(),
          endHistoryId: outcome.historyId.toString(),
        });
      } catch (err) {
        // Cursor advance is durable; enqueue failure is recoverable
        // via the future reconciler-on-redis-state tick. Surface the
        // gap as a WARN so on-call can grep without losing the
        // outcome — never rethrow past the webhook contract.
        this.logger.warn(
          `webhook.incremental_enqueue_failed mailbox=${outcome.mailboxAccountId} ` +
            `error=${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else if (outcome.kind === 'first_advance_skipped_enqueue') {
      this.logger.log(
        `webhook.skipped_first_enqueue mailbox=${outcome.mailboxAccountId} ` +
          `historyId=${outcome.historyId}`,
      );
    }

    return outcome;
  }
}
