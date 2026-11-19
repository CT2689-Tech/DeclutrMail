import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * In-flight OAuth authorization requests (ADR-0048 rule 4).
 *
 * Between `GET /oauth/authorize` and the person pressing Approve or Deny
 * on the consent page, the authorization-server library has to remember
 * the request: client, redirect URI, scopes, PKCE challenge, state. This
 * table is that memory, shared across Cloud Run instances. A row lives at
 * most 15 minutes and is deleted when the request resumes.
 *
 * `id_hash` is SHA-256 hex of the request's random id (the id rides in
 * the consent URL and a cookie). Not in spec §7's table list — it exists
 * because the library needs it, and holds no token, code or Gmail data.
 */
export const oauthInteractions = pgTable(
  'oauth_interactions',
  {
    idHash: text('id_hash').primaryKey(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    /** Retention sweep: expired rows. */
    index('oauth_interactions_expires_at_idx').on(t.expiresAt),
  ],
);

export type OAuthInteraction = typeof oauthInteractions.$inferSelect;
