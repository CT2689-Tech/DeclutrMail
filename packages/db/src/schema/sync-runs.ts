import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';

/**
 * Sync runs — per-run history for `InitialSyncWorker` (F002).
 *
 * `provider_sync_state` holds exactly ONE row per mailbox and is
 * overwritten by every run, so it answers "what is this mailbox doing
 * now?" and nothing else. The questions it structurally cannot answer
 * are the operational ones: how long did that sync take, which stage
 * was slow, how many messages did Gmail refuse, is sync getting slower
 * for this account, how does this account compare to another. This
 * table is that history.
 *
 * WHY FIRST-PARTY AND NOT POSTHOG. Analytics consent (D147) lives in
 * per-browser `localStorage` with decline as the default and is
 * deliberately never synced to the user record, so no worker can read
 * it — and we publish that PostHog "is initialized only after you
 * accept it" and that Essential-only "stops analytics immediately". A
 * server-side emitter therefore cannot exist without contradicting a
 * published page. First-party operational data sits outside that gate
 * ("First-party storage is authoritative; PostHog remains optional and
 * consent-gated"), and it is strictly better here anyway: a row insert
 * is exactly-once and durable, where a fire-and-forget HTTP event is
 * neither — and loses hardest exactly when the sync failed, which is
 * when the record matters most.
 *
 * ONE ROW PER FINISHED RUN, WRITTEN AT THE END. There is deliberately
 * no 'running' status. A row that is inserted at the start and updated
 * at the end needs a run identity that survives BullMQ retries, and
 * every candidate for that (attempt number, enqueue timestamp, "the
 * open row for this mailbox") either mis-keys a retry as a new run or
 * strands an orphan row that the next genuine run adopts. Writing once
 * at the terminal disposition removes the whole class: the success
 * insert rides `markReady`'s transaction, so the row commits if and
 * only if the sync did, and `attempts` is a fact that is simply known
 * by then. In-flight and stuck syncs are already owned by
 * `provider_sync_state` + `scripts/check-sync-stuck.sh`; this table
 * does not duplicate them.
 *
 * NULL MEANS NOT MEASURED, 0 MEANS MEASURED ZERO. A failed run carries
 * NULL metrics because the worker returns no partial counts when it
 * throws — writing 0 would assert a mailbox synced nothing, which is
 * usually false.
 *
 * TWO SCALES, AND THE COLUMN NAMES SAY WHICH. The sync is resumable
 * (D5): a retry skips every message already stored. So `messagesSynced`
 * / `sendersIndexed` describe the MAILBOX at the end of the run —
 * cumulative across attempts — while timing and API calls are only ever
 * accumulated inside the attempt that finished.
 *
 * Storing the latter under a bare `durationMs` would not merely be
 * vague, it would INVERT. Each retry resumes closer to done, so a
 * mailbox that needed four attempts records a shorter duration than one
 * that succeeded first try, and the question this table exists to answer
 * — "is sync getting slower for this account?" — would answer *faster*
 * as the account degrades. Hence the `finalAttempt` prefix.
 *
 * For whether an account is struggling, read `attempts`. A true
 * enqueue-to-finish duration would need BullMQ's `job.timestamp` on
 * `WorkerContext`, which no worker carries today.
 *
 * The two `skipped_*` statuses are designed no-ops, not failures — a
 * mailbox paused for account deletion (D232) and a duplicate enqueue
 * against an already-`ready` mailbox (the 2026-07-10 double-OAuth
 * incident). They are recorded because "I retried that account and
 * nothing happened" is a real support question and these are its two
 * answers. A run against an INACTIVE or missing mailbox writes no row:
 * the FK could not be satisfied, and "the mailbox is gone" is not a
 * fact about a sync.
 *
 * Privacy (D7): counts, timings, durations and a worker error class
 * name. No addresses, no subjects, no body data.
 */

export const syncRunStatus = pgEnum('sync_run_status', [
  'succeeded',
  'failed',
  'skipped_deletion_pending',
  'skipped_already_ready',
]);

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    status: syncRunStatus('status').notNull(),
    /** BullMQ attempts the run consumed (`ctx.attempt`); 1 = first try. */
    attempts: smallint('attempts').notNull().default(1),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /** CUMULATIVE — messages in `mail_messages` when the run ended, across
     * every attempt. NULL unless succeeded. */
    messagesSynced: integer('messages_synced'),
    /** CUMULATIVE — senders in the index when the run ended. */
    sendersIndexed: integer('senders_indexed'),
    /** Messages Gmail still refused to render as metadata on the final
     * attempt. Because a refused message is never stored it is
     * re-attempted every run, so this is also the standing gap in the
     * index. Read WITH `messages_synced` — a total without its gap
     * reports a partial mailbox as a whole one. */
    unreadable: integer('unreadable'),
    /** FINAL ATTEMPT ONLY — wall-clock ms, its stage 1 start → ready.
     * Comparable across runs only where `attempts = 1`. NULL on failure. */
    finalAttemptDurationMs: integer('final_attempt_duration_ms'),
    /** FINAL ATTEMPT ONLY — Gmail API calls it made. Far below
     * `messages_synced` on a resume; that gap IS the resume signal. */
    finalAttemptGmailApiCalls: integer('final_attempt_gmail_api_calls'),
    /** FINAL ATTEMPT ONLY — per-stage wall-clock ms keyed by D224 stage
     * name. The "which stage was slow" answer no other store holds. */
    finalAttemptStageTimings: jsonb('final_attempt_stage_timings'),
    /** Worker error class name (e.g. 'GmailAuthError'). Metadata only. */
    errorCode: text('error_code'),
  },
  (table) => ({
    /** "Last N runs for this mailbox" — every read this table exists for. */
    mailboxFinishedIdx: index('sync_runs_mailbox_finished_idx').on(
      table.mailboxAccountId,
      table.finishedAt.desc(),
    ),
  }),
);

export type SyncRun = typeof syncRuns.$inferSelect;
export type NewSyncRun = typeof syncRuns.$inferInsert;
