import { and, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Queue } from 'bullmq';

import {
  accountDeletionRequests,
  actionJobs,
  activityLog,
  automationRules,
  briefRuns,
  cronRuns,
  deadLetterJobs,
  followupTracker,
  mailboxAccounts,
  mailboxDataDeletionRequests,
  mailMessages,
  outboxEvents,
  providerSyncState,
  ruleMatchLog,
  screenerQuarantine,
  securityEvents,
  senderPolicies,
  senderTimeseries,
  senders,
  triageDecisions,
  undoJournal,
  users,
  webhookDedup,
  workspaces,
} from '@declutrmail/db';
import type { schema } from '@declutrmail/db';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { enqueueEmailSend } from './email-send.queue.js';
import type { EmailSendJobData } from './email-send.worker.js';
import { PASSTHROUGH_MAILBOX_LOCK, type MailboxActionLock } from './label-action.worker.js';
import { TransientError } from './worker-errors.js';
import type { GmailWatchAccess } from './ports.js';
import type { WorkerContext } from './worker-context.js';
import type { WorkerObserver } from './worker-observer.js';

/** The Drizzle client, bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * Periodic sweep payload — same shape as the other cron workers
 * (`scheduledAtMinute` is the BullMQ jobId component AND the
 * `cron_runs.run_key` suffix per D225).
 */
export interface DeletionSweepJobData {
  scheduledAtMinute: string;
}

/** Metric-only sweep result (logged on `worker.succeeded`). */
export interface DeletionSweepResult {
  /**
   * `swept` — claimed the `cron_runs` slot and ran.
   * `duplicate_run_key` — another run already SUCCEEDED for this
   * run-key (double-fired tick / second replica); clean no-op.
   */
  outcome: 'swept' | 'duplicate_run_key';
  /** Requests due this sweep (pending past effective_at + stranded executing). */
  due: number;
  /** Requests fully purged this sweep. */
  purged: number;
  /** Requests that failed mid-purge — retried by the next sweep. */
  failed: number;
  /** Total wall-clock ms. */
  durationMs: number;
}

export interface DeletionPurgeDeps {
  db: WorkerDb;
  /** Per-mailbox token-bound watch client resolver (composition root). */
  gmailWatch: GmailWatchAccess;
  /**
   * Full Pub/Sub topic resource (env `GMAIL_PUBSUB_TOPIC`), or null
   * when the watch pipeline is off (local dev) — null skips the
   * `users.stop` calls entirely, mirroring `GmailWatchService`.
   */
  topicName: string | null;
  /**
   * Email-send queue producer for the deletion receipt. Null only in
   * tests / queue-less harnesses — the composition root always passes
   * one; a null queue logs loudly and skips (the purge itself MUST
   * proceed: data deletion cannot be held hostage by Redis).
   */
  emailQueue: Queue<EmailSendJobData> | null;
  /**
   * Renders the D232 deletion-receipt email. Injected as a port
   * because the typed templates live in apps/api (notifications
   * module) and the dependency direction is apps/api → packages/workers,
   * never the reverse. The composition root passes
   * `deletionReceiptEmail` from `email-templates.ts`.
   */
  renderReceiptEmail: (input: { deletedAt: string }) => { subject: string; text: string };
  /**
   * Shared destructive-action mutex. Optional keeps existing composition
   * roots source-compatible; production should pass the label-action
   * advisory lock so an in-flight Gmail action cannot race the final
   * indexed-data scrub.
   */
  mailboxLock?: MailboxActionLock;
  /** D159 seam for per-request failures (sweep records-and-continues). */
  observer?: WorkerObserver;
}

/** One due request as the sweep reads it. */
interface DueRequest {
  id: string;
  userId: string;
  basis: 'flat-grace' | 'undo-window' | 'waived-immediate';
  requestedAt: Date;
  effectiveAt: Date;
}

/** One retryable mailbox-index deletion request. */
interface DueMailboxRequest {
  id: string;
  mailboxAccountId: string;
}

/**
 * Every table with a direct mailbox_accounts FK that the mailbox purge
 * erases. The request table is deliberately absent because it is the
 * durable receipt/status record. An integration test compares this
 * registry with pg_constraint so a new mailbox-scoped table cannot be
 * added without an explicit purge decision.
 */
