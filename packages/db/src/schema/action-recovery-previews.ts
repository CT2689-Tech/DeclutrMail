import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { actionJobs } from './action-jobs';
import { mailboxAccounts } from './mailbox-accounts';

/** Lifecycle for a durable, read-only provider-state verification. */
export const actionRecoveryPreviewStatus = pgEnum('action_recovery_preview_status', [
  'verifying',
  'ready',
  'failed',
  'consumed',
]);

/** Truthful conclusion reached before any recovery mutation is allowed. */
export const actionRecoveryOutcome = pgEnum('action_recovery_outcome', [
  'not_applied',
  'partial',
  'already_applied',
  'no_change_needed',
  'uncertain',
  'reconnect_required',
  'blocked',
]);

/**
 * Durable consequence preview for recovering one failed label action.
 *
 * The verifier reads provider metadata only, records what still needs to
 * change, and expires the result. Confirmation consumes this row and creates
 * a NEW `action_jobs` recovery attempt whose `resolved_message_ids` exactly
 * match `target_message_ids`; applying the complete frozen set is provider-
 * idempotent and lets the worker repair a missing Activity/Undo commit even
 * when Gmail already reflects the action. The original row is never reused.
 *
 * Privacy (D7/D228): both arrays contain provider message identifiers only.
 * `error_code` is a controlled classification, never raw provider text.
 */
