import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { actionJobs } from './action-jobs';
import { mailboxAccounts } from './mailbox-accounts';
import { oauthGrants } from './oauth-grants';
import { users } from './users';
import { workspaces } from './workspaces';

/** The five verbs a preview can carry (the product's K/A/U/L/D). */
export const ACTION_PREVIEW_VERBS = ['keep', 'archive', 'unsubscribe', 'later', 'delete'] as const;
export type ActionPreviewVerb = (typeof ACTION_PREVIEW_VERBS)[number];

/** What Unsubscribe may do with the senders' existing email in the same confirmation. */
export const ACTION_PREVIEW_ALSO_VERBS = ['archive', 'delete'] as const;
export type ActionPreviewAlsoVerb = (typeof ACTION_PREVIEW_ALSO_VERBS)[number];

export const ACTION_PREVIEW_STATES = ['pending', 'confirmed', 'applied'] as const;
export type ActionPreviewState = (typeof ACTION_PREVIEW_STATES)[number];

/** Why a sender in a confirmed preview was not acted on. */
export const ACTION_PREVIEW_SKIP_REASONS = [
  'protected',
  'not_found',
  'in_progress',
  'mailto',
  'no_channel',
  'unknown',
  'failed',
] as const;
export type ActionPreviewSkipReason = (typeof ACTION_PREVIEW_SKIP_REASONS)[number];

/**
 * What applying a preview did. Counts, sender ids and reason codes only —
 * never a subject, an address or an unsubscribe link (spec §7).
 */
export interface ActionPreviewResult {
  /** Which status route `action_id` belongs to; null when no job was started. */
  handle: 'action' | 'batch' | null;
  /** Senders the verb was applied to. */
  appliedSenders: number;
  /** Emails the started action was asked to move, as counted at enqueue. */
  requestedEmails: number;
  skipped: Array<{ senderId: string; reason: ActionPreviewSkipReason }>;
}

/**
 * A cleanup an assistant asked for, waiting for a person (ADR-0048 rule 1,
 * spec §3 and §7).
 *
 * `preview_cleanup` writes the row; nothing changes in Gmail until the
 * person presses the verb on DeclutrMail's confirm page, which moves it
 * `pending → confirmed → applied`. A start refused for a reason the person
 * must act on (the monthly limit, say) moves it back to `pending` with
 * `refused_code` set: that press is spent. The model holds the id and cannot
 * confirm it. `sender_ids` is frozen when the preview is made: a sender
 * that was Protected or unknown then is not in it, and one that becomes
 * Protected later is skipped when the action is enqueued.
 *
 * Privacy (CLAUDE.md §2.1): sender ids and counts. No subject, snippet,
 * address or message id.
 */
export const actionPreviews = pgTable(
  'action_previews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The connected app that asked. Disconnecting it removes what it asked for. */
    grantId: uuid('grant_id')
      .notNull()
      .references(() => oauthGrants.id, { onDelete: 'cascade' }),
    verb: text('verb').$type<ActionPreviewVerb>().notNull(),
    /** Unsubscribe only: Archive or Delete the senders' existing email too. */
    alsoVerb: text('also_verb').$type<ActionPreviewAlsoVerb>(),
    olderThanDays: integer('older_than_days'),
    wakeAt: timestamp('wake_at', { withTimezone: true, mode: 'date' }),
    senderIds: uuid('sender_ids').array().notNull(),
    emailCount: integer('email_count').notNull(),
    state: text('state').$type<ActionPreviewState>().notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'date' }),
    /**
     * Set by the one request that is starting the action for a confirmed
     * preview. A lease, not a lock: it lapses after two minutes, so a
     * request that died holding it does not strand the preview.
     */
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
    appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'date' }),
    /** The action or batch the confirmation started, when the verb starts one. */
    actionId: uuid('action_id').references(() => actionJobs.id, { onDelete: 'set null' }),
    result: jsonb('result').$type<ActionPreviewResult>(),
    /** Why the last press could not start it (a tool error code); pending only. */
    refusedCode: text('refused_code'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    /** FK cascade indexes (mig 0073 rule): parent deletes must not seq-scan. */
    index('action_previews_workspace_id_idx').on(t.workspaceId),
    /** Also the disconnect path, which deletes a mailbox's previews. */
    index('action_previews_mailbox_account_id_idx').on(t.mailboxAccountId),
    index('action_previews_user_id_idx').on(t.userId),
    index('action_previews_grant_id_idx').on(t.grantId),
    index('action_previews_action_id_idx')
      .on(t.actionId)
      .where(sql`${t.actionId} IS NOT NULL`),
    /** Retention sweep: expiry + 1 day. */
    index('action_previews_expires_at_idx').on(t.expiresAt),
    check(
      'action_previews_verb_check',
      sql`${t.verb} IN ('keep', 'archive', 'unsubscribe', 'later', 'delete')`,
    ),
    check('action_previews_state_check', sql`${t.state} IN ('pending', 'confirmed', 'applied')`),
    check(
      'action_previews_also_verb_check',
      sql`${t.alsoVerb} IS NULL OR (${t.verb} = 'unsubscribe' AND ${t.alsoVerb} IN ('archive', 'delete'))`,
    ),
    check(
      'action_previews_window_check',
      sql`${t.olderThanDays} IS NULL OR (${t.olderThanDays} IN (30, 90, 180, 365) AND (${t.verb} IN ('archive', 'later', 'delete') OR ${t.alsoVerb} IS NOT NULL))`,
    ),
    check('action_previews_wake_at_check', sql`(${t.verb} = 'later') = (${t.wakeAt} IS NOT NULL)`),
    check(
      'action_previews_selection_check',
      sql`cardinality(${t.senderIds}) BETWEEN 1 AND 1000 AND ${t.emailCount} >= 0`,
    ),
    check(
      'action_previews_lifecycle_check',
      sql`(${t.state} = 'pending' AND ${t.confirmedAt} IS NULL AND ${t.appliedAt} IS NULL AND ${t.actionId} IS NULL AND ${t.result} IS NULL) OR (${t.state} = 'confirmed' AND ${t.confirmedAt} IS NOT NULL AND ${t.appliedAt} IS NULL AND ${t.actionId} IS NULL AND ${t.result} IS NULL) OR (${t.state} = 'applied' AND ${t.confirmedAt} IS NOT NULL AND ${t.appliedAt} IS NOT NULL AND ${t.result} IS NOT NULL)`,
    ),
    check(
      'action_previews_refused_check',
      sql`${t.refusedCode} IS NULL OR (${t.state} = 'pending' AND ${t.refusedCode} ~ '^[A-Z_]{1,40}$')`,
    ),
    check('action_previews_expiry_check', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export type ActionPreview = typeof actionPreviews.$inferSelect;
export type NewActionPreview = typeof actionPreviews.$inferInsert;
