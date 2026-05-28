import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  inet,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * Active sessions (D155) — the allowlist that backs JWT revocation.
 *
 * Every authenticated request validates the signed access JWT and then
 * looks this table up by `jti` to confirm the session has not been
 * revoked (logout, suspicious activity, password reset, etc.). The
 * lookup is Redis-cached with a 60s TTL so the per-request DB hop is
 * amortized — see `SessionsService`.
 *
 * Why an allowlist rather than a blocklist? Refresh-token rotation
 * (D155) issues a new `jti` on every refresh; the old jti must become
 * unusable immediately. A blocklist would need to grow forever or
 * carry a TTL that races the access-token lifetime; an allowlist
 * exists only while the session is live and is bounded by user count.
 *
 * `refresh_token_hash` is SHA-256(refresh_jwt) — never the raw token.
 * The DB row carries enough to *prove* a refresh attempt is current
 * but not enough to *forge* one.
 *
 * `(user_id, is_revoked)` index powers the "list my live sessions"
 * surface (D116 Privacy & Data) without scanning the whole table.
 *
 * No body data; D7 / D228 unchanged.
 */
export const activeSessions = pgTable(
  'active_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** JWT ID claim — unique per access+refresh pair issued. */
    jti: uuid('jti').notNull(),
    /** SHA-256 hex of the rotating refresh token (NEVER the raw token). */
    refreshTokenHash: text('refresh_token_hash').notNull(),
    /** IP at session start — surfaces in D116 "active sessions" list. */
    ipAddress: inet('ip_address'),
    /** Best-effort UA at session start — surfaces in D116 list. */
    userAgent: text('user_agent'),
    /**
     * Set true on logout, password reset, or admin revoke. Lookups
     * MUST check this — a signed JWT alone is not enough.
     */
    isRevoked: boolean('is_revoked').notNull().default(false),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /** Fast revoke check + JWT verify lookup. */
    jtiUniq: uniqueIndex('active_sessions_jti_uniq').on(table.jti),
    /** D116 "list active sessions" surface — scoped per user. */
    userRevokedIdx: index('active_sessions_user_revoked_idx').on(table.userId, table.isRevoked),
  }),
);

export type ActiveSession = typeof activeSessions.$inferSelect;
export type NewActiveSession = typeof activeSessions.$inferInsert;