export const actionRecoveryPreviews = pgTable(
  'action_recovery_previews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    /** Attempt-0 action anchoring the complete recovery lineage. */
    rootActionId: uuid('root_action_id')
      .notNull()
      .references(() => actionJobs.id, { onDelete: 'cascade' }),
    /** Current failed attempt whose provider outcome is being verified. */
    currentActionId: uuid('current_action_id')
      .notNull()
      .references(() => actionJobs.id, { onDelete: 'cascade' }),
    status: actionRecoveryPreviewStatus('status').notNull().default('verifying'),
    outcome: actionRecoveryOutcome('outcome'),
    /** Frozen ids considered by the verifier. */
    targetMessageIds: text('target_message_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Verified subset that still lacks the intended provider state. */
    remainingMessageIds: text('remaining_message_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Frozen candidates that no longer exist at the provider. */
    unavailableCount: integer('unavailable_count').notNull().default(0),
    verifiedCount: integer('verified_count').notNull().default(0),
    /** Controlled error class/code only; never raw provider or message text. */
    errorCode: text('error_code'),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
    /** New recovery attempt created when a ready preview is consumed. */
    recoveryActionId: uuid('recovery_action_id').references(() => actionJobs.id, {
      onDelete: 'cascade',
    }),
    /** Hash binding the consumed preview to the exact confirmation payload. */
    confirmationFingerprint: text('confirmation_fingerprint'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /** Mailbox-scoped polling and operations listing. */
    mailboxStatusCreatedIdx: index('action_recovery_previews_mailbox_status_created_idx').on(
      table.mailboxAccountId,
      table.status,
      table.createdAt,
    ),
    /** History for one logical recovery lineage. */
    rootCreatedIdx: index('action_recovery_previews_root_created_idx').on(
      table.rootActionId,
      table.createdAt,
    ),
    /** Find previews made from one failed attempt. */
    currentActionIdx: index('action_recovery_previews_current_action_idx').on(
      table.currentActionId,
    ),
    /** Only one verifying/confirmable preview may exist per logical action. */
    activeRootUniq: uniqueIndex('action_recovery_previews_active_root_uniq')
      .on(table.rootActionId)
      .where(sql`${table.status} IN ('verifying', 'ready')`),
    /** Expiry sweep for active previews. */
    activeExpiresIdx: index('action_recovery_previews_active_expires_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} IN ('verifying', 'ready')`),
    /** A recovery action can consume only one preview. */
    recoveryActionUniq: uniqueIndex('action_recovery_previews_recovery_action_uniq')
      .on(table.recoveryActionId)
      .where(sql`${table.recoveryActionId} IS NOT NULL`),
    /** Remaining ids are a verified subset of the frozen target ids. */
    selectionCountsCheck: check(
      'action_recovery_previews_selection_counts_check',
      sql`${table.unavailableCount} >= 0 AND ${table.verifiedCount} >= 0 AND ${table.verifiedCount} <= cardinality(${table.targetMessageIds}) AND cardinality(${table.remainingMessageIds}) <= ${table.verifiedCount} AND ${table.remainingMessageIds} <@ ${table.targetMessageIds} AND (${table.status} NOT IN ('ready', 'consumed') OR ${table.verifiedCount} = cardinality(${table.targetMessageIds}))`,
    ),
    /** Outcome names accurately describe the stored remaining set. */
    outcomeShapeCheck: check(
      'action_recovery_previews_outcome_shape_check',
      sql`${table.outcome} IS NULL OR (${table.outcome} = 'not_applied' AND cardinality(${table.targetMessageIds}) > 0 AND cardinality(${table.remainingMessageIds}) = cardinality(${table.targetMessageIds})) OR (${table.outcome} = 'partial' AND cardinality(${table.remainingMessageIds}) > 0 AND cardinality(${table.remainingMessageIds}) < cardinality(${table.targetMessageIds})) OR (${table.outcome} IN ('already_applied', 'no_change_needed') AND cardinality(${table.remainingMessageIds}) = 0) OR ${table.outcome} IN ('uncertain', 'reconnect_required', 'blocked')`,
    ),
    /** Lifecycle columns move together; no half-consumed preview is valid. */
    statusStateCheck: check(
      'action_recovery_previews_status_state_check',
      sql`(${table.status} = 'verifying' AND ${table.outcome} IS NULL AND ${table.errorCode} IS NULL AND ${table.verifiedAt} IS NULL AND ${table.consumedAt} IS NULL AND ${table.recoveryActionId} IS NULL AND ${table.confirmationFingerprint} IS NULL) OR (${table.status} = 'ready' AND ${table.outcome} IS NOT NULL AND ${table.outcome} IN ('not_applied', 'partial', 'already_applied') AND ${table.errorCode} IS NULL AND ${table.verifiedAt} IS NOT NULL AND ${table.consumedAt} IS NULL AND ${table.recoveryActionId} IS NULL AND ${table.confirmationFingerprint} IS NULL) OR (${table.status} = 'failed' AND ${table.consumedAt} IS NULL AND ${table.recoveryActionId} IS NULL AND ${table.confirmationFingerprint} IS NULL AND ((${table.outcome} IS NULL AND ${table.errorCode} IS NOT NULL) OR (${table.outcome} IS NOT NULL AND ${table.outcome} IN ('uncertain', 'reconnect_required', 'blocked') AND ${table.verifiedAt} IS NOT NULL))) OR (${table.status} = 'consumed' AND ${table.outcome} IS NOT NULL AND ${table.outcome} IN ('not_applied', 'partial', 'already_applied', 'no_change_needed') AND ${table.errorCode} IS NULL AND ${table.verifiedAt} IS NOT NULL AND ${table.consumedAt} IS NOT NULL AND ((${table.outcome} IN ('not_applied', 'partial', 'already_applied') AND ${table.recoveryActionId} IS NOT NULL AND ${table.confirmationFingerprint} IS NOT NULL) OR (${table.outcome} = 'no_change_needed' AND ${table.recoveryActionId} IS NULL AND ${table.confirmationFingerprint} IS NULL)))`,
    ),
    timestampOrderCheck: check(
      'action_recovery_previews_timestamp_order_check',
      sql`${table.expiresAt} > ${table.createdAt} AND ${table.updatedAt} >= ${table.createdAt} AND (${table.verifiedAt} IS NULL OR ${table.verifiedAt} >= ${table.createdAt}) AND (${table.consumedAt} IS NULL OR ${table.consumedAt} >= COALESCE(${table.verifiedAt}, ${table.createdAt}))`,
    ),
    recoveryActionDistinctCheck: check(
      'action_recovery_previews_recovery_action_distinct_check',
      sql`${table.recoveryActionId} IS NULL OR (${table.recoveryActionId} <> ${table.rootActionId} AND ${table.recoveryActionId} <> ${table.currentActionId})`,
    ),
  }),
);

export type ActionRecoveryPreview = typeof actionRecoveryPreviews.$inferSelect;
export type NewActionRecoveryPreview = typeof actionRecoveryPreviews.$inferInsert;
export type ActionRecoveryPreviewStatus = (typeof actionRecoveryPreviewStatus.enumValues)[number];
export type ActionRecoveryOutcome = (typeof actionRecoveryOutcome.enumValues)[number];
