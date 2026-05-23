import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { mailboxAccounts, providerSyncState, webhookDedup } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

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
  | { kind: 'stale_history_id'; lastHistoryId: bigint | null; incomingHistoryId: bigint }
  | {
      kind: 'enqueued';
      mailboxAccountId: string;
      previousHistoryId: bigint | null;
      historyId: bigint;
    };

/**
 * Snapshot of provider_sync_state before the historyId advance.
 * We capture the previous cursor by `RETURNING` from a transactional
 * read-modify-write below.
 */
interface AdvanceResult {
  previousHistoryId: bigint | null;
}

/** TTL for dedup rows — 24h, well beyond Pub/Sub's 10-minute ack deadline. */
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class GmailWebhookService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

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

    // Step 7: messageId dedup. Atomic PK insert; conflict means
    // we've already processed this delivery. Insert FIRST, before
    // any other state lookup, so a duplicate burst from Pub/Sub
    // cannot race with itself.
    const dedupInsert = await this.db
      .insert(webhookDedup)
      .values({ messageId: args.messageId, expiresAt })
      .onConflictDoNothing({ target: webhookDedup.messageId })
      .returning({ messageId: webhookDedup.messageId });

    if (dedupInsert.length === 0) {
      return { kind: 'duplicate_message_id', messageId: args.messageId };
    }

    // Resolve the mailbox by emailAddress (Gmail's provider_account_id).
    const mailboxRows = await this.db
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
    await this.db
      .update(webhookDedup)
      .set({ mailboxAccountId: mailbox.id })
      .where(eq(webhookDedup.messageId, args.messageId));

    // Step 8: historyId monotonic. Read-modify-write inside a
    // transaction so concurrent deliveries cannot both advance past
    // each other's writes. The SELECT takes a row lock; the UPDATE
    // sets both `last_history_id` and `history_id_updated_at`.
    const advance = await this.db.transaction(async (tx): Promise<AdvanceResult | null> => {
      const rows = await tx
        .select({ lastHistoryId: providerSyncState.lastHistoryId })
        .from(providerSyncState)
        .where(eq(providerSyncState.mailboxAccountId, mailbox.id))
        .for('update')
        .limit(1);
      const previousHistoryId = rows[0]?.lastHistoryId ?? null;
      if (previousHistoryId !== null && previousHistoryId >= incomingHistoryId) {
        return null;
      }
      if (rows.length === 0) {
        // No provider_sync_state row exists — mailbox connected but
        // sync never queued. Create the row with the incoming cursor
        // and `ready` state so future webhooks have something to
        // compare against. This is the only path that bootstraps
        // sync state from a webhook; the OAuth-connect path normally
        // inserts the row.
        await tx.insert(providerSyncState).values({
          mailboxAccountId: mailbox.id,
          lastHistoryId: incomingHistoryId,
          historyIdUpdatedAt: new Date(),
          readinessStatus: 'ready',
          currentStage: 'ready',
          progressPct: 100,
        });
      } else {
        await tx
          .update(providerSyncState)
          .set({
            lastHistoryId: incomingHistoryId,
            historyIdUpdatedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(providerSyncState.mailboxAccountId, mailbox.id));
      }
      return { previousHistoryId };
    });

    if (advance === null) {
      const current = await this.db
        .select({ lastHistoryId: providerSyncState.lastHistoryId })
        .from(providerSyncState)
        .where(eq(providerSyncState.mailboxAccountId, mailbox.id))
        .limit(1);
      const lastHistoryId = current[0]?.lastHistoryId ?? null;
      return { kind: 'stale_history_id', lastHistoryId, incomingHistoryId };
    }

    // TODO(D8 follow-up): enqueue an incremental-sync job over
    // [previousHistoryId, incomingHistoryId]. The incremental-sync
    // worker + queue land in the next PR; for now the cursor
    // advance is the durable signal the reconciler will use to
    // backfill the range. The dedup row + advanced cursor are the
    // atomic effect; an enqueue failure cannot leave us in an
    // inconsistent state because the reconciler will pick up any
    // range gap on its next tick.

    return {
      kind: 'enqueued',
      mailboxAccountId: mailbox.id,
      previousHistoryId: advance.previousHistoryId,
      historyId: incomingHistoryId,
    };
  }
}
