import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { oauthClients } from './oauth-clients';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * OAuth grants (ADR-0048 rule 4, spec §7) — one row per "this person let
 * this app act for them" approval on the consent page.
 *
 * A grant is the unit Settings → Connected apps lists and disconnects:
 * setting `revoked_at` kills every token minted under it (the token lookup
 * joins this row). Grants have no expiry of their own — a grant lives
 * while its refresh-token chain is kept alive by use (30 days idle).
 *
 * `user_id` AND `workspace_id` both cascade: the account purge deletes
 * only the `users` row when the workspace has another member.
 *
 * No Gmail data; D7 / D228 unchanged.
 */
export const oauthGrants = pgTable(
  'oauth_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    /** Scopes the person approved (`read`, `cleanup`). */
    scopes: text('scopes').array().notNull(),
    /** RFC 8707 resource the grant's tokens are audience-bound to. */
    resource: text('resource').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    /** Settings → Connected apps list, and the FK cascade index for users. */
    index('oauth_grants_user_id_idx').on(t.userId, t.createdAt),
    /** FK cascade indexes (mig 0073 rule): parent deletes must not seq-scan. */
    index('oauth_grants_workspace_id_idx').on(t.workspaceId),
    index('oauth_grants_client_id_idx').on(t.clientId),
    /** Retention sweep: revoked + 30 days. */
    index('oauth_grants_revoked_at_idx').on(t.revokedAt),
  ],
);

export type OAuthGrant = typeof oauthGrants.$inferSelect;
export type NewOAuthGrant = typeof oauthGrants.$inferInsert;
