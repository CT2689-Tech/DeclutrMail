// Complimentary tier grants — the ONE place the comp semantics live.
//
// A grant is a FLOOR on `workspaces.tier`, never a replacement. Every
// path that recomputes a workspace's tier resolves it as the max rank
// of (granting subscriptions, live grant, 'free'):
//
//   - BillingWebhookService.recomputeWorkspaceTier  (per-workspace, TS)
//   - runBillingReconciliationSweep                 (all workspaces, SQL)
//   - AuthSignupOrchestrator                        (at bootstrap)
//
// The floor is what makes the two compose the right way round. Comped
// Pro who later buys Plus stays Pro; a comp that expires drops them to
// the Plus they pay for, not to Free. A grant that merely OVERWROTE
// the tier would lose the paid entitlement on expiry.
//
// It is also why the grant lives in a table the recomputes consult
// rather than in a hand-written `UPDATE workspaces SET tier`. That
// write looks durable — the sweep's `WHERE EXISTS` spares a workspace
// with no subscription rows — right up until the comped person opens a
// checkout. The first subscription row makes them visible to a
// recompute that knows nothing about the comp, and they drop to Free
// with no event to notice it by.
//
// Grants are keyed on EMAIL so one can be written before that person
// has ever signed up. A workspace inherits the highest live grant held
// by any of its users.

import { TIER_RANK, type TierId } from '@declutrmail/shared/entitlements';
import { entitlementGrants, users } from '@declutrmail/db';
import { and, eq, isNull, or, gt, sql, type SQL } from 'drizzle-orm';

import type { DrizzleDb } from '../../db/db.module.js';

/**
 * `ORDER BY <this> DESC LIMIT 1` picks the highest tier in a set.
 *
 * Derived from `TIER_RANK` rather than hand-written, because the two
 * recompute paths each need this ordering and a hardcoded CASE in
 * either one is a silent drift waiting to happen — a tier added to the
 * manifest without a rank here would sort below Free and quietly stop
 * granting.
 */
export const tierRankSql = (column: SQL | string): SQL => {
  const col = typeof column === 'string' ? sql.raw(column) : column;
  const branches = Object.entries(TIER_RANK).map(
    ([tier, rank]) => sql`WHEN ${tier} THEN ${sql.raw(String(rank))}`,
  );
  return sql`CASE ${col} ${sql.join(branches, sql` `)} ELSE 0 END`;
};

/**
 * Rows a workspace's live grants contribute to a tier recompute.
 *
 * LIVE = not revoked and not past its expiry. `workspaceIdExpr` is
 * raw SQL naming the workspace column in the caller's statement
 * (`'w.id'` inside the sweep's `UPDATE workspaces w`), so the
 * correlated join is written by the caller's own alias — a bare column
 * name here would degenerate into a tautology under the `sql` template
 * (the known drizzle correlated-subquery trap).
 */
export const liveGrantTiersSql = (workspaceIdExpr: string): SQL => sql`
  SELECT g.tier AS t
  FROM entitlement_grants g
  JOIN users u ON u.email = g.email
  WHERE u.workspace_id = ${sql.raw(workspaceIdExpr)}
    AND g.revoked_at IS NULL
    AND (g.expires_at IS NULL OR g.expires_at > now())
`;

/**
 * The highest tier a workspace is comped to, or null when it holds no
 * live grant. Used by the TS recompute path and by signup.
 */
export async function liveGrantTierForWorkspace(
  db: Pick<DrizzleDb, 'select'>,
  workspaceId: string,
): Promise<TierId | null> {
  return (await highestLiveGrantForWorkspace(db, workspaceId))?.tier ?? null;
}

/**
 * The workspace's highest live grant, with its expiry — what the
 * Billing screen names as complimentary. Returns the GRANT, so a
 * workspace whose paid tier already sits above its comp still reports
 * the comp it actually holds.
 */
export async function highestLiveGrantForWorkspace(
  db: Pick<DrizzleDb, 'select'>,
  workspaceId: string,
): Promise<{ tier: TierId; expiresAt: Date | null } | null> {
  const rows = await db
    .select({ tier: entitlementGrants.tier, expiresAt: entitlementGrants.expiresAt })
    .from(entitlementGrants)
    .innerJoin(users, eq(users.email, entitlementGrants.email))
    .where(
      and(
        eq(users.workspaceId, workspaceId),
        isNull(entitlementGrants.revokedAt),
        or(isNull(entitlementGrants.expiresAt), gt(entitlementGrants.expiresAt, new Date())),
      ),
    );
  let best: { tier: TierId; expiresAt: Date | null } | null = null;
  for (const row of rows) {
    if (best === null || TIER_RANK[row.tier] > TIER_RANK[best.tier]) best = row;
  }
  return best;
}

/**
 * The highest tier an EMAIL is comped to, for the signup path — the
 * workspace does not exist yet when this is asked.
 */
export async function liveGrantTierForEmail(
  db: Pick<DrizzleDb, 'select'>,
  email: string,
): Promise<TierId | null> {
  const rows = await db
    .select({ tier: entitlementGrants.tier })
    .from(entitlementGrants)
    .where(
      and(
        eq(entitlementGrants.email, email),
        isNull(entitlementGrants.revokedAt),
        or(isNull(entitlementGrants.expiresAt), gt(entitlementGrants.expiresAt, new Date())),
      ),
    );
  return highestTier(rows.map((r) => r.tier));
}

/** Max by manifest rank; null for an empty set (no grant, not Free). */
function highestTier(tiers: TierId[]): TierId | null {
  let best: TierId | null = null;
  for (const tier of tiers) {
    if (best === null || TIER_RANK[tier] > TIER_RANK[best]) best = tier;
  }
  return best;
}

/** Whichever of the two is higher; the grant only ever raises. */
export function applyGrantFloor(billingTier: TierId, grantTier: TierId | null): TierId {
  if (grantTier === null) return billingTier;
  return TIER_RANK[grantTier] > TIER_RANK[billingTier] ? grantTier : billingTier;
}
