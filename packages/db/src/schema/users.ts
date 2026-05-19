import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { citext } from './_custom-types';
import { workspaces } from './workspaces';

/**
 * Users — auth principals, each scoped to a workspace.
 *
 * `email` uses citext for case-insensitive uniqueness — `Foo@bar.com`
 * and `foo@bar.com` are the same identity at the DB level, no app-side
 * normalization required.
 *
 * `preferences` is the user-toggleable settings bag (D110 profile_preset,
 * brief_enabled, screener_enabled, etc.).
 *
 * `dev_preferences` is the internal-observability bag (D111) — toggled
 * via super-admin tooling, never user-facing.
 *
 * Email uniqueness is global (a user identity is one email). Workspace
 * membership is the foreign key; if a user joins a second workspace
 * post-launch (Teams), that requires a join table — deferred.
 *
 * `updated_at` is auto-bumped by the `set_updated_at` trigger declared
 * in migration 0000 — every UPDATE refreshes the timestamp without
 * app-side coordination.
 *
 * No body data; no privacy concerns.
 */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    preferences: jsonb('preferences')
      .notNull()
      .default(sql`'{}'::jsonb`),
    devPreferences: jsonb('dev_preferences')
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
    emailIdx: uniqueIndex('users_email_uniq').on(table.email),
    workspaceIdx: index('users_workspace_id_idx').on(table.workspaceId),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
