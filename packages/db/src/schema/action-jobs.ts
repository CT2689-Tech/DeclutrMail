import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
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
 * drops INBOX; `later` swaps INBOX for the DeclutrMail/Later label;
 * `delete` moves messages to Gmail Trash (recoverable for 30 days,
 * after which Gmail auto-empties). All three are valid
 * `undo_action_kind` + `activity_action` values, so the worker can
 * write a job's verb straight into the undo journal + activity log.
 *
 * `delete` was added in 2026-06-03 per ADR-0019 + spec v1.2 Decision 1
 * (extends D227's K/A/U/L to K/A/U/L/D). The Trash worker calls
 * Gmail `messages.trash` (NOT `messages.delete` — Trash is the
 * 30-day recovery window the spec relies on).
 *
 * `keep` (policy-only) never produces an `action_jobs` row.
 *
 * `unsubscribe` was added in 2026-06-06 (migration 0024 per FOUNDER-
 * FOLLOWUPS 2026-06-05 'DB-level Idempotency-Key dedup for unsubscribe
 * -intent'). The verb does NOT enqueue a worker job — the row is
 * persisted directly at status='done' with `resolved_message_ids =
 * [activityLogId]`, so the unique `action_jobs_idempotency_key_uniq`
 * constraint dedups a retried POST. The real unsub execution pipeline
 * (D9, D230) reads the activity_log row, never the action_jobs row.
 *
 * `unarchive` is in the Action Registry (ADR-0015) as a label-modify
 * verb but is intentionally NOT added to this enum yet: the worker
 * writes the verb into `undo_action_kind` + `activity_action`, which do
 * not include `unarchive`. Adding it is the restore-pipeline change
 * (those two enums + worker support) and has no producer at this stage.
 */
export const actionVerb = pgEnum('action_verb', ['archive', 'later', 'delete', 'unsubscribe']);

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
  { type: 'sender'; senderId: string; senderKey: string } | { type: 'messages' };

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
    /**
     * Recovery lineage. Attempt 0 is the original action and keeps both
     * references NULL. Every recovery attempt points to the attempt-0 root
     * and to the immediately preceding failed attempt. Recovery is therefore
     * append-only: it never rewrites or blindly replays the original row.
     */
    rootActionId: uuid('root_action_id').references((): AnyPgColumn => actionJobs.id, {
      onDelete: 'cascade',
    }),
    retryOfActionId: uuid('retry_of_action_id').references((): AnyPgColumn => actionJobs.id, {
      onDelete: 'cascade',
    }),
    recoveryAttempt: integer('recovery_attempt').notNull().default(0),
    /**
     * When the recovery preview's complete provider-message target set was
     * frozen onto `resolved_message_ids`. Required for recovery attempts and
     * NULL for attempt-0 actions. Reapplying the complete set is intentional:
     * provider label mutations are idempotent, and this also repairs a lost
     * Activity/Undo commit after Gmail already applied the original action.
     */
    selectionFrozenAt: timestamp('selection_frozen_at', {
      withTimezone: true,
      mode: 'date',
    }),
    /**
     * Composite action linkage (ADR-0020). For a composite secondary
     * action (e.g. the Delete part of "Unsubscribe + Delete past"),
     * `compositeId` references the primary row's `id` so the cascade-
     * undo path can read `WHERE composite_id = $1` and reverse every
     * sibling row in REVERSE ORDER (secondary first, then primary).
     *
     * NULL for single-verb actions (no composite linkage) and for
     * the primary row of a composite (the primary refers to itself
     * implicitly via `id`; only secondaries fill this column).
     *
     * FK enforced at DB level via 0020 migration (DEFERRABLE INITIALLY
     * DEFERRED). NULL skips the FK check per standard SQL semantics.
     *
     * Drizzle cannot express DEFERRABLE INITIALLY DEFERRED — that
     * timing remains migration-only. The `.references()` annotation
     * below records the ON DELETE CASCADE so the schema reflects the
     * actual DB shape (introspection, type-safe joins, generate-no-diff
     * gate). The self-reference uses the `AnyPgColumn` forward-ref
     * pattern because `actionJobs` is the table being defined.
     */
    compositeId: uuid('composite_id').references((): AnyPgColumn => actionJobs.id, {
      onDelete: 'cascade',
    }),
    /**
     * Time-window filter applied at worker resolution (ADR-0020).
     * Used by Archive + Delete verbs (and the secondary historic
     * action on Unsubscribe + Later composites). NULL = no time
     * filter; act on all messages matching the selector. Range
     * 1–3650 days enforced by DB CHECK constraint (0020 migration).
     */
    olderThanDays: integer('older_than_days'),
    /**
     * D245 Later schedule, captured with the action intent. Required for
     * every Later job and forbidden for every other verb by the table
     * CHECK below. Reverse Later rows copy the original value so Undo can
     * cancel only its matching timer. The column remains nullable because
     * non-Later jobs store NULL. The successful worker event projects this
     * onto sender_policies only after Gmail confirms the move.
     */
    wakeAt: timestamp('wake_at', { withTimezone: true, mode: 'date' }),
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
    /** Composite cascade-undo lookup (ADR-0020). */
    compositeIdIdx: index('action_jobs_composite_id_idx').on(table.compositeId),
    /** One immutable attempt number per logical action lineage. */
    rootRecoveryAttemptUniq: uniqueIndex('action_jobs_root_recovery_attempt_uniq')
      .on(table.rootActionId, table.recoveryAttempt)
      .where(sql`${table.rootActionId} IS NOT NULL`),
    /** One direct recovery child per failed attempt (confirmation replay guard). */
    retryOfActionIdUniq: uniqueIndex('action_jobs_retry_of_action_id_uniq')
      .on(table.retryOfActionId)
      .where(sql`${table.retryOfActionId} IS NOT NULL`),
    /**
     * Attempt 0 is always a lineage root. Recovery attempts always carry a
     * root, a predecessor, and the timestamp of their frozen selection.
     */
    recoveryLineageCheck: check(
      'action_jobs_recovery_lineage_check',
      sql`(${table.recoveryAttempt} = 0 AND ${table.rootActionId} IS NULL AND ${table.retryOfActionId} IS NULL AND ${table.selectionFrozenAt} IS NULL) OR (${table.recoveryAttempt} > 0 AND ${table.rootActionId} IS NOT NULL AND ${table.retryOfActionId} IS NOT NULL AND ${table.selectionFrozenAt} IS NOT NULL AND ${table.rootActionId} <> ${table.id} AND ${table.retryOfActionId} <> ${table.id})`,
    ),
    /** Later always has a wake time; no other verb may carry one. */
    wakeAtVerbCheck: check(
      'action_jobs_wake_at_verb_check',
      sql`(${table.verb} = 'later' AND ${table.wakeAt} IS NOT NULL) OR (${table.verb} <> 'later' AND ${table.wakeAt} IS NULL)`,
    ),
  }),
);

export type ActionJob = typeof actionJobs.$inferSelect;
export type NewActionJob = typeof actionJobs.$inferInsert;
