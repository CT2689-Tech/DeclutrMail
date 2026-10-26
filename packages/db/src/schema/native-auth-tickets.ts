import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { activeSessions } from './active-sessions';
import { users } from './users';

/**
 * One-time tickets for the native app's sign-in handoff (ADR-0049).
 *
 * The app shell cannot run Google OAuth in its own WebView, so the system
 * browser runs it and the two sides meet through one of these rows. Two kinds:
 *
 *   - `handoff`       the browser finished sign-in; the app redeems it with
 *                     the PKCE verifier to get its own session cookies.
 *   - `connect_start` the signed-in app asks the browser to add or recover a
 *                     Gmail account; the ticket stands in for the app's
 *                     session, which the browser does not have.
 *
 * Only the SHA-256 of the one-time code is stored, so a read of this table
 * yields nothing redeemable, and neither kind holds a token. A ticket is
 * consumed by a single `DELETE … RETURNING`: a replay finds no row. Rows are
 * minutes old at most (`expires_at`) and the next write sweeps the expired
 * ones. They hold no Gmail data: ids, a PKCE challenge, an app path, and the
 * mailbox-recovery targets the caller already owns.
 *
 * Both session and user cascade, so account deletion (D232) and a deleted
 * session take their open tickets with them.
 */
export const nativeAuthTickets = pgTable(
  'native_auth_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    /** SHA-256 hex of the one-time code. The code itself is never stored. */
    codeHash: text('code_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * `handoff`: the session the redeem rotates into the app's own tokens.
     * `connect_start`: the app session the browser flow acts for.
     */
    sessionId: uuid('session_id')
      .notNull()
      .references(() => activeSessions.id, { onDelete: 'cascade' }),
    /** `handoff` only: base64url SHA-256 of the app's PKCE verifier. */
    codeChallenge: text('code_challenge'),
    /** `handoff` only: the app path the server decided to land on. */
    returnTo: text('return_to'),
    /** `connect_start` only: reconnect / reactivate / billing-return targets. */
    options: jsonb('options'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    expiresIdx: index('native_auth_tickets_expires_at_idx').on(table.expiresAt),
    /** Cascade deletes from users and active_sessions find their tickets by index. */
    userIdx: index('native_auth_tickets_user_id_idx').on(table.userId),
    sessionIdx: index('native_auth_tickets_session_id_idx').on(table.sessionId),
    kindCheck: check(
      'native_auth_tickets_kind_check',
      sql`${table.kind} IN ('handoff', 'connect_start')`,
    ),
    /** Each kind carries exactly its own fields, so a half-formed ticket cannot exist. */
    shapeCheck: check(
      'native_auth_tickets_shape_check',
      sql`(${table.kind} = 'handoff' AND ${table.codeChallenge} IS NOT NULL AND ${table.returnTo} IS NOT NULL AND ${table.options} IS NULL) OR (${table.kind} = 'connect_start' AND ${table.codeChallenge} IS NULL AND ${table.returnTo} IS NULL)`,
    ),
  }),
);

export type NativeAuthTicket = typeof nativeAuthTickets.$inferSelect;
export type NewNativeAuthTicket = typeof nativeAuthTickets.$inferInsert;
