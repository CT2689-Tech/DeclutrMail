import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { citext } from './_custom-types';
import { workspaceTier } from './workspaces';

/**
 * Waitlist — pre-signup email capture from the marketing site.
 *
 * `email` is citext (same as `users.email`) so casing never creates a
 * duplicate signup; the unique index doubles as the hot lookup for the
 * "already on the list" check at submit time.
 *
 * `tier_interest` reuses the `workspace_tier` enum — captured when the
 * signup came from a tier-specific CTA (e.g. the Pro card on /pricing);
 * null for the generic form.
 *
 * `source` is the free-form attribution string (`pricing`, `reddit`,
 * UTM-derived, …); null when not captured.
 *
 * Append-only; rows are read for launch invites + founding-member
 * outreach (D126 first-250 list ordering by `created_at`).
 *
 * No body data; no privacy concerns — an email address the visitor
 * explicitly submitted, nothing else.
 */

export const waitlist = pgTable(
  'waitlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull(),
    /** Tier the signup expressed interest in; null for the generic form. */
    tierInterest: workspaceTier('tier_interest'),
    /** Free-form attribution (`pricing`, `reddit`, utm_source value, …). */
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /** Case-insensitive dedup + the submit-time "already signed up" lookup. */
    emailUniq: uniqueIndex('waitlist_email_uniq').on(table.email),
  }),
);

export type WaitlistEntry = typeof waitlist.$inferSelect;
export type NewWaitlistEntry = typeof waitlist.$inferInsert;
