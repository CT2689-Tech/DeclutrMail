// Backlog Pass grants. A Pass is a row in entitlement_grants, not a
// subscription. Comp rows are never updated here.

import { entitlementGrants, users } from '@declutrmail/db';
import { OFFERS } from '@declutrmail/shared/entitlements';
import { and, asc, eq, gt, inArray, isNotNull, isNull, or } from 'drizzle-orm';

import type { DrizzleDb } from '../db/db.module.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type PassGrantResult =
  | { status: 'granted' | 'extended' | 'duplicate'; expiresAt: Date; userId: string }
  | { status: 'no_email' };

/**
 * Insert one Pass grant for the workspace's earliest user.
 * A repeated provider transaction id is a no-op.
 * A new transaction extends from the later of now and the current live Pass.
 */
export async function grantPassFromTransaction(
  db: DrizzleDb,
  args: { workspaceId: string; providerTransactionId: string; now?: Date },
): Promise<PassGrantResult> {
  const now = args.now ?? new Date();
  const [owner] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.workspaceId, args.workspaceId))
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(1);
  if (!owner) return { status: 'no_email' };

  const live = await db
    .select({ expiresAt: entitlementGrants.expiresAt })
    .from(entitlementGrants)
    .where(
      and(
        eq(entitlementGrants.email, owner.email),
        eq(entitlementGrants.source, 'pass'),
        isNull(entitlementGrants.revokedAt),
        or(isNull(entitlementGrants.expiresAt), gt(entitlementGrants.expiresAt, now)),
      ),
    );
  let base = now.getTime();
  for (const row of live) {
    const at = row.expiresAt?.getTime();
    if (at !== undefined && at > base) base = at;
  }
  const expiresAt = new Date(base + OFFERS.backlogPass.durationDays * DAY_MS);
  const extended = live.length > 0;

  const inserted = await db
    .insert(entitlementGrants)
    .values({
      email: owner.email,
      tier: 'plus',
      reason: 'backlog_pass',
      grantedBy: 'paddle',
      source: 'pass',
      provider: 'paddle',
      providerTransactionId: args.providerTransactionId,
      expiresAt,
    })
    .onConflictDoNothing({ target: entitlementGrants.providerTransactionId })
    .returning({ id: entitlementGrants.id, expiresAt: entitlementGrants.expiresAt });

  const row = inserted[0];
  if (!row?.expiresAt) {
    const [existing] = await db
      .select({ expiresAt: entitlementGrants.expiresAt })
      .from(entitlementGrants)
      .where(eq(entitlementGrants.providerTransactionId, args.providerTransactionId))
      .limit(1);
    return { status: 'duplicate', expiresAt: existing?.expiresAt ?? expiresAt, userId: owner.id };
  }
  return { status: extended ? 'extended' : 'granted', expiresAt: row.expiresAt, userId: owner.id };
}

/** Revoke the Pass grant for one provider transaction. Missing stays missing so a retry can land. */
export async function revokePassByTransaction(
  db: DrizzleDb,
  providerTransactionId: string,
): Promise<{ status: 'revoked'; workspaceIds: string[] } | { status: 'missing' }> {
  const revoked = await db
    .update(entitlementGrants)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(entitlementGrants.providerTransactionId, providerTransactionId),
        eq(entitlementGrants.source, 'pass'),
        isNotNull(entitlementGrants.provider),
        isNull(entitlementGrants.revokedAt),
      ),
    )
    .returning({ email: entitlementGrants.email });
  let emails = revoked.map((row) => row.email);
  if (emails.length === 0) {
    const [existing] = await db
      .select({ email: entitlementGrants.email })
      .from(entitlementGrants)
      .where(
        and(
          eq(entitlementGrants.providerTransactionId, providerTransactionId),
          eq(entitlementGrants.source, 'pass'),
          isNotNull(entitlementGrants.provider),
          isNotNull(entitlementGrants.revokedAt),
        ),
      )
      .limit(1);
    if (!existing) return { status: 'missing' };
    // Revocation may have committed before tier projection failed. A retry
    // still owes every owning workspace a projection before processing the event.
    emails = [existing.email];
  }
  const workspaces = await db
    .select({ workspaceId: users.workspaceId })
    .from(users)
    .where(inArray(users.email, emails));
  return {
    status: 'revoked',
    workspaceIds: [...new Set(workspaces.map((row) => row.workspaceId))],
  };
}
