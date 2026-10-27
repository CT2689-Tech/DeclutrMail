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

import { citext } from './_custom-types';
import { billingRegion } from './billing-customers';
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
    /**
     * D113 — set to `now()` when the user completes onboarding Step 5
     * (or skips onboarding per D106). Null = onboarding not finished;
     * the web app routes such users back into the flow.
     */
    onboardedAt: timestamp('onboarded_at', { withTimezone: true, mode: 'date' }),
    /**
     * IANA timezone, e.g. `Asia/Kolkata` (D64). Captured from the
     * browser; drives the Brief's 8am-local delivery slot. Null until
     * first captured — consumers fall back to UTC.
     */
    timezone: text('timezone'),
    /**
     * D117 — billing-provider routing ('india' → Razorpay, else
     * Paddle). Auto-detected from IP at signup; user can override in
     * Settings → Account. Null until first detected.
     */
    billingRegion: billingRegion('billing_region'),
    /**
     * First-touch tracked channel from `?ref=` (marketing runbook Phase B).
     * Set-once at signup insert. Allowlist lives in
     * `@declutrmail/shared/contracts` `SIGNUP_ATTRIBUTION_REFS`. Not Gmail data.
     */
    signupAttributionRef: text('signup_attribution_ref'),
    /**
     * Self-reported "How did you first hear about us?" — separate from
     * tracked `ref`. The two disagree on purpose. `skipped` means they
     * dismissed the prompt; do not ask again.
     */
    signupAttributionHeardFrom: text('signup_attribution_heard_from'),
    /** Free-text only when heard_from = 'other'. */
    signupAttributionHeardDetail: text('signup_attribution_heard_detail'),
    /** First-touch utm_source. Set-once at signup. Not an email address. */
    signupAttributionUtmSource: text('signup_attribution_utm_source'),
    /** First-touch utm_medium. Set-once at signup. */
    signupAttributionUtmMedium: text('signup_attribution_utm_medium'),
    /** First-touch utm_campaign. Set-once at signup. */
    signupAttributionUtmCampaign: text('signup_attribution_utm_campaign'),
    /** Pathname of the first attributed landing. No query string. */
    signupAttributionLandingPath: text('signup_attribution_landing_path'),
    /**
     * AI processing consent (launch). Null until the user chooses.
     * Active explanations: version matches, consent_at set, revoked_at
     * null, and `explanations` is in scopes. Brief is the same shape on
     * its own columns. A version mismatch re-asks and is not active.
     */
    aiConsentVersion: text('ai_consent_version'),
    aiExplanationsConsentAt: timestamp('ai_explanations_consent_at', {
      withTimezone: true,
      mode: 'date',
    }),
    aiExplanationsRevokedAt: timestamp('ai_explanations_revoked_at', {
      withTimezone: true,
      mode: 'date',
    }),
    aiConsentScopes: text('ai_consent_scopes').array(),
    aiConsentDeclinedAt: timestamp('ai_consent_declined_at', {
      withTimezone: true,
      mode: 'date',
    }),
    briefAiConsentAt: timestamp('brief_ai_consent_at', { withTimezone: true, mode: 'date' }),
    briefAiConsentVersion: text('brief_ai_consent_version'),
    briefAiConsentRevokedAt: timestamp('brief_ai_consent_revoked_at', {
      withTimezone: true,
      mode: 'date',
    }),
    briefAiDeclinedAt: timestamp('brief_ai_declined_at', { withTimezone: true, mode: 'date' }),
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
    signupAttributionRefCheck: check(
      'users_signup_attribution_ref_chk',
      sql`${table.signupAttributionRef} IS NULL OR ${table.signupAttributionRef} IN ('hn', 'ph', 'reddit', 'simulator', 'x', 'linkedin')`,
    ),
    signupAttributionHeardFromCheck: check(
      'users_signup_attribution_heard_from_chk',
      sql`${table.signupAttributionHeardFrom} IS NULL OR ${table.signupAttributionHeardFrom} IN ('hn', 'ph', 'reddit', 'simulator', 'x', 'linkedin', 'friend', 'other', 'skipped', 'google', 'ai_assistant', 'youtube', 'instagram', 'tiktok')`,
    ),
    signupAttributionHeardDetailCheck: check(
      'users_signup_attribution_heard_detail_chk',
      sql`(${table.signupAttributionHeardDetail} IS NULL AND ${table.signupAttributionHeardFrom} IS DISTINCT FROM 'other') OR (${table.signupAttributionHeardFrom} = 'other' AND ${table.signupAttributionHeardDetail} IS NOT NULL AND char_length(${table.signupAttributionHeardDetail}) BETWEEN 1 AND 200)`,
    ),
    signupAttributionUtmSourceCheck: utmCheck(
      'users_signup_attribution_utm_source_chk',
      table.signupAttributionUtmSource,
    ),
    signupAttributionUtmMediumCheck: utmCheck(
      'users_signup_attribution_utm_medium_chk',
      table.signupAttributionUtmMedium,
    ),
    signupAttributionUtmCampaignCheck: utmCheck(
      'users_signup_attribution_utm_campaign_chk',
      table.signupAttributionUtmCampaign,
    ),
    signupAttributionLandingPathCheck: check(
      'users_signup_attribution_landing_path_chk',
      sql`${table.signupAttributionLandingPath} IS NULL OR (char_length(${table.signupAttributionLandingPath}) BETWEEN 1 AND 200 AND ${table.signupAttributionLandingPath} LIKE '/%' AND strpos(${table.signupAttributionLandingPath}, '@') = 0 AND strpos(${table.signupAttributionLandingPath}, '?') = 0 AND strpos(${table.signupAttributionLandingPath}, '#') = 0 AND strpos(${table.signupAttributionLandingPath}, ' ') = 0)`,
    ),
  }),
);

function utmCheck(name: string, column: AnyPgColumn) {
  return check(
    name,
    sql`${column} IS NULL OR (char_length(${column}) BETWEEN 1 AND 64 AND strpos(${column}, '@') = 0 AND strpos(${column}, '?') = 0 AND strpos(${column}, '#') = 0 AND strpos(${column}, ' ') = 0 AND strpos(${column}, '/') = 0)`,
  );
}

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
