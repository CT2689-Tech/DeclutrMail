import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { activityLog } from './activity-log';
import { briefRuns } from './brief-runs';
import { followupTracker } from './followup-tracker';
import { mailboxAccounts } from './mailbox-accounts';
import { users } from './users';
import { workspaces } from './workspaces';

/** D246 first-party, closed-vocabulary feedback surfaces. */
export const productFeedbackSurface = pgEnum('product_feedback_surface', [
  'activity',
  'brief',
  'followups',
]);

/** Ratings shared by the three D246 feedback surfaces. */
export const productFeedbackRating = pgEnum('product_feedback_rating', [
  'expected',
  'surprising',
  'useful',
  'not_useful',
  'wrong_reason',
  'not_followup',
]);

/**
 * Durable product feedback for a concrete Activity, Brief, or Followup row.
 *
 * The target is modelled with typed foreign keys instead of a polymorphic UUID.
 * A CHECK makes `surface` discriminate both the one populated target column and
 * its permitted rating vocabulary. One partial unique index per surface makes
 * submission idempotent for a user and target while allowing another user in a
 * future shared workspace to rate the same target independently.
 *
 * Privacy (D7/D228): this table stores a closed rating and internal references
 * only. It cannot carry prose, sender addresses, subjects, or message content.
 */
export const productFeedback = pgTable(
  'product_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    surface: productFeedbackSurface('surface').notNull(),
    rating: productFeedbackRating('rating').notNull(),
    activityLogId: uuid('activity_log_id').references(() => activityLog.id, {
      onDelete: 'cascade',
    }),
    briefRunId: uuid('brief_run_id').references(() => briefRuns.id, {
      onDelete: 'cascade',
    }),
    followupTrackerId: uuid('followup_tracker_id').references(() => followupTracker.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    surfaceTargetRatingCheck: check(
      'product_feedback_surface_target_rating_check',
      sql`(${table.surface} = 'activity' AND ${table.activityLogId} IS NOT NULL AND ${table.briefRunId} IS NULL AND ${table.followupTrackerId} IS NULL AND ${table.rating} IN ('expected', 'surprising')) OR (${table.surface} = 'brief' AND ${table.activityLogId} IS NULL AND ${table.briefRunId} IS NOT NULL AND ${table.followupTrackerId} IS NULL AND ${table.rating} IN ('useful', 'not_useful', 'wrong_reason')) OR (${table.surface} = 'followups' AND ${table.activityLogId} IS NULL AND ${table.briefRunId} IS NULL AND ${table.followupTrackerId} IS NOT NULL AND ${table.rating} IN ('useful', 'not_followup'))`,
    ),
    userActivityUniq: uniqueIndex('product_feedback_user_activity_uniq')
      .on(table.userId, table.activityLogId)
      .where(sql`${table.surface} = 'activity'`),
    userBriefUniq: uniqueIndex('product_feedback_user_brief_uniq')
      .on(table.userId, table.briefRunId)
      .where(sql`${table.surface} = 'brief'`),
    userFollowupUniq: uniqueIndex('product_feedback_user_followup_uniq')
      .on(table.userId, table.followupTrackerId)
      .where(sql`${table.surface} = 'followups'`),
    mailboxSurfaceCreatedIdx: index('product_feedback_mailbox_surface_created_idx').on(
      table.mailboxAccountId,
      table.surface,
      table.createdAt,
    ),
  }),
);

export type ProductFeedback = typeof productFeedback.$inferSelect;
export type NewProductFeedback = typeof productFeedback.$inferInsert;
export type ProductFeedbackSurface = (typeof productFeedbackSurface.enumValues)[number];
export type ProductFeedbackRating = (typeof productFeedbackRating.enumValues)[number];