export const MAILBOX_PURGE_DIRECT_CHILD_TABLES = [
  'action_jobs',
  'activity_log',
  'automation_rules',
  'brief_runs',
  'followup_tracker',
  'mail_messages',
  'provider_sync_state',
  'rule_match_log',
  'screener_quarantine',
  'sender_policies',
  'sender_timeseries',
  'senders',
  'triage_decisions',
  'undo_journal',
  'webhook_dedup',
] as const;

/** Chunk size for the mail_messages bulk delete (the big table). */
const MAIL_MESSAGES_DELETE_CHUNK = 5_000;

/**
 * An 'executing' row older than this is a STRANDED purge (the worker
 * crashed mid-run) — the sweep takes it over. Generous vs. the 60s
 * cronPolicy job timeout so a live run is never double-claimed.
 */
const EXECUTING_TAKEOVER_AFTER_MS = 10 * 60 * 1_000;

/** Single source for the stranded-takeover cutoff (due-scan AND claim). */
function executingTakeoverCutoff(): Date {
  return new Date(Date.now() - EXECUTING_TAKEOVER_AFTER_MS);
}

/** Persist/log a bounded classification, never arbitrary error text. */
function controlledErrorCode(error: unknown): string {
  const candidate = error instanceof Error ? error.name : '';
  return /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(candidate) ? candidate : 'Error';
}

/**
 * AccountDeletionPurgeWorker (D205, D216, D232) — executes due
 * account-deletion requests.
 *
 * Policy: `cronPolicy` (D225). The scheduler ticks every
 * `DELETION_SWEEP_INTERVAL_MS`; each tick sweeps every due request:
 * `status='pending' AND effective_at <= now()`, plus stranded
 * 'executing' rows (crash recovery — see EXECUTING_TAKEOVER_AFTER_MS).
 *
 * Purge order per request (each step idempotent, so a crash anywhere
 * resumes cleanly on the next sweep):
 *
 *   1. Claim — flip to 'executing' (+executed_at). Conditional UPDATE:
 *      accepts only 'pending' or stranded-'executing' past the takeover
 *      cutoff, so a replica that loses the claim race gets no row back.
 *   2. Capture — user email/workspace + mailbox ids (needed AFTER the
 *      drop; nothing below can re-read them).
 *   3. `users.stop` on every mailbox — best-effort per-mailbox
 *      isolation (GmailWatchService semantics, worker-side via the
 *      `GmailWatchAccess` port). A failed stop never blocks a purge.
 *   4. Enqueue the deletion-receipt email BEFORE the data drop — the
 *      job carries `recipientOverride` (the captured address) because
 *      the users row will be gone at send time. Idempotent on the
 *      request id. Enqueue-before-drop also guarantees the receipt
 *      survives a crash *after* the drop (the request row cascades
 *      away with the user, so a post-drop enqueue would never resume).
 *   5. Audit — `security_events` row ('account.deletion_executed').
 *      FKs are ON DELETE SET NULL, so the row SURVIVES the drop; the
 *      payload carries the ids for the compliance trail. Deduped on
 *      payload requestId for resume.
 *   6. Drop, FK-safe + chunked:
 *        a. `mail_messages` in chunks (the 50k–250k-row table — a
 *           single cascade DELETE could blow the job timeout; chunks
 *           make progress every run, which IS the resumability).
 *        b. `mailbox_accounts` (cascades the small mailbox-scoped
 *           children: senders, policies, undo_journal, triage,
 *           activity, action_jobs, rules, sync state, …).
 *        c. The workspace when this user is its only member (cascades
 *           users → active_sessions → THIS REQUEST ROW), else just the
 *           user row. The request row vanishing is deliberate (schema
 *           doc: deletion means deletion; the trail is step 5).
 *
 * Because the request row cascades away on success, the 'completed'
 * enum value never persists — it exists for a future soft-completion
 * mode. The durable completion evidence is the security_events row +
 * the worker.succeeded log line.
 *
 * FAILURE ISOLATION: one failed purge is recorded (log + observer) and
 * the sweep continues; the JOB only fails when every due request
 * failed (systemic fault → cronPolicy retries).
 *
 * Privacy (D7/D228): logs and results carry ids + counts only. The
 * captured email address goes ONLY into the email job payload.
 */
export class AccountDeletionPurgeWorker extends BaseDeclutrWorker<
  DeletionSweepJobData,
  DeletionSweepResult
