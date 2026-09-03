import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { JobsOptions } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  actionJobs,
  activityLog,
  mailboxAccounts,
  mailMessages,
  senderActionWhere,
  senderPolicies,
  undoJournal,
  workspaces,
} from '@declutrmail/db';
import type { schema, SenderActionReach } from '@declutrmail/db';
import { ActionLabelAppliedPayloadSchema, TOPICS } from '@declutrmail/events';
import { getActionDescriptor } from '@declutrmail/shared/actions';
import type { ActionVerb, LabelChangePair } from '@declutrmail/shared/actions';
import { undoWindowDaysFor } from '@declutrmail/shared/entitlements';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type {
  GmailMutationAccess,
  GmailMutationClient,
  LabelChange,
} from './gmail-mutation-client.js';
import type { OutboxPublisher } from './outbox-publisher.js';
import { backoffJobOptions } from './rate-limit-backoff.js';
import { ValidationError } from './worker-errors.js';
import { WORKER_POLICIES } from './worker-policies.js';
import type { WorkerContext } from './worker-context.js';

/**
 * LabelActionWorker (D226) — the action-consumer for the async
 * destructive-action pipeline. ONE worker for every label-modify verb
 * (archive now; trash later) and BOTH directions (forward + undo).
 *
 * The verb varies only in its `LabelChange`, which the worker reads from
 * the Action Registry (ADR-0015, via `labelChangeForVerb`) — the single
 * source of truth shared with the API + web — so a new label verb is one
 * registry descriptor, not a new worker. The execution plumbing — resolve
 * the durable id set, mutate Gmail, then the terminal transaction (issue
 * undo + activity + outbox event + local label update + job done) — is
 * shared.
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
 * Verbs whose FULL action pipeline is complete end-to-end: the worker
 * forward mutation, the local label mirror, the undo/reverse path, and the
 * `actions.label_action_applied` event schema.
 *
 * Per ADR-0019 + spec v1.2 Decision 1 (2026-06-03), `delete` joined the
 * pipeline alongside `archive` and `later`: the local mirror is now
 * derived generically from `LabelChange` (no per-verb `INBOX` hardcoding),
 * the undo payload union covers `delete`, and the event schema accepts
 * `archive | later | delete`. `unarchive` (restore-pipeline) stays out —
 * it is not in `action_verb` / `undo_action_kind` / `activity_action`.
 *
 * The guard remains because a new label-modify verb may still appear in
 * the registry before its pipeline lands; the fail-closed default is
 * "refuse" until explicitly added here.
 */
const PIPELINE_COMPLETE_VERBS: ReadonlySet<ActionVerb> = new Set<ActionVerb>([
  'archive',
  'later',
  'delete',
]);

/**
 * Gmail SYSTEM label ids — these ARE their own ids and skip name→id
 * resolution (`ensureLabelId` is for user labels like `DeclutrMail/Later`;
 * Gmail rejects creating system labels). Mirrors the exclusion list on
 * the `GmailMutationClient.ensureLabelId` port doc.
 */
const SYSTEM_LABEL_IDS: ReadonlySet<string> = new Set([
  'INBOX',
  'TRASH',
  'UNREAD',
  'SPAM',
  'STARRED',
  'IMPORTANT',
  'SENT',
  'DRAFT',
]);

/**
 * Resolve every NON-system label NAME in a `LabelChange` to its Gmail
 * label id via `ensureLabelId` (creating the label on first use). The
 * registry's `buildLabelChange` emits the canonical symbolic NAME
 * (`DeclutrMail/Later`); Gmail's batchModify accepts only IDS — live
 * smoke 2026-06-09: the unresolved name produced `Gmail returned 400:
 * Invalid label: DeclutrMail/Later`. Called on BOTH the forward and
 * reverse paths, and the RESOLVED change feeds the local label mirror
 * (`buildLabelMirrorExpr`) so `mail_messages.label_ids` stores the same
 * raw Gmail ids that initial/incremental sync stores.
 */
