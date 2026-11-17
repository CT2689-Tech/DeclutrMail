import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * OAuth clients (ADR-0048 rule 4, spec §7) — the apps that registered with
 * our authorization server (Claude, ChatGPT, Claude Code, Cursor, …).
 *
 * Every client is PUBLIC (`token_endpoint_auth_method = none`, PKCE S256
 * required), so there is no client secret to store here. `metadata` is the
 * client's registered RFC 7591 metadata exactly as the authorization-server
 * library validated it; `client_name` and `redirect_uris` are copied out
 * for the consent page and Settings → Connected apps.
 *
 * Not workspace-scoped: a client is an app, not a person. Rows are written
 * by an unauthenticated registration request, so nothing here is trusted
 * for display beyond the name and the redirect host shown at consent.
 *
 * No Gmail data; D7 / D228 unchanged.
 */
export const oauthClients = pgTable(
  'oauth_clients',
  {
    clientId: text('client_id').primaryKey(),
    clientName: text('client_name'),
    redirectUris: text('redirect_uris').array().notNull(),
    /** How the client came to exist. `dynamic` = RFC 7591 registration. */
    registrationType: text('registration_type').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check('oauth_clients_registration_type_check', sql`${t.registrationType} IN ('dynamic')`),
  ],
);

export type OAuthClient = typeof oauthClients.$inferSelect;
export type NewOAuthClient = typeof oauthClients.$inferInsert;
