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
 * usually false. `duration_ms` is NULL on failure for the same reason:
 * the only timing available at that point is the last ATTEMPT's, not
 * the run's, and labelling one as the other is the same lie.
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
    /** Wall-clock ms, stage 1 start → ready. NULL on failure (unknown). */
    durationMs: integer('duration_ms'),
    /** Messages mirrored into `mail_messages`. NULL unless succeeded. */
    messagesSynced: integer('messages_synced'),
    /** Messages Gmail refused to render as metadata, so the index has a
     * known gap. Read WITH `messages_synced` — a total without its gap
     * reports a partial mailbox as a whole one. */
    unreadable: integer('unreadable'),
    sendersIndexed: integer('senders_indexed'),
    /** Gmail API calls THIS run. Far below `messages_synced` on a resume. */
    gmailApiCalls: integer('gmail_api_calls'),
    /** Per-stage wall-clock ms keyed by D224 stage name — the "which
     * stage was slow" answer that no other store holds. */
    stageTimings: jsonb('stage_timings'),
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
