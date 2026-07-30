import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { subscriptions, workspaces, pendingCheckouts, schema } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { runBillingReconciliationSweep } from '../billing-reconciliation.sweep.js';
import type { DrizzleDb } from '../../db/db.module.js';

const MIGRATIONS_DIR = join(
  import.meta.dirname ?? __dirname,
  '../../../../../packages/db/migrations',
);

async function freshDb(): Promise<DrizzleDb> {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sqlText.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) await pg.exec(trimmed);
    }
  }
  return drizzle(pg, { schema }) as unknown as DrizzleDb;
}

async function seedWorkspace(db: DrizzleDb, tier: 'free' | 'plus' | 'pro'): Promise<string> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'sweep-test', tier })
    .returning({ id: workspaces.id });
  return ws!.id;
}

describe('runBillingReconciliationSweep', () => {
  let db: DrizzleDb;

  beforeEach(async () => {
    db = await freshDb();
  });

  it('drops a STALE refund entitlement — no recency bound (Codex stop-review 2026-07-29)', async () => {
    // The regression: an ACTIVE row carrying a refund verdict written
    // long ago, whose entitlement deadline passed last week, and whose
    // updated_at is 40 days old. The first sweep version bounded the
    // recompute to rows updated in the last 30 days — this exact row
    // slipped through and the workspace kept pro forever.
    const wsId = await seedWorkspace(db, 'pro');
    await db.insert(subscriptions).values({
      workspaceId: wsId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_stale_refund',
      tier: 'pro',
      status: 'active',
      providerPriceId: 'pri_x',
      billingCycle: 'monthly',
      cancelSource: 'refund',
      entitlementEndsAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    });

    const result = await runBillingReconciliationSweep(db);

    expect(result.workspacesRecomputed).toBe(1);
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    expect(ws!.tier).toBe('free');
    // Refund rows keep their provider status — only the TIER drops;
    // status is the provider's to change.
    const [row] = await db.select().from(subscriptions);
    expect(row!.status).toBe('active');
  });

  it('flips expired-dunning past_due rows to canceled and recomputes', async () => {
    const wsId = await seedWorkspace(db, 'plus');
    await db.insert(subscriptions).values({
      workspaceId: wsId,
      provider: 'razorpay',
      providerSubscriptionId: 'sub_dunning',
      tier: 'plus',
      status: 'past_due',
      providerPriceId: 'pri_y',
      billingCycle: 'monthly',
      entitlementEndsAt: new Date(Date.now() - 60 * 1000),
    });

    const result = await runBillingReconciliationSweep(db);

    expect(result.dunningFlipped).toBe(1);
    const [row] = await db.select().from(subscriptions);
    expect(row!.status).toBe('canceled');
    expect(row!.cancelSource).toBe('provider');
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    expect(ws!.tier).toBe('free');
  });

  it('leaves healthy rows and future deadlines alone', async () => {
    const wsId = await seedWorkspace(db, 'pro');
    await db.insert(subscriptions).values({
      workspaceId: wsId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_healthy',
      tier: 'pro',
      status: 'active',
      providerPriceId: 'pri_z',
      billingCycle: 'annual',
    });
    await db.insert(subscriptions).values({
      workspaceId: wsId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_future_dunning',
      tier: 'pro',
      status: 'paused',
      providerPriceId: 'pri_z2',
      billingCycle: 'monthly',
      entitlementEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });

    const result = await runBillingReconciliationSweep(db);
    expect(result.dunningFlipped).toBe(0);
    expect(result.workspacesRecomputed).toBe(0);
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    expect(ws!.tier).toBe('pro');
  });

  it('clears claims expired >7 days; RETAINS freshly-expired ones (stale-lock reconciliation)', async () => {
    // D249 (Codex 2026-07-30): a freshly-expired claim is no longer
    // deleted — its provider_ref is the only exact link a stale
    // browser lock has to a still-payable Razorpay artifact. Expiry
    // already re-arms checkout via the claim upsert; deletion is pure
    // housekeeping and can wait 7 days.
    const wsOld = await seedWorkspace(db, 'free');
    const wsFresh = await seedWorkspace(db, 'free');
    const wsLive = await seedWorkspace(db, 'free');
    await db.insert(pendingCheckouts).values([
      {
        workspaceId: wsOld,
        provider: 'paddle',
        tier: 'pro',
        billingCycle: 'annual',
        expiresAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
      },
      {
        workspaceId: wsFresh,
        provider: 'razorpay',
        tier: 'plus',
        billingCycle: 'monthly',
        providerRef: 'sub_stale_lock_link',
        expiresAt: new Date(Date.now() - 1000),
      },
      {
        workspaceId: wsLive,
        provider: 'razorpay',
        tier: 'plus',
        billingCycle: 'monthly',
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);

    const result = await runBillingReconciliationSweep(db);
    expect(result.pendingCheckoutsCleared).toBe(1);
    const remaining = await db.select().from(pendingCheckouts);
    expect(remaining.map((r) => r.workspaceId).sort()).toEqual([wsFresh, wsLive].sort());
    // The retained expired row still carries the reconciliation link.
    expect(remaining.find((r) => r.workspaceId === wsFresh)!.providerRef).toBe(
      'sub_stale_lock_link',
    );
  });
});