async function resolveLabelChange(
  client: GmailMutationClient,
  change: LabelChange,
): Promise<LabelChange> {
  const resolveAll = (labels: string[]): Promise<string[]> =>
    Promise.all(
      labels.map((label) =>
        SYSTEM_LABEL_IDS.has(label) ? Promise.resolve(label) : client.ensureLabelId(label),
      ),
    );
  return {
    ...(change.addLabelIds ? { addLabelIds: await resolveAll(change.addLabelIds) } : {}),
    ...(change.removeLabelIds ? { removeLabelIds: await resolveAll(change.removeLabelIds) } : {}),
  };
}

/**
 * Resolve a verb's forward/reverse `LabelChange` from the Action Registry
 * (ADR-0015) — the single source of truth that replaces the worker-local
 * `VERB_LABEL_CHANGES` map (P3). Adding a label verb is one registry
 * descriptor, not an edit here.
 *
 * Two fail-closed guards, both reached before any mutation (this is the
 * shared chokepoint for forward + reverse, called in `execute()`):
 *   1. Pipeline isolation (consensus §5): a `policy-only` verb
 *      (keep/protect) must NEVER reach the label worker. `buildLabelChange`
 *      exists only on the `label-modify` arm, so a mis-routed verb throws a
 *      non-retryable `ValidationError`.
 *   2. Pipeline completeness (F1): a `label-modify` verb whose downstream
 *      pipeline is not finished (see `PIPELINE_COMPLETE_VERBS`) is rejected
 *      even though its `LabelChange` resolves — `later` is the live case.
 */
export function labelChangeForVerb(verb: ActionVerb): LabelChangePair {
  const { execution } = getActionDescriptor(verb);
  if (execution.kind !== 'label-modify') {
    throw new ValidationError(
      `verb "${verb}" routes to ${execution.kind}; LabelActionWorker applies label-modify verbs only`,
    );
  }
  if (!PIPELINE_COMPLETE_VERBS.has(verb)) {
    throw new ValidationError(
      `verb "${verb}" is label-modify but its action pipeline (local mirror + undo + event schema) is archive-only at this build; refusing to mutate Gmail until it lands`,
    );
  }
  return execution.buildLabelChange({});
}

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

/** Shared advisory-lock namespace for every mailbox mail mutation/schedule write. */
export const MAILBOX_ACTION_LOCK_NS = 0x4c41; // 'LA'

type WorkerDb = PostgresJsDatabase<typeof schema>;

export interface LabelActionDeps {
  db: WorkerDb;
  gmailMutation: GmailMutationAccess;
  outbox: OutboxPublisher;
  lock: MailboxActionLock;
}

/**
 * BullMQ options — `jobId` = idempotency key; attempts/backoff from the
 * policy. `batchModify` (below) is a real Gmail call and can throw
 * `RateLimitError` — `backoffJobOptions` + the Worker's
 * `perMailboxWorkerSettings()` (apps/api/src/worker.ts) are the same
 * pairing `initialSyncJobOptions` uses, so a quota-exceeded bulk
 * Archive/Later/Delete gets the same 60s-window-aware retry instead of
 * dead-lettering a visible K/A/U/L/D action (2026-09-02 incident sweep).
 */
