import { and, eq, inArray, sql } from 'drizzle-orm';
import type { JobsOptions } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  actionJobs,
  activityLog,
  mailboxAccounts,
  mailMessages,
  undoJournal,
  workspaces,
} from '@declutrmail/db';
import type { schema } from '@declutrmail/db';
import { ActionLabelAppliedPayloadSchema, TOPICS } from '@declutrmail/events';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { GmailMutationAccess, LabelChange } from './gmail-mutation-client.js';
import type { OutboxPublisher } from './outbox-publisher.js';
import { ValidationError } from './worker-errors.js';
import { WORKER_POLICIES } from './worker-policies.js';
import type { WorkerContext } from './worker-context.js';

/**
 * LabelActionWorker (D226) — the action-consumer for the async
 * destructive-action pipeline. ONE worker for every label-modify verb
 * (archive now; trash later) and BOTH directions (forward + undo).
 *
 * The verb varies only in its `LabelChange` (see `VERB_LABEL_CHANGES`),
 * so a new verb is one map entry, not a new worker. The execution
 * plumbing — resolve the durable id set, mutate Gmail, then the terminal
 * transaction (issue undo + activity + outbox event + local label update
 * + job done) — is shared.
 *
 * Correctness invariants (Codex review 2026-05-28):
 *   - DURABLE EXECUTION SET. The `provider_message_id`s are resolved
 *     once and persisted to `action_jobs.resolved_message_ids` BEFORE
 *     the Gmail mutation. A retry after a post-mutation crash reuses the
 *     persisted set rather than re-resolving "currently in INBOX" (which
 *     a successful archive would have emptied — leaving the work with no
 *     undo token).
 *   - IDEMPOTENT MUTATION. Removing INBOX from a message that already
 *     lacks it (and re-adding it on undo where present) are Gmail no-ops,
 *     so a BullMQ retry of an already-applied batch is safe.
 *   - PER-MAILBOX SERIALIZATION. `perMailboxPolicy` is a label, not real
 *     serialization (BullMQ runs `concurrency` jobs across mailboxes).
 *     Destructive mutations don't bet on benign races, so the core runs
 *     inside `deps.lock.run(mailboxAccountId, …)` — an advisory lock keyed
 *     by mailbox in production; a pass-through in single-connection tests.
 *   - UNDO AS A REVERSE JOB. Undo is a `direction='reverse'` action job
 *     that re-applies `change.reverse`; its idempotency is the
 *     `undo_journal.reverted_at IS NULL` guard.
 */

/** Queue + job name for the label-action pipeline (forward + reverse). */
export const LABEL_ACTION_QUEUE = 'label-action';
export const LABEL_ACTION_JOB = 'label-action';

/**
 * Forward + reverse `LabelChange` per verb. Archive = drop INBOX;
 * its inverse re-adds INBOX. Trash (future) = add TRASH / remove INBOX,
 * inverse remove TRASH / add INBOX — one new entry, no new worker.
 */
export const VERB_LABEL_CHANGES = {
  archive: {
    forward: { removeLabelIds: ['INBOX'] },
    reverse: { addLabelIds: ['INBOX'] },
  },
} as const satisfies Record<string, { forward: LabelChange; reverse: LabelChange }>;

/** A verb the pipeline knows how to apply. */
export type LabelActionVerb = keyof typeof VERB_LABEL_CHANGES;

/**
 * One label-action job. Minimal — the worker loads the durable
 * `action_jobs` row by `actionId` for verb/direction/selector/ids.
 * `mailboxAccountId` is included so `BaseDeclutrWorker` can stamp the
 * lifecycle log + the advisory lock can key on it.
 */
export interface LabelActionJobData {
  actionId: string;
  mailboxAccountId: string;
  idempotencyKey: string;
}

/** Metric-only result (logged on `worker.succeeded`). */
export interface LabelActionResult {
  affectedCount: number;
  undoToken: string | null;
  alreadyDone: boolean;
}

/**
 * Per-mailbox mutual exclusion for destructive actions. Production wires
 * a Postgres advisory lock (pinned connection); tests pass a pass-through
 * (PGlite is single-connection — no concurrency to guard).
 */
export interface MailboxActionLock {
  run<T>(mailboxAccountId: string, fn: () => Promise<T>): Promise<T>;
}

/** A pass-through lock — for tests + single-connection environments. */
export const PASSTHROUGH_MAILBOX_LOCK: MailboxActionLock = {
  run: (_mailboxAccountId, fn) => fn(),
};

type WorkerDb = PostgresJsDatabase<typeof schema>;

