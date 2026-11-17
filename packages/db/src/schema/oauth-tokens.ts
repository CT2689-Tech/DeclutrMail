import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { oauthGrants } from './oauth-grants';

/**
 * OAuth access and refresh tokens (ADR-0048 rule 4, spec §7).
 *
 * `token_hash` is SHA-256 hex of the opaque 256-bit token — NEVER the
 * token. The row proves a presented token is current; it cannot be used
 * to forge one. `payload` is the authorization-server library's record of
 * the token (scope, audience, client, issue time) with the token value
 * itself removed.
 *
 * Refresh rotation: using a refresh token stamps `consumed_at` and points
 * `replaced_by` at its successor, which inherits `family_id`. Presenting a
 * consumed token again is reuse — the whole grant is revoked.
 *
 * No Gmail data; D7 / D228 unchanged.
 */
export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => oauthGrants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    tokenHash: text('token_hash').notNull(),
    /** Refresh-rotation chain id; NULL for access tokens. */
    familyId: uuid('family_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Set once, atomically, when a refresh token is exchanged. */
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
    /** The refresh token that superseded this one. */
    replacedBy: uuid('replaced_by').references((): AnyPgColumn => oauthTokens.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('oauth_tokens_token_hash_uniq').on(t.tokenHash),
    /** FK cascade index + "revoke every token of this grant". */
    index('oauth_tokens_grant_id_idx').on(t.grantId),
    index('oauth_tokens_replaced_by_idx').on(t.replacedBy),
    /** Retention sweep: expiry + 7 days. */
    index('oauth_tokens_expires_at_idx').on(t.expiresAt),
    check('oauth_tokens_kind_check', sql`${t.kind} IN ('access', 'refresh')`),
  ],
);

export type OAuthToken = typeof oauthTokens.$inferSelect;
export type NewOAuthToken = typeof oauthTokens.$inferInsert;
