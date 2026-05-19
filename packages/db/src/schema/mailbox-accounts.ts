import { sql } from 'drizzle-orm';
import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';
import { workspaces } from './workspaces';

/**
 * Mailbox accounts — connected Gmail accounts.
 *
 * Status:
 *   - 'active'        — OAuth connected, workers running for it
 *   - 'disconnected'  — user revoked or token expired; activity_log + mail_messages
 *                       intact per D116. Re-connect resumes from last historyId.
 *
 * `quiet_state` (jsonb) — current quiet-mode state per D92/D93:
 *   { enabled, started_at, until_at, source, preview_mode_until }
 *
 * `(provider, provider_account_id)` is unique — prevents the same
 * Google account from being re-connected to two workspaces under one
 * billing relationship. Multi-account users land per workspace, not
 * per provider account.
 *
 * No body data; no Gmail content; storage allowlist per D7 honored
 * (the message + sender data lives in separate tables shipped later).
 */

export const mailboxProvider = pgEnum('mailbox_provider', ['gmail']);

export const mailboxStatus = pgEnum('mailbox_status', ['active', 'disconnected']);

export const mailboxAccounts = pgTable(
  'mailbox_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: mailboxProvider('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    status: mailboxStatus('status').notNull().default('active'),
    quietState: jsonb('quiet_state')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    providerAccountUniq: uniqueIndex('mailbox_accounts_provider_account_uniq').on(
      table.provider,
      table.providerAccountId,
    ),
  }),
);

export type MailboxAccount = typeof mailboxAccounts.$inferSelect;
export type NewMailboxAccount = typeof mailboxAccounts.$inferInsert;
