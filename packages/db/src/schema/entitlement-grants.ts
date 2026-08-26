import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { citext } from './_custom-types';
import { workspaceTier } from './workspaces';

/**
 * Entitlement grants — complimentary tier, granted by DeclutrMail
 * rather than bought.
 *
 * Keyed on EMAIL, not workspace, so a grant can be written before that
 * person has ever signed up: signup reads this table when it
 * bootstraps the workspace, and a grant written afterwards is applied
 * to the existing workspace by the same resolver. `email` is citext
 * (same as `users.email`) so casing can never split one identity into
 * two grants.
 *
 * THE GRANT IS A FLOOR, NEVER A REPLACEMENT. Both tier-recompute paths
 * — `BillingWebhookService.recomputeWorkspaceTier` and the worker's
 * reconciliation sweep — resolve `workspaces.tier` as the max rank of
 * (granting subscriptions, live grant). That is the whole reason this
 * table exists instead of a hand-written `UPDATE workspaces SET tier`:
 * a bare tier write survives right up until the comped person opens
 * checkout, because the first subscription row makes them visible to a
 * recompute that knows nothing about the comp and falls back to
 * 'free'. Resolving as a floor also makes the two compose the right
 * way round — comped Pro who later buys Plus stays Pro, and a comp
 * that expires drops them to their paid Plus rather than to Free.
 *
 * `expires_at` is nullable and defaults to unset: a friend or advisor
 * gets a permanent comp, a beta cohort gets a date. An expired row is
 * kept, not deleted — the trail of who was comped and when it ended is
 * the point (same posture as FOUNDER-FOLLOWUPS: entries move state,
 * they don't vanish).
 *
 * `revoked_at` is the manual counterpart: pulling a comp before its
 * expiry without destroying the record of it. A row is LIVE when
 * `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`.
 *
 * `reason` and `granted_by` are required. A comp with no stated reason
 * is indistinguishable, six months on, from a tier someone set by
 * mistake.
 *
 * No body data; no privacy concerns — an email address and a tier.
 */

export const entitlementGrants = pgTable(
  'entitlement_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull(),
    /** Tier this grant floors the workspace at; same enum as `workspaces.tier`. */
    tier: workspaceTier('tier').notNull(),
    /** Why this comp exists — free-form ('advisor', 'beta cohort 3', …). */
    reason: text('reason').notNull(),
    /** Who granted it — a founder/operator identifier, not an app principal. */
    grantedBy: text('granted_by').notNull(),
    /** Null = permanent. Past = stopped granting; the row is kept as trail. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    /** Set to revoke before expiry without deleting the record. */
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /**
     * One grant per email. Re-granting an email UPDATES the existing
     * row (tier, reason, expiry) rather than stacking a second one —
     * two live grants for one identity would make "which comp is this
     * person on" unanswerable, and the max-rank resolve would quietly
     * pick the higher without anyone deciding.
     */
    emailUniq: uniqueIndex('entitlement_grants_email_uniq').on(table.email),
  }),
);

export type EntitlementGrant = typeof entitlementGrants.$inferSelect;
export type NewEntitlementGrant = typeof entitlementGrants.$inferInsert;
