import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';
import { undoJournal } from './undo-journal';

/**
 * Action jobs (D226) — the durable record + status aggregate for the
 * async destructive-action pipeline.
 *
 * One row per user (or future Autopilot) action. The API resolves the
 * target set, persists this row (`status='queued'`), and enqueues a
 * BullMQ job; the action-consumer worker mutates Gmail, then in one
 * transaction issues the undo token + writes `activity_log` + publishes
 * the outbox event + flips this row to `done`. The FE polls
 * `GET /api/actions/:id` for `status` → `done` + the `undo_token`.
 *
 * `direction` distinguishes a forward action (`archive` = remove INBOX)
 * from its reverse (undo = re-add INBOX). Undo is modeled as its OWN
 * row so it reuses this status lifecycle — the `failed` state is then
 * available to the undo UI for free, and a stranded async revert can be
 * observed and retried like any other job.
 *
 * `resolved_message_ids` is the DURABLE execution set — the concrete
 * `provider_message_id`s the worker will (or did) mutate. It is captured
 * BEFORE the Gmail call so a retry after a post-mutation crash reuses
 * the exact set rather than re-resolving "currently in INBOX" (which
 * would be empty after a successful archive — and thus issue no undo
 * token for the work that actually happened). This durability is the
 * price of truthful retries + undo; the array TOASTs for large senders,
 * which is intentional.
 *
 * `idempotency_key` is the client-supplied `Idempotency-Key` header (one
 * per user click; Autopilot uses the match/event id). It is NOT derived
 * from the selector — "archive this sender" today and again next week
 * (after new mail arrives) are two distinct actions and must each get
 * their own row. UNIQUE so a network-retried POST returns the existing
 * row instead of double-acting; the BullMQ `jobId` is the second dedup
 * layer.
 *
 * PRIVACY — D7 / D228. `selector` + `resolved_message_ids` carry ONLY
 * Gmail identifiers (message ids, the sha256 sender_key) — never body,
 * snippet, subject, or any header. The `$type` union below cannot
 * represent a body field; the column type is the privacy boundary.
 */

/**
 * Verbs the label-modify pipeline can apply. Append-only. `archive`
 * drops INBOX; `later` swaps INBOX for the DeclutrMail/Later label —
 * both are also valid `undo_action_kind` + `activity_action` values, so
 * the worker can write a job's verb straight into the undo journal +
 * activity log.
 *
 * `keep` (policy-only) and `unsubscribe` (its own pipeline) never produce
 * an `action_jobs` row, so they are not here. `unarchive` is in the
 * Action Registry (ADR-0015) as a label-modify verb but is intentionally
 * NOT added to this enum yet: the worker writes the verb into
 * `undo_action_kind` + `activity_action`, which do not include
 * `unarchive`. Adding it is the restore-pipeline change (those two enums
 * + worker support) and has no producer at this stage.
 */
export const actionVerb = pgEnum('action_verb', ['archive', 'later']);

/** Forward action vs. its reverse (undo). */
export const actionDirection = pgEnum('action_direction', ['forward', 'reverse']);

/** Job lifecycle — drives the FE poll + the `failed` surface. */
export const actionJobStatus = pgEnum('action_job_status', [
  'queued',
  'executing',
  'done',
  'failed',
]);

/**
 * Resolved selector stored on the row (ids/keys only — D7).
 *
 *   - `sender`   — carries the resolved `senderKey` so the worker can
 *                  write the per-sender `activity_log` row + outbox
 *                  event without re-resolving. `senderId` is kept for
 *                  audit/trace back to the external request.
 *   - `messages` — the concrete ids live in `resolved_message_ids`; the
 *                  selector itself carries no per-message data.
 */
export type LabelActionSelector =
  | { type: 'sender'; senderId: string; senderKey: string }
  | { type: 'messages' };

export const actionJobs = pgTable(
  'action_jobs',
  {
    /** The `actionId` returned to the FE + polled at `GET /api/actions/:id`. */
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    verb: actionVerb('verb').notNull(),
    direction: actionDirection('direction').notNull().default('forward'),
    /** Resolved selector — ids/keys only (D7). See `LabelActionSelector`. */
    selector: jsonb('selector').$type<LabelActionSelector>().notNull(),
    /**
     * The durable execution set — `provider_message_id`s captured before
     * the mutation so retries reuse it (never re-resolve). D7: ids only.
     */
    resolvedMessageIds: text('resolved_message_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Count surfaced to the FE at enqueue time. */
    requestedCount: integer('requested_count').notNull().default(0),
    /** Count the worker actually mutated (set on `done`). */
    affectedCount: integer('affected_count').notNull().default(0),
    status: actionJobStatus('status').notNull().default('queued'),
    /** Client `Idempotency-Key` (per click). UNIQUE — see index below. */
    idempotencyKey: text('idempotency_key').notNull(),
    /**
     * The undo token. For a forward action: the token issued on `done`
     * (FK → `undo_journal.token`). For a reverse action: the token being
     * reverted. `ON DELETE set null` so undo-journal expiry (cleanup
     * worker) does not cascade-delete the action-job audit row.
     */
    undoToken: uuid('undo_token').references(() => undoJournal.token, {
      onDelete: 'set null',
    }),
    /** Classified failure code, set when `status='failed'`. */
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /** Idempotency backstop — the client key dedups a retried POST. */
    idempotencyKeyUniq: uniqueIndex('action_jobs_idempotency_key_uniq').on(table.idempotencyKey),
    /** Poll-by-mailbox + ops listing. */
    accountStatusCreatedIdx: index('action_jobs_account_status_created_idx').on(
      table.mailboxAccountId,
      table.status,
      table.createdAt,
    ),
    /** Symmetric with `activity_log_undo_token_idx` — action ↔ undo join. */
    undoTokenIdx: index('action_jobs_undo_token_idx').on(table.undoToken),
  }),
);

export type ActionJob = typeof actionJobs.$inferSelect;
export type NewActionJob = typeof actionJobs.$inferInsert;
