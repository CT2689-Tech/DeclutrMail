import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
    /**
     * Launch waitlist kind (`pro`) or null for a provider-capture row.
     * Distinct from `tier_interest`, which is the marketing-form enum.
     */
    tier: text('tier'),
    /** User-picked provider, or the classifier result when they didn't pick one. */
    provider: text('provider'),
    wouldPay: boolean('would_pay'),
    contactOptIn: boolean('contact_opt_in').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /**
     * One row per address, launch tier, and provider. The older
     * unique(email) is dropped in 0091 so a second kind can be stored.
     */
    emailTierProviderUniq: uniqueIndex('waitlist_email_tier_provider_uniq').on(
      table.email,
      sql`coalesce(${table.tier}, '')`,
      sql`coalesce(${table.provider}, '')`,
    ),
  }),
);

export type WaitlistEntry = typeof waitlist.$inferSelect;
export type NewWaitlistEntry = typeof waitlist.$inferInsert;
