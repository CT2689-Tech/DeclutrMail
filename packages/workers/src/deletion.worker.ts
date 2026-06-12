import { and, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Queue } from 'bullmq';

import {
  accountDeletionRequests,
  cronRuns,
  mailboxAccounts,
  mailMessages,
  securityEvents,
  users,
  workspaces,
} from '@declutrmail/db';
import type { schema } from '@declutrmail/db';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { enqueueEmailSend } from './email-send.queue.js';
import type { EmailSendJobData } from './email-send.worker.js';
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

/** Chunk size for the mail_messages bulk delete (the big table). */
const MAIL_MESSAGES_DELETE_CHUNK = 5_000;

/**
 * An 'executing' row older than this is a STRANDED purge (the worker
 * crashed mid-run) — the sweep takes it over. Generous vs. the 60s
 * cronPolicy job timeout so a live run is never double-claimed.
 */
const EXECUTING_TAKEOVER_AFTER_MS = 10 * 60 * 1_000;

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
 *   1. Claim — flip to 'executing' (+executed_at). Conditional UPDATE.
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

    const allFailed = due.length > 0 && purged === 0;
    await this.deps.db
      .update(cronRuns)
      .set({ status: allFailed ? 'failed' : 'succeeded', finishedAt: sql`now()` })
      .where(eq(cronRuns.runKey, runKey));

    if (allFailed) {
      throw new TransientError(
        `AccountDeletionPurgeWorker: all ${due.length} due deletion requests failed to purge`,
      );
    }

    return {
      outcome: 'swept',
      due: due.length,
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
    const takeoverCutoff = new Date(Date.now() - EXECUTING_TAKEOVER_AFTER_MS);
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

  /** Execute one purge end-to-end. Every step is idempotent (resume-safe). */
  private async purgeOne(request: DueRequest): Promise<void> {
    const { db } = this.deps;

    // 1. Claim. Conditional so a cancel that raced the sweep wins.
    const [claimedRow] = await db
      .update(accountDeletionRequests)
      .set({ status: 'executing', executedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(accountDeletionRequests.id, request.id),
          inArray(accountDeletionRequests.status, ['pending', 'executing']),
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