export function labelActionJobOptions(idempotencyKey: string): JobsOptions {
  const policy = WORKER_POLICIES.perMailboxPolicy;
  return {
    jobId: idempotencyKey,
    attempts: policy.maxAttempts,
    ...backoffJobOptions(policy.backoff),
    removeOnComplete: { age: 86_400 },
    removeOnFail: false,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

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

    const change = labelChangeForVerb(job.verb);

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
    // This worker only ever processes the label-modify verbs
    // (archive/later/delete — unsubscribe rides UnsubExecutionWorker), so
    // narrow `job.verb` to the ACTION_LABEL_APPLIED schema's enum for the
    // event payload. `labelChangeForVerb` already assumes this.
    const labelVerb = job.verb as 'archive' | 'later' | 'delete';

    if (labelVerb === 'later' && (job.selector.type !== 'sender' || job.wakeAt === null)) {
      throw new ValidationError('Later action requires a sender selector and wake time');
    }

    // Resolve the durable execution set (sender selector resolves the
    // job's reach — "in INBOX now", or inbox + archived for an ADR-0028
    // all-mail Delete; messages selector was frozen by the API). Persist
    // it BEFORE the mutation so a post-mutation retry reuses it.
    //
    // ADR-0020: `older_than_days` narrows the resolution window for the
    // sender selector — `internal_date <= now() - interval 'N days'`.
    // Applied during INITIAL resolution only; once `resolved_message_ids`
    // is persisted, retries reuse it verbatim regardless of the column.
    let ids = job.resolvedMessageIds;
    if (ids.length === 0 && job.selector.type === 'sender') {
      ids = await this.resolveSenderActionIds(
        mailboxAccountId,
        job.selector.senderKey,
        job.olderThanDays,
        job.reach,
      );
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

    // No matching messages — nothing for Gmail to do, no undo token to
    // issue (nothing to reverse), but the user MADE A DECISION and the
    // audit trail must reflect that. Write a 0-affected activity_log
    // row so the user can see "you clicked Delete on DKNY (older than
    // 365d): nothing matched." Same precedent as Keep (also 0-message
    // decisions).
    //
    // 2026-06-05 founder smoke surfaced this: POST 365d-delete on a
    // sender with no aged INBOX rows ⇒ action_jobs done, activity_log
    // silent ⇒ /activity appears broken (it isn't — it's empty by
    // omission, which reads identically to broken).
    if (ids.length === 0) {
      const senderKey = job.selector.type === 'sender' ? job.selector.senderKey : null;
      await db.transaction(async (tx) => {
        await tx
          .update(actionJobs)
          .set({ status: 'done', affectedCount: 0, updatedAt: sql`now()` })
          .where(eq(actionJobs.id, job.id));
        await tx.insert(activityLog).values({
          mailboxAccountId,
          senderKey,
          source: 'manual',
          action: job.verb,
          affectedCount: 0,
          actionJobId: job.id,
          // No undo token — there is nothing to reverse. The Activity
          // row's undoState resolves to `unavailable` client-side.
          undoToken: null,
        });
        // Still emit ACTION_LABEL_APPLIED (undoToken null, affectedCount
        // 0) on this terminal-success branch. Without it, a Screener
        // decision whose mail dropped to 0 between enqueue and execution
        // would never resolve its quarantine row — the sender would be
        // stuck in the queue despite a recorded decision. The Screener
        // consumer keys off (mailbox, senderKey); for a message selector
        // (senderKey null) it no-ops.
        await this.deps.outbox.publish(tx, {
          topic: TOPICS.ACTION_LABEL_APPLIED,
          aggregateId: job.id,
          payload: {
            mailboxAccountId,
            actionId: job.id,
            verb: labelVerb,
            senderKey,
            undoToken: null,
            affectedCount: 0,
            compositeId: job.compositeId,
            wakeAt: null,
            appliedAt: new Date().toISOString(),
          },
          schema: ActionLabelAppliedPayloadSchema,
        });
      });
      return { affectedCount: 0, undoToken: null, alreadyDone: false };
    }

    const client = await this.deps.gmailMutation.getClient(mailboxAccountId);
    // Name→id resolution boundary: Gmail mutates by label ID, the
    // registry speaks label NAMES. Everything downstream (batchModify,
    // the local mirror) uses the RESOLVED change.
    const resolved = await resolveLabelChange(client, change);
    await client.batchModify(ids, resolved);

    const expiresAt = await this.undoExpiresAt(mailboxAccountId);
    const senderKey = job.selector.type === 'sender' ? job.selector.senderKey : null;
    const appliedAt = new Date().toISOString();

    const undoToken = await db.transaction(async (tx) => {
      // ADR-0028: a Delete's undo must restore each message to where it
      // was — so record which ids carried INBOX. Read from the LOCAL
      // mirror, inside this transaction and BEFORE the mirror update
      // below rewrites it: the mirror only changes in this atomic
      // commit, so even a Gmail-mutated-then-crashed retry still sees
      // the pre-action state here. (An incremental sync racing that
      // narrow crash window could overwrite the mirror first — then
      // those messages restore to archive instead of inbox: degraded,
      // never destructive.)
      //
      // MEASURED FOR EVERY DELETE, never gated on `job.reach` (Codex
      // stop-review round 2, 2026-07-28): a job that froze its wide
      // all-mail id set and then crashed before this transaction can be
      // retried AFTER a migration rollback + re-apply reset the column
      // to 'inbox_only' — the retry executes the frozen WIDE set, and a
      // column-gated partition would write a legacy-looking payload
      // whose undo floods the inbox. The partition is ground truth
      // measured from the ids actually being mutated; for an inbox-only
      // delete it simply equals the whole set and the reverse split
      // degenerates to the uniform reverse.
      const inboxMessageIds =
        job.verb === 'delete'
          ? (
              await tx
                .select({ providerMessageId: mailMessages.providerMessageId })
                .from(mailMessages)
                .where(
                  and(
                    eq(mailMessages.mailboxAccountId, mailboxAccountId),
                    inArray(mailMessages.providerMessageId, ids),
                    sql`'INBOX' = ANY(${mailMessages.labelIds})`,
                  ),
                )
            ).map((r) => r.providerMessageId)
          : null;

      const [issued] = await tx
        .insert(undoJournal)
        .values({
          mailboxAccountId,
          actionKind: job.verb,
          payload: buildUndoPayload(job.verb, ids, inboxMessageIds, job.reach),
          // Always explicit — the tier-resolved snapshot (downgrade
          // semantics; see `undoExpiresAt`), never the column default.
          expiresAt,
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
        actionJobId: job.id,
      });

      // Keep the local label mirror in step with Gmail so the UI + the
      // next sender-selector resolve see the post-action label set.
      // Derived from the RESOLVED `change` (ids, not names) so the
      // mirror stores the same raw Gmail label ids sync stores, without
      // per-verb branching: archive removes INBOX; later removes INBOX +
      // adds the resolved Later label id; delete removes INBOX + adds TRASH.
      await tx
        .update(mailMessages)
        .set({
          labelIds: buildLabelMirrorExpr(resolved),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(mailMessages.mailboxAccountId, mailboxAccountId),
            inArray(mailMessages.providerMessageId, ids),
          ),
        );

      // A successful Later mutation and its return timer are one
      // terminal state. Persist them in the same transaction so the
      // Later page and wake sweep cannot lose a Gmail-applied action.
      if (labelVerb === 'later' && job.selector.type === 'sender' && job.wakeAt !== null) {
        const snoozedAt = new Date(appliedAt);
        await tx
          .insert(senderPolicies)
          .values({
            mailboxAccountId,
            senderKey: job.selector.senderKey,
            snoozedUntil: job.wakeAt,
            snoozedAt,
          })
          .onConflictDoUpdate({
            target: [senderPolicies.mailboxAccountId, senderPolicies.senderKey],
            set: {
              snoozedUntil: job.wakeAt,
              snoozedAt,
              snoozedReason: null,
              snoozeWakeLastAttemptAt: null,
              snoozeWakeLastFailedAt: null,
              snoozeWakeFailureCount: 0,
              snoozeWakeFailureKind: null,
              updatedAt: sql`now()`,
            },
          });
      }

      await this.deps.outbox.publish(tx, {
        topic: TOPICS.ACTION_LABEL_APPLIED,
        aggregateId: job.id,
        payload: {
          mailboxAccountId,
          actionId: job.id,
          verb: labelVerb,
          senderKey,
          undoToken: issued.token,
          affectedCount: ids.length,
          compositeId: job.compositeId,
          wakeAt: labelVerb === 'later' ? (job.wakeAt?.toISOString() ?? null) : null,
          appliedAt,
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
    // ADR-0028: an all-mail Delete's undo restores each message to where
    // it WAS — the inbox subset (recorded in the undo-journal payload at
    // forward time) gets the registry reverse (+INBOX, −TRASH); the
    // archived rest gets the reverse WITHOUT the INBOX re-add, so undo
    // never dumps years of archived mail into the inbox. Every other
    // job is one uniform group.
    //
    // The reverse change is rebuilt from the registry, so it carries the
    // same symbolic label NAMES the forward path did — resolve to ids
    // before mutating + mirroring. `ensureLabelId` finds the existing
    // label (the forward path created it), so the revert removes the
    // SAME id the forward path added.
    let groups = await this.reverseChangeGroups(job, change, ids);
    if (ids.length > 0) {
      const client = await this.deps.gmailMutation.getClient(mailboxAccountId);
      groups = await Promise.all(
        groups.map(async (group) => ({
          ids: group.ids,
          change: await resolveLabelChange(client, group.change),
        })),
      );
      for (const group of groups) {
        await client.batchModify(group.ids, group.change);
      }
    }

    await db.transaction(async (tx) => {
      // Idempotency lock: only the first revert flips reverted_at. Re-add
      // INBOX is itself idempotent, so a duplicate runner is harmless.
      await tx
        .update(undoJournal)
        .set({ revertedAt: sql`now()` })
        .where(and(eq(undoJournal.token, token), sql`${undoJournal.revertedAt} IS NULL`));

      // Preserve the reversal as a durable, privacy-safe activity fact.
      // Expired undo journal rows are later hard-deleted and their FKs set
      // NULL; without this copy, behavioral evidence could mistake the old
      // action for a current user preference after pruning.
      await tx
        .update(activityLog)
        .set({ revertedAt: sql`now()` })
        .where(and(eq(activityLog.undoToken, token), sql`${activityLog.revertedAt} IS NULL`));

      if (ids.length > 0) {
        // Derived from each group's RESOLVED reverse `LabelChange` (ids,
        // not names) so undoing any label-modify verb keeps the local
        // mirror correct: archive re-adds INBOX; later re-adds INBOX +
        // drops the resolved Later label id; delete re-adds INBOX +
        // drops TRASH — except the all-mail archived group, which only
        // drops TRASH (ADR-0028). The `CASE WHEN` branch in
        // `buildLabelMirrorExpr` makes re-adding idempotent so a
        // duplicate revert is a no-op on the mirror (matching Gmail).
        for (const group of groups) {
          await tx
            .update(mailMessages)
            .set({
              labelIds: buildLabelMirrorExpr(group.change),
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(mailMessages.mailboxAccountId, mailboxAccountId),
                inArray(mailMessages.providerMessageId, group.ids),
              ),
            );
        }
      }

      // Undoing a Later action cancels only THAT action's projected
      // schedule. If the user has since picked a newer wake time, the
      // timestamp guard preserves it instead of an old Undo clearing it.
      if (job.verb === 'later' && job.selector.type === 'sender' && job.wakeAt !== null) {
        await tx
          .update(senderPolicies)
          .set({
            snoozedUntil: null,
            snoozedAt: null,
            snoozedReason: null,
            snoozeWakeLastAttemptAt: null,
            snoozeWakeLastFailedAt: null,
            snoozeWakeFailureCount: 0,
            snoozeWakeFailureKind: null,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(senderPolicies.mailboxAccountId, mailboxAccountId),
              eq(senderPolicies.senderKey, job.selector.senderKey),
              eq(senderPolicies.snoozedUntil, job.wakeAt),
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

  /**
   * Sender selector → the `provider_message_id`s at the job's reach
   * (ADR-0028: `inbox_only` = currently carrying INBOX; `all_mail` =
   * inbox + archived minus TRASH/SPAM/DRAFT/CHAT), optionally narrowed
   * to messages older than `olderThanDays` (ADR-0020 time-window
   * filter). When `olderThanDays` is null the full set is returned
   * (spec v1.2 "All inbox" preset).
   */
  private async resolveSenderActionIds(
    mailboxAccountId: string,
    senderKey: string,
    olderThanDays: number | null,
    reach: SenderActionReach,
  ): Promise<string[]> {
    // ONE shared predicate with the API's preview + enqueue counting
    // (`senderActionWhere`, @declutrmail/db) — the resolved set IS
    // the set the FE chip row previewed, including the inbound-only
    // rule that keeps self-sent SENT+INBOX mail untouched.
    const rows = await this.deps.db
      .select({ providerMessageId: mailMessages.providerMessageId })
      .from(mailMessages)
      .where(
        senderActionWhere({ mailboxAccountId, senderKeys: [senderKey], olderThanDays, reach }),
      );
    return rows.map((r) => r.providerMessageId);
  }

  /**
   * Partition a reverse job's ids into per-`LabelChange` groups
   * (ADR-0028). An all-mail Delete splits: the forward path stored
   * which ids carried INBOX in the undo-journal payload, so the revert
   * re-inboxes exactly those and returns the rest to the archive
   * (registry reverse minus its `addLabelIds`).
   *
   * THE PAYLOAD GOVERNS, NEVER THE `reach` COLUMN (Codex stop-review
   * 2026-07-28). The column is mutable state a migration rollback +
   * re-apply resets to the `inbox_only` default on EVERY row — keying
   * the split on it would hand a historical all-mail delete the uniform
   * `+INBOX` reverse and flood the inbox with years of archived mail.
   * The journal payload is written once at forward time, survives the
   * column, and self-describes (`reach: 'all_mail'` + `inboxMessageIds`).
   *
   * Decision table for a Delete reverse:
   *   - payload has `inboxMessageIds` → split (authoritative).
   *   - payload or row says all_mail but the split is unreadable
   *     (damaged/pruned payload) → strip the INBOX re-add and restore
   *     EVERYTHING to the archive: degraded (inbox mail resurfaces
   *     archived, findable via search) but never the inbox-flood.
   *   - neither → uniform registry reverse (a legacy inbox-only
   *     payload, where `+INBOX` for all ids is exactly correct).
   */
  private async reverseChangeGroups(
    job: typeof actionJobs.$inferSelect,
    reverseChange: LabelChange,
    ids: string[],
  ): Promise<Array<{ ids: string[]; change: LabelChange }>> {
    const uniform = [{ ids, change: reverseChange }];
    if (job.verb !== 'delete' || ids.length === 0 || !job.undoToken) {
      return uniform;
    }
    const [journal] = await this.deps.db
      .select({ payload: undoJournal.payload })
      .from(undoJournal)
      .where(eq(undoJournal.token, job.undoToken))
      .limit(1);
    const payload = journal?.payload;
    const inboxMessageIds = readInboxMessageIds(payload);
    const archiveChange: LabelChange = reverseChange.removeLabelIds
      ? { removeLabelIds: reverseChange.removeLabelIds }
      : {};
    if (inboxMessageIds === null) {
      // No readable split. If ANY surviving signal says this was an
      // all-mail delete, fail toward the archive — never the flood.
      const wasAllMail = readPayloadReach(payload) === 'all_mail' || job.reach === 'all_mail';
      return wasAllMail ? [{ ids, change: archiveChange }] : uniform;
    }
    const inboxSet = new Set(inboxMessageIds);
    const toInbox = ids.filter((id) => inboxSet.has(id));
    const toArchive = ids.filter((id) => !inboxSet.has(id));
    return [
      { ids: toInbox, change: reverseChange },
      { ids: toArchive, change: archiveChange },
    ].filter((group) => group.ids.length > 0);
  }

  /**
   * Activity Undo window per tier (D19/D81/D245).
   *
   * Every reversible DeclutrMail action resolves through the SINGLE
   * tier source (`undoWindowDaysFor`). Delete's separate Gmail Trash
   * recovery period is provider behavior, not a longer Activity Undo.
   *
   * DOWNGRADE SEMANTICS: the window is resolved AT ACTION TIME and
   * snapshotted onto `undo_journal.expires_at` (the insert always sets
   * it explicitly). A later tier change never shortens or extends an
   * already-issued token — the expiry sweep (`UndoExpiryWorker`) reads
   * only the stored `expires_at`.
   */
  private async undoExpiresAt(mailboxAccountId: string): Promise<Date> {
    const [row] = await this.deps.db
      .select({ tier: workspaces.tier })
      .from(mailboxAccounts)
      .innerJoin(workspaces, eq(workspaces.id, mailboxAccounts.workspaceId))
      .where(eq(mailboxAccounts.id, mailboxAccountId))
      .limit(1);
    // `workspace_tier` pg-enum values ARE TierIds — resolve via the
    // manifest. A missing row degrades to the Free window (7d).
    return new Date(Date.now() + undoWindowDaysFor(row?.tier ?? 'free') * DAY_MS);
  }
}

/**
 * Build the local-mirror `labelIds` UPDATE expression from a
 * `LabelChange`. Used by both forward and reverse paths so adding a
 * label-modify verb is one descriptor edit, not a worker fork.
 *
 * Algorithm:
 *   1. Chain `array_remove(prev, label)` for every label in
 *      `removeLabelIds` — idempotent if the label is absent.
 *   2. For every label in `addLabelIds`, wrap with a `CASE WHEN
 *      label = ANY(prev) THEN prev ELSE array_append(prev, label) END` —
 *      idempotent if the label is already present (no duplicates).
 *
 * Each label is bound as a scalar parameter — never interpolated as
 * string text — so this is safe against label names that contain
 * apostrophes or other SQL-meaningful characters.
 */
function buildLabelMirrorExpr(change: { addLabelIds?: string[]; removeLabelIds?: string[] }): SQL {
  let expr: SQL = sql`${mailMessages.labelIds}`;
  for (const label of change.removeLabelIds ?? []) {
    expr = sql`array_remove(${expr}, ${label})`;
  }
  for (const label of change.addLabelIds ?? []) {
    expr = sql`(CASE WHEN ${label} = ANY(${expr}) THEN ${expr} ELSE array_append(${expr}, ${label}) END)`;
  }
  return expr;
}

/**
 * Build the `undo_journal.payload` for a label-modify forward action.
 * Each verb's reverse is `LabelChange.reverse` applied to the same
 * message ids — `priorLabels` is vestigial archive metadata kept only
 * on the `archive` + `later` variants for backwards compatibility; the
 * worker never reads it back. `delete` omits it entirely.
 *
 * `inboxMessageIds` (ADR-0028, all-mail Delete only): the subset that
 * carried INBOX at forward time. `reverseChangeGroups` reads it back so
 * undo restores each message to where it was.
 */
function buildUndoPayload(
  verb: ActionVerb,
  messageIds: string[],
  inboxMessageIds: string[] | null = null,
  reach: SenderActionReach = 'inbox_only',
) {
  if (verb === 'delete') {
    return {
      kind: 'delete' as const,
      // The partition is measured for EVERY delete and is the
      // authoritative undo input — `reverseChangeGroups` splits on it
      // regardless of any column state. The `reach` marker is a
      // best-effort second signal for payloads whose partition is later
      // damaged; it reflects the row at journal time, so a
      // column-corrupted retry may omit it while still carrying the
      // (sufficient) measured partition (Codex stop-review 2026-07-28).
      messageIds,
      ...(inboxMessageIds !== null ? { inboxMessageIds } : {}),
      ...(reach === 'all_mail' ? { reach: 'all_mail' as const } : {}),
    };
  }
  return { kind: verb, messageIds, priorLabels: ['INBOX'] as string[] };
}

/**
 * Defensive read of `payload.inboxMessageIds` from an undo-journal
 * jsonb value. `null` = the split is unavailable (legacy inbox-only
 * payload, pruned journal row, malformed data) — the caller then
 * decides between the uniform reverse and the archive-only degrade
 * using `readPayloadReach` + the row (see `reverseChangeGroups`).
 */
function readInboxMessageIds(payload: unknown): string[] | null {
  if (payload === null || payload === undefined || typeof payload !== 'object') return null;
  const value = (payload as Record<string, unknown>).inboxMessageIds;
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/** Defensive read of the self-describing `payload.reach` (ADR-0028). */
function readPayloadReach(payload: unknown): SenderActionReach | null {
  if (payload === null || payload === undefined || typeof payload !== 'object') return null;
  const value = (payload as Record<string, unknown>).reach;
  return value === 'all_mail' || value === 'inbox_only' ? value : null;
}
