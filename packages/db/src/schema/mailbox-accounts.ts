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

import { bytea } from './_custom-types';
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
 * OAuth-token columns (D14 envelope encryption) — all nullable, written
 * at OAuth-connect time; rows that predate a connect have none:
 *   - `encrypted_refresh_token` — the Gmail OAuth refresh token,
 *     AES-256-GCM-encrypted under a per-record DEK.
 *   - `dek_encrypted` — that DEK, wrapped by the KMS KEK.
 *   - `key_version` — KEK version used, so rotation is traceable.
 *   - `connected_at` — when the OAuth connect completed.
 * These store OAuth credentials, not Gmail message content — the D7
 * body-storage allowlist is unaffected.
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
    encryptedRefreshToken: bytea('encrypted_refresh_token'),
    dekEncrypted: bytea('dek_encrypted'),
    keyVersion: integer('key_version'),
    connectedAt: timestamp('connected_at', { withTimezone: true, mode: 'date' }),
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
    workspaceIdx: index('mailbox_accounts_workspace_id_idx').on(table.workspaceId),
    userIdx: index('mailbox_accounts_user_id_idx').on(table.userId),
  }),
);

export type MailboxAccount = typeof mailboxAccounts.$inferSelect;
export type NewMailboxAccount = typeof mailboxAccounts.$inferInsert;