> {
  override readonly workerName = 'AccountDeletionPurgeWorker';
  override readonly policy = 'cronPolicy' as const;

  constructor(private readonly deps: DeletionPurgeDeps) {
    super();
  }

  /** D225 cron idempotency key — `(worker_name, scheduled_at_minute)`. */
  protected override getIdempotencyKey(payload: DeletionSweepJobData): string {
    return `${this.workerName}:${payload.scheduledAtMinute}`;
  }

  override async processJob(
    payload: DeletionSweepJobData,
    _ctx: WorkerContext,
  ): Promise<DeletionSweepResult> {
    const startedAt = Date.now();
    const runKey = `${this.workerName}:${payload.scheduledAtMinute}`;

    // D225 durable claim — same contract as WatchRenewalWorker.
    const claimed = await this.deps.db
      .insert(cronRuns)
      .values({ workerName: this.workerName, runKey, status: 'running' })
      .onConflictDoUpdate({
        target: cronRuns.runKey,
        set: { status: 'running', startedAt: sql`now()`, finishedAt: null },
        setWhere: sql`${cronRuns.status} <> 'succeeded'`,
      })
      .returning({ id: cronRuns.id });

    if (claimed.length === 0) {
      return {
        outcome: 'duplicate_run_key',
        due: 0,
        purged: 0,
        failed: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    const due = await this.findDueRequests();

    let purged = 0;
    let failed = 0;
    for (const request of due) {
      try {
        await this.purgeOne(request);
        purged += 1;
      } catch (err) {
        failed += 1;
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'account_deletion.purge_failed',
            requestId: request.id,
            userId: request.userId,
            error: error.name,
            message: error.message,
          }),
        );
        this.deps.observer?.captureBackgroundFailure(error, {
          kind: 'account_deletion.purge_failed',
          tags: { requestId: request.id, worker: this.workerName },
        });
      }
    }

    // Account purges run first. They may cascade-delete mailbox requests;
    // querying only now avoids attempting a stale mailbox request whose
    // user/account was removed earlier in this same sweep.
    const mailboxDue = await this.findDueMailboxRequests();
    for (const request of mailboxDue) {
      try {
        const didPurge = await this.purgeMailboxRequest(request);
        if (didPurge) purged += 1;
      } catch (err) {
        failed += 1;
        const error = err instanceof Error ? err : new Error(String(err));
        await this.markMailboxRequestFailed(request, error);
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'mailbox_data_deletion.purge_failed',
            requestId: request.id,
            mailboxAccountId: request.mailboxAccountId,
            error: error.name,
          }),
        );
        this.deps.observer?.captureBackgroundFailure(error, {
          kind: 'mailbox_data_deletion.purge_failed',
          tags: { requestId: request.id, worker: this.workerName },
        });
      }
    }

    const totalDue = due.length + mailboxDue.length;
    const allFailed = totalDue > 0 && purged === 0 && failed > 0;
    await this.deps.db
      .update(cronRuns)
      .set({ status: allFailed ? 'failed' : 'succeeded', finishedAt: sql`now()` })
      .where(eq(cronRuns.runKey, runKey));

    if (allFailed) {
      throw new TransientError(
        `AccountDeletionPurgeWorker: all ${totalDue} due deletion requests failed to purge`,
      );
    }

    return {
      outcome: 'swept',
      due: totalDue,
      purged,
      failed,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Due = pending past effective_at (the partial due-scan index path)
   * OR executing-and-stranded (crash takeover).
   */
  private async findDueRequests(): Promise<DueRequest[]> {
    const takeoverCutoff = executingTakeoverCutoff();
    return this.deps.db
      .select({
        id: accountDeletionRequests.id,
        userId: accountDeletionRequests.userId,
        basis: accountDeletionRequests.basis,
        requestedAt: accountDeletionRequests.requestedAt,
        effectiveAt: accountDeletionRequests.effectiveAt,
      })
      .from(accountDeletionRequests)
      .where(
        or(
          and(
            eq(accountDeletionRequests.status, 'pending'),
            lte(accountDeletionRequests.effectiveAt, sql`now()`),
          ),
          and(
            eq(accountDeletionRequests.status, 'executing'),
            lt(accountDeletionRequests.executedAt, takeoverCutoff),
          ),
        ),
      )
      .orderBy(accountDeletionRequests.effectiveAt);
  }

  /**
   * Mailbox requests are immediate. Failed requests retry on the next
   * sweep; executing requests retry only after the same stranded-run
   * cutoff used by account deletion.
   */
  private async findDueMailboxRequests(): Promise<DueMailboxRequest[]> {
    return this.deps.db
      .select({
        id: mailboxDataDeletionRequests.id,
        mailboxAccountId: mailboxDataDeletionRequests.mailboxAccountId,
      })
      .from(mailboxDataDeletionRequests)
      .where(
        or(
          eq(mailboxDataDeletionRequests.status, 'pending'),
          eq(mailboxDataDeletionRequests.status, 'failed'),
          and(
            eq(mailboxDataDeletionRequests.status, 'executing'),
            lt(mailboxDataDeletionRequests.executedAt, executingTakeoverCutoff()),
          ),
        ),
      )
      .orderBy(mailboxDataDeletionRequests.requestedAt);
  }

  /** Claim and erase one mailbox index while preserving its identity stub. */
  private async purgeMailboxRequest(request: DueMailboxRequest): Promise<boolean> {
    const [claimed] = await this.deps.db
      .update(mailboxDataDeletionRequests)
      .set({
        status: 'executing',
        executedAt: sql`now()`,
        failedAt: null,
        lastError: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(mailboxDataDeletionRequests.id, request.id),
          or(
            eq(mailboxDataDeletionRequests.status, 'pending'),
            eq(mailboxDataDeletionRequests.status, 'failed'),
            and(
              eq(mailboxDataDeletionRequests.status, 'executing'),
              lt(mailboxDataDeletionRequests.executedAt, executingTakeoverCutoff()),
            ),
          ),
        ),
      )
      .returning({ id: mailboxDataDeletionRequests.id });
    if (!claimed) {
      this.logMailbox('claim_lost', request, {});
      return false;
    }

    const lock = this.deps.mailboxLock ?? PASSTHROUGH_MAILBOX_LOCK;
    return lock.run(request.mailboxAccountId, async () => {
      const [mailbox] = await this.deps.db
        .select({
          id: mailboxAccounts.id,
          userId: mailboxAccounts.userId,
          workspaceId: mailboxAccounts.workspaceId,
          encryptedRefreshToken: mailboxAccounts.encryptedRefreshToken,
          dekEncrypted: mailboxAccounts.dekEncrypted,
        })
        .from(mailboxAccounts)
        .where(eq(mailboxAccounts.id, request.mailboxAccountId))
        .limit(1);
      if (!mailbox) {
        // The request FK cascades with the mailbox, so this is normally a
        // claim-lost race with account deletion. Treat it as a no-op.
        this.logMailbox('mailbox_already_gone', request, {});
        return false;
      }

      const watch =
        mailbox.encryptedRefreshToken && mailbox.dekEncrypted
          ? await this.stopMailboxWatch(request)
          : 'skipped';

      // Make the mailbox ineligible before the chunked phase. This early
      // update is deliberately durable: if a later chunk/final transaction
      // fails, no queued sync can repopulate the partially erased index.
      await this.deps.db
        .update(mailboxAccounts)
        .set({
          status: 'disconnected',
          quietState: sql`'{}'::jsonb`,
          encryptedRefreshToken: null,
          dekEncrypted: null,
          keyVersion: null,
          connectedAt: null,
          updatedAt: sql`now()`,
        })
        .where(eq(mailboxAccounts.id, request.mailboxAccountId));
      await this.clearMailboxPreferences(mailbox.userId, request.mailboxAccountId);

      const messagesDeleted = await this.deleteMailboxMessagesChunked(request.mailboxAccountId);

      // All small deletes + completion are atomic. A crash before commit
      // leaves the request executing and the next sweep safely retries.
      await this.deps.db.transaction(async (tx) => {
        // The dead-letter recorder takes this same row lock across its
        // completed-check + insert. Records committed before this lock are
        // deleted below; later recorders wait and observe `completed`.
        await tx
          .select({ id: mailboxDataDeletionRequests.id })
          .from(mailboxDataDeletionRequests)
          .where(eq(mailboxDataDeletionRequests.id, request.id))
          .limit(1)
          .for('update');

        // Close the narrow tail between the last chunk and this final
        // transaction. Normally empty; catches a row committed by sync
        // work that was already in flight when the request was created.
        await tx
          .delete(mailMessages)
          .where(eq(mailMessages.mailboxAccountId, request.mailboxAccountId));
        // Delete FK dependants before their referenced rows so the purge
        // does not rely on SET NULL side effects and count drift.
        await tx
          .delete(ruleMatchLog)
          .where(eq(ruleMatchLog.mailboxAccountId, request.mailboxAccountId));
        await tx
          .delete(activityLog)
          .where(eq(activityLog.mailboxAccountId, request.mailboxAccountId));
        await tx
          .delete(actionJobs)
          .where(eq(actionJobs.mailboxAccountId, request.mailboxAccountId));
        await tx
          .delete(automationRules)
          .where(eq(automationRules.mailboxAccountId, request.mailboxAccountId));
        await tx
          .delete(undoJournal)
          .where(eq(undoJournal.mailboxAccountId, request.mailboxAccountId));

        await tx.delete(briefRuns).where(eq(briefRuns.mailboxAccountId, request.mailboxAccountId));
        await tx
          .delete(followupTracker)
          .where(eq(followupTracker.mailboxAccountId, request.mailboxAccountId));
        await tx
          .delete(screenerQuarantine)
          .where(eq(screenerQuarantine.mailboxAccountId, request.mailboxAccountId));
        await tx
          .delete(triageDecisions)
          .where(eq(triageDecisions.mailboxAccountId, request.mailboxAccountId));
        await tx
          .delete(senderPolicies)
          .where(eq(senderPolicies.mailboxAccountId, request.mailboxAccountId));
        await tx
          .delete(senderTimeseries)
          .where(eq(senderTimeseries.mailboxAccountId, request.mailboxAccountId));
        await tx.delete(senders).where(eq(senders.mailboxAccountId, request.mailboxAccountId));
        await tx
          .delete(webhookDedup)
          .where(eq(webhookDedup.mailboxAccountId, request.mailboxAccountId));
        await tx
          .delete(providerSyncState)
          .where(eq(providerSyncState.mailboxAccountId, request.mailboxAccountId));

        // These operational stores intentionally have no mailbox FK, so
        // cascade cannot clean them. Every typed payload carries the id.
        await tx
          .delete(outboxEvents)
          .where(sql`${outboxEvents.payload}->>'mailboxAccountId' = ${request.mailboxAccountId}`);
        await tx
          .delete(deadLetterJobs)
          .where(sql`${deadLetterJobs.payload}->>'mailboxAccountId' = ${request.mailboxAccountId}`);

        await tx.insert(securityEvents).values({
          eventType: 'mailbox.indexed_data_deleted',
          severity: 'warning',
          userId: mailbox.userId,
          workspaceId: mailbox.workspaceId,
          payload: { requestId: request.id, mailboxAccountId: request.mailboxAccountId },
        });
        await tx
          .update(mailboxDataDeletionRequests)
          .set({
            status: 'completed',
            completedAt: sql`now()`,
            failedAt: null,
            lastError: null,
            updatedAt: sql`now()`,
          })
          .where(eq(mailboxDataDeletionRequests.id, request.id));
      });

      this.logMailbox('purged', request, { messagesDeleted, watch });
      return true;
    });
  }

  /** Best-effort users.stop while credentials still exist. */
  private async stopMailboxWatch(
    request: DueMailboxRequest,
  ): Promise<'stopped' | 'failed' | 'skipped'> {
    if (!this.deps.topicName) return 'skipped';
    try {
      const client = await this.deps.gmailWatch.getClient(request.mailboxAccountId);
      await client.stopWatch();
      return 'stopped';
    } catch (err) {
      this.logMailbox('watch_stop_failed', request, {
        error: controlledErrorCode(err),
      });
      return 'failed';
    }
  }

  /** Clear mailbox-derived onboarding pins and only the matching active id. */
  private async clearMailboxPreferences(userId: string, mailboxAccountId: string): Promise<void> {
    await this.deps.db
      .update(users)
      .set({
        preferences: sql`(${users.preferences} - 'onboardingFirstTriageKeys') || CASE WHEN ${users.preferences}->>'activeMailboxId' = ${mailboxAccountId} THEN '{"activeMailboxId":null}'::jsonb ELSE '{}'::jsonb END`,
      })
      .where(eq(users.id, userId));
  }

  /** Chunk the one target mailbox's large message table. */
  private async deleteMailboxMessagesChunked(mailboxAccountId: string): Promise<number> {
    let total = 0;
    for (;;) {
      const chunk = this.deps.db
        .select({ id: mailMessages.id })
        .from(mailMessages)
        .where(eq(mailMessages.mailboxAccountId, mailboxAccountId))
        .limit(MAIL_MESSAGES_DELETE_CHUNK);
      const deleted = await this.deps.db
        .delete(mailMessages)
        .where(inArray(mailMessages.id, chunk))
        .returning({ id: mailMessages.id });
      total += deleted.length;
      if (deleted.length < MAIL_MESSAGES_DELETE_CHUNK) return total;
    }
  }

  /** Persist a retryable terminal state without masking the original error. */
  private async markMailboxRequestFailed(request: DueMailboxRequest, error: Error): Promise<void> {
    try {
      await this.deps.db
        .update(mailboxDataDeletionRequests)
        .set({
          status: 'failed',
          failedAt: sql`now()`,
          lastError: controlledErrorCode(error),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(mailboxDataDeletionRequests.id, request.id),
            eq(mailboxDataDeletionRequests.status, 'executing'),
          ),
        );
    } catch (recordError) {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'mailbox_data_deletion.failure_record_failed',
          requestId: request.id,
          error: controlledErrorCode(recordError),
        }),
      );
    }
  }

  private logMailbox(
    event: string,
    request: DueMailboxRequest,
    extra: Record<string, unknown>,
  ): void {
    console.log(
      JSON.stringify({
        level: 'info',
        kind: `mailbox_data_deletion.${event}`,
        requestId: request.id,
        mailboxAccountId: request.mailboxAccountId,
        ...extra,
      }),
    );
  }

  /** Execute one purge end-to-end. Every step is idempotent (resume-safe). */
  private async purgeOne(request: DueRequest): Promise<void> {
    const { db } = this.deps;

    // 1. Claim. Conditional so a cancel that raced the sweep wins, and
    // so two replicas can't both take over the same stranded row: an
    // 'executing' row is claimable only past the takeover cutoff — the
    // winner's fresh executed_at makes the loser's UPDATE match no row.
    const [claimedRow] = await db
      .update(accountDeletionRequests)
      .set({ status: 'executing', executedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(accountDeletionRequests.id, request.id),
          or(
            eq(accountDeletionRequests.status, 'pending'),
            and(
              eq(accountDeletionRequests.status, 'executing'),
              lt(accountDeletionRequests.executedAt, executingTakeoverCutoff()),
            ),
          ),
        ),
      )
      .returning({ id: accountDeletionRequests.id });
    if (!claimedRow) {
      this.log('claim_lost', request, {});
      return;
    }

    // 2. Capture everything the post-drop steps need.
    const [user] = await db
      .select({ email: users.email, workspaceId: users.workspaceId })
      .from(users)
      .where(eq(users.id, request.userId))
      .limit(1);
    if (!user) {
      // Unreachable in the normal flow (the request row cascades with
      // the user) — defensive resume path.
      this.log('user_already_gone', request, {});
      return;
    }
    const mailboxes = await db
      .select({ id: mailboxAccounts.id })
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.userId, request.userId));
    const mailboxIds = mailboxes.map((m) => m.id);

    // 3. users.stop on every mailbox — best-effort, per-mailbox isolation.
    const watch = await this.stopAllWatches(request, mailboxIds);

    // 4. Receipt email — BEFORE the drop (see class doc for why).
    await this.enqueueReceipt(request, user.email);

    // 5. Audit row — survives the drop (security_events FKs SET NULL).
    await this.recordAudit(request, user.workspaceId, mailboxIds.length, watch);

    // 6a. mail_messages, chunked.
    const messagesDeleted = await this.deleteMailMessagesChunked(request.userId);

    // 6b. Mailbox rows (+ cascaded mailbox-scoped children).
    await db.delete(mailboxAccounts).where(eq(mailboxAccounts.userId, request.userId));

    // 6c. Workspace when sole member (cascades the user + this request
    // row), else just the user.
    const [otherMember] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.workspaceId, user.workspaceId), sql`${users.id} <> ${request.userId}`))
      .limit(1);
    if (otherMember) {
      await db.delete(users).where(eq(users.id, request.userId));
    } else {
      await db.delete(workspaces).where(eq(workspaces.id, user.workspaceId));
    }

    this.log('purged', request, {
      mailboxes: mailboxIds.length,
      messagesDeleted,
      watchStopped: watch.stopped,
      watchFailed: watch.failed,
      workspaceDeleted: !otherMember,
    });
  }

  /** `users.stop` per mailbox — never throws, mirrors GmailWatchService. */
  private async stopAllWatches(
    request: DueRequest,
    mailboxIds: string[],
  ): Promise<{ stopped: number; failed: number; skipped: number }> {
    if (!this.deps.topicName) {
      return { stopped: 0, failed: 0, skipped: mailboxIds.length };
    }
    let stopped = 0;
    let failed = 0;
    for (const mailboxAccountId of mailboxIds) {
      try {
        const client = await this.deps.gmailWatch.getClient(mailboxAccountId);
        await client.stopWatch();
        stopped += 1;
      } catch (err) {
        // A disconnected mailbox (no token) or a Gmail hiccup must not
        // block the purge. Gmail expires orphaned watches in ≤7 days.
        failed += 1;
        const error = err instanceof Error ? err : new Error(String(err));
        this.log('watch_stop_failed', request, { mailboxAccountId, message: error.message });
      }
    }
    return { stopped, failed, skipped: 0 };
  }

  /** Enqueue the deletion receipt — idempotent on the request id. */
  private async enqueueReceipt(request: DueRequest, email: string): Promise<void> {
    if (!this.deps.emailQueue) {
      this.log('receipt_skipped_no_queue', request, {});
      return;
    }
    const rendered = this.deps.renderReceiptEmail({
      deletedAt: new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date()),
    });
    await enqueueEmailSend(this.deps.emailQueue, {
      kind: 'deletion-receipt',
      userId: request.userId,
      recipientOverride: email,
      subject: rendered.subject,
      text: rendered.text,
      idempotencyKey: `email__deletion-receipt__${request.id}`,
    });
  }

  /** Compliance trail — deduped on payload requestId for resume. */
  private async recordAudit(
    request: DueRequest,
    workspaceId: string,
    mailboxCount: number,
    watch: { stopped: number; failed: number; skipped: number },
  ): Promise<void> {
    const [existing] = await this.deps.db
      .select({ id: securityEvents.id })
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.eventType, 'account.deletion_executed'),
          sql`${securityEvents.payload}->>'requestId' = ${request.id}`,
        ),
      )
      .limit(1);
    if (existing) {
      return;
    }
    await this.deps.db.insert(securityEvents).values({
      eventType: 'account.deletion_executed',
      severity: 'warning',
      userId: request.userId,
      workspaceId,
      payload: {
        requestId: request.id,
        // The FK columns above are nulled when the rows drop — the
        // payload ids are the durable pseudonymous trail (no email
        // address here; deletion means deletion).
        userId: request.userId,
        workspaceId,
        basis: request.basis,
        requestedAt: request.requestedAt.toISOString(),
        effectiveAt: request.effectiveAt.toISOString(),
        mailboxCount,
        watch,
      },
    });
  }

  /**
   * Delete the user's `mail_messages` in chunks. The big table —
   * chunking caps statement time AND makes every retry attempt durable
   * progress (the resumability contract).
   */
  private async deleteMailMessagesChunked(userId: string): Promise<number> {
    const { db } = this.deps;
    let total = 0;
    for (;;) {
      const chunk = db
        .select({ id: mailMessages.id })
        .from(mailMessages)
        .innerJoin(mailboxAccounts, eq(mailMessages.mailboxAccountId, mailboxAccounts.id))
        .where(eq(mailboxAccounts.userId, userId))
        .limit(MAIL_MESSAGES_DELETE_CHUNK);
      const deleted = await db
        .delete(mailMessages)
        .where(inArray(mailMessages.id, chunk))
        .returning({ id: mailMessages.id });
      total += deleted.length;
      if (deleted.length < MAIL_MESSAGES_DELETE_CHUNK) {
        return total;
      }
    }
  }

  /** Structured log line — ids + counts only (D7). */
  private log(event: string, request: DueRequest, extra: Record<string, unknown>): void {
    console.log(
      JSON.stringify({
        level: 'info',
        kind: `account_deletion.${event}`,
        requestId: request.id,
        userId: request.userId,
        ...extra,
      }),
    );
  }
}
