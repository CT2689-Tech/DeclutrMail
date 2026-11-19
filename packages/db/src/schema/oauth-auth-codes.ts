import { sql } from 'drizzle-orm';
import {
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
 * OAuth authorization codes (ADR-0048 rule 4, spec §7) — the 60-second,
 * single-use code a client exchanges for tokens.
 *
 * `code_hash` is SHA-256 hex of the opaque code — NEVER the code. PKCE is
 * mandatory and S256-only, so every row carries the challenge the token
 * request must answer. `used_at` is stamped atomically on exchange; a
 * second exchange revokes the grant.
 *
 * No Gmail data; D7 / D228 unchanged.
 */
export const oauthAuthCodes = pgTable(
  'oauth_auth_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeHash: text('code_hash').notNull(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => oauthGrants.id, { onDelete: 'cascade' }),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('oauth_auth_codes_code_hash_uniq').on(t.codeHash),
    /** FK cascade index. */
    index('oauth_auth_codes_grant_id_idx').on(t.grantId),
    /** Retention sweep: expiry + 1 day. */
    index('oauth_auth_codes_expires_at_idx').on(t.expiresAt),
    check('oauth_auth_codes_challenge_method_check', sql`${t.codeChallengeMethod} = 'S256'`),
  ],
);

export type OAuthAuthCode = typeof oauthAuthCodes.$inferSelect;
export type NewOAuthAuthCode = typeof oauthAuthCodes.$inferInsert;