export interface LabelActionDeps {
  db: WorkerDb;
  gmailMutation: GmailMutationAccess;
  outbox: OutboxPublisher;
  lock: MailboxActionLock;
}

/** BullMQ options — `jobId` = idempotency key; attempts/backoff from the policy. */
export function labelActionJobOptions(idempotencyKey: string): JobsOptions {
  const policy = WORKER_POLICIES.perMailboxPolicy;
  return {
    jobId: idempotencyKey,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 86_400 },
    removeOnFail: false,
  };
}

const PRO_UNDO_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export class LabelActionWorker extends BaseDeclutrWorker<LabelActionJobData, LabelActionResult> {
  readonly workerName = 'LabelActionWorker';
  readonly policy = 'perMailboxPolicy' as const;

  constructor(private readonly deps: LabelActionDeps) {
    super();
  }

  protected override getIdempotencyKey(payload: LabelActionJobData): string {
    return payload.idempotencyKey;
  }

  async processJob(payload: LabelActionJobData, _ctx: WorkerContext): Promise<LabelActionResult> {
    return this.deps.lock.run(payload.mailboxAccountId, () => this.execute(payload));
  }

  private async execute(payload: LabelActionJobData): Promise<LabelActionResult> {
    const { db } = this.deps;

    const [job] = await db
      .select()
      .from(actionJobs)
      .where(eq(actionJobs.id, payload.actionId))
      .limit(1);
    if (!job) {
      // The row is written before enqueue; its absence is a malformed
      // job that a retry cannot fix.
      throw new ValidationError(`action_jobs row ${payload.actionId} not found`);
    }
    if (job.status === 'done') {
      // Idempotent replay (BullMQ retry after a committed terminal tx).
      return { affectedCount: job.affectedCount, undoToken: job.undoToken, alreadyDone: true };
    }

    const change = VERB_LABEL_CHANGES[job.verb as LabelActionVerb];
    if (!change) {
      throw new ValidationError(`unknown action verb ${job.verb}`);
    }

    return job.direction === 'reverse'
      ? this.executeReverse(job, change.reverse)
      : this.executeForward(job, change.forward);
  }

  /** Forward action — apply the verb, then issue undo + activity + event. */
  private async executeForward(
    job: typeof actionJobs.$inferSelect,
    change: LabelChange,
  ): Promise<LabelActionResult> {
    const { db } = this.deps;
    const mailboxAccountId = job.mailboxAccountId;

    // Resolve the durable execution set (sender selector resolves "in
    // INBOX now"; messages selector was frozen by the API). Persist it
    // BEFORE the mutation so a post-mutation retry reuses it.
    let ids = job.resolvedMessageIds;
    if (ids.length === 0 && job.selector.type === 'sender') {
      ids = await this.resolveSenderInboxIds(mailboxAccountId, job.selector.senderKey);
      await db
        .update(actionJobs)
        .set({ resolvedMessageIds: ids, status: 'executing', updatedAt: sql`now()` })
        .where(eq(actionJobs.id, job.id));
    } else {
      await db
        .update(actionJobs)
        .set({ status: 'executing', updatedAt: sql`now()` })
        .where(eq(actionJobs.id, job.id));
    }

    // Nothing to do — no undo token / activity row for a no-op action.
    if (ids.length === 0) {
      await db
        .update(actionJobs)
        .set({ status: 'done', affectedCount: 0, updatedAt: sql`now()` })
        .where(eq(actionJobs.id, job.id));
      return { affectedCount: 0, undoToken: null, alreadyDone: false };
    }

    const client = await this.deps.gmailMutation.getClient(mailboxAccountId);
    await client.batchModify(ids, change);

    const expiresAt = await this.undoExpiresAt(mailboxAccountId);
    const senderKey = job.selector.type === 'sender' ? job.selector.senderKey : null;

    const undoToken = await db.transaction(async (tx) => {
      const [issued] = await tx
        .insert(undoJournal)
        .values({
          mailboxAccountId,
          actionKind: job.verb,
          payload: { kind: job.verb, messageIds: ids, priorLabels: ['INBOX'] },
          ...(expiresAt ? { expiresAt } : {}),
        })
        .returning({ token: undoJournal.token });
      if (!issued) {
        throw new Error('undo_journal insert returned no row');
      }

      await tx.insert(activityLog).values({
        mailboxAccountId,
        senderKey,
        source: 'manual',
        action: job.verb,
        affectedCount: ids.length,
        undoToken: issued.token,
      });

      // Keep the local label mirror in step with Gmail so the UI + the
      // next sender-selector resolve don't see stale INBOX membership.
      await tx
        .update(mailMessages)
        .set({
          labelIds: sql`array_remove(${mailMessages.labelIds}, 'INBOX')`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(mailMessages.mailboxAccountId, mailboxAccountId),
            inArray(mailMessages.providerMessageId, ids),
          ),
        );

      await this.deps.outbox.publish(tx, {
        topic: TOPICS.ACTION_LABEL_APPLIED,
        aggregateId: job.id,
        payload: {
          mailboxAccountId,
          actionId: job.id,
          verb: job.verb,
          senderKey,
          undoToken: issued.token,
          affectedCount: ids.length,
        },
        schema: ActionLabelAppliedPayloadSchema,
      });

      await tx
        .update(actionJobs)
        .set({
          status: 'done',
          affectedCount: ids.length,
          undoToken: issued.token,
          updatedAt: sql`now()`,
        })
        .where(eq(actionJobs.id, job.id));

      return issued.token;
    });

    return { affectedCount: ids.length, undoToken, alreadyDone: false };
  }

  /** Reverse action (undo) — re-apply the inverse, then record revert success. */
  private async executeReverse(
    job: typeof actionJobs.$inferSelect,
    change: LabelChange,
  ): Promise<LabelActionResult> {
    const { db } = this.deps;
    const mailboxAccountId = job.mailboxAccountId;
    const token = job.undoToken;
    if (!token) {
      throw new ValidationError(`reverse action ${job.id} has no undo_token to revert`);
    }

    await db
      .update(actionJobs)
      .set({ status: 'executing', updatedAt: sql`now()` })
      .where(eq(actionJobs.id, job.id));

    const ids = job.resolvedMessageIds;
    if (ids.length > 0) {
      const client = await this.deps.gmailMutation.getClient(mailboxAccountId);
      await client.batchModify(ids, change);
    }

    await db.transaction(async (tx) => {
      // Idempotency lock: only the first revert flips reverted_at. Re-add
      // INBOX is itself idempotent, so a duplicate runner is harmless.
      await tx
        .update(undoJournal)
        .set({ revertedAt: sql`now()` })
        .where(and(eq(undoJournal.token, token), sql`${undoJournal.revertedAt} IS NULL`));

      if (ids.length > 0) {
        await tx
          .update(mailMessages)
          .set({
            labelIds: sql`array_append(${mailMessages.labelIds}, 'INBOX')`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(mailMessages.mailboxAccountId, mailboxAccountId),
              inArray(mailMessages.providerMessageId, ids),
              sql`NOT ('INBOX' = ANY(${mailMessages.labelIds}))`,
            ),
          );
      }

      await tx
        .update(actionJobs)
        .set({ status: 'done', affectedCount: ids.length, updatedAt: sql`now()` })
        .where(eq(actionJobs.id, job.id));
    });

    return { affectedCount: ids.length, undoToken: token, alreadyDone: false };
  }

  protected override async onTerminalFailure(
    payload: LabelActionJobData,
    error: Error,
  ): Promise<void> {
    try {
      await this.deps.db
        .update(actionJobs)
        .set({ status: 'failed', errorCode: error.name, updatedAt: sql`now()` })
        .where(eq(actionJobs.id, payload.actionId));
    } catch (recordErr) {
      // Recording the failure must never mask the original error.
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'label_action.failed_status_write_failed',
          actionId: payload.actionId,
          message: recordErr instanceof Error ? recordErr.message : String(recordErr),
        }),
      );
    }
  }

  /** Sender selector → the `provider_message_id`s currently in INBOX. */
  private async resolveSenderInboxIds(
    mailboxAccountId: string,
    senderKey: string,
  ): Promise<string[]> {
    const rows = await this.deps.db
      .select({ providerMessageId: mailMessages.providerMessageId })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.mailboxAccountId, mailboxAccountId),
          eq(mailMessages.senderKey, senderKey),
          sql`'INBOX' = ANY(${mailMessages.labelIds})`,
        ),
      );
    return rows.map((r) => r.providerMessageId);
  }

  /**
   * D81 undo window: Pro (and higher) get 30 days; Free/Plus use the
   * `undo_journal` 7-day column default (return `undefined` → omit).
   */
  private async undoExpiresAt(mailboxAccountId: string): Promise<Date | undefined> {
    const [row] = await this.deps.db
      .select({ tier: workspaces.tier })
      .from(mailboxAccounts)
      .innerJoin(workspaces, eq(workspaces.id, mailboxAccounts.workspaceId))
      .where(eq(mailboxAccounts.id, mailboxAccountId))
      .limit(1);
    const tier = row?.tier;
    if (tier === 'pro' || tier === 'team' || tier === 'enterprise') {
      return new Date(Date.now() + PRO_UNDO_WINDOW_MS);
    }
    return undefined;
  }
}
