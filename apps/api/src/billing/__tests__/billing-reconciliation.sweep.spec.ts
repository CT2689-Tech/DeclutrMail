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

  it('clears expired pending checkouts, keeps live ones', async () => {
    const wsA = await seedWorkspace(db, 'free');
    const wsB = await seedWorkspace(db, 'free');
    await db.insert(pendingCheckouts).values([
      {
        workspaceId: wsA,
        provider: 'paddle',
        tier: 'pro',
        billingCycle: 'annual',
        expiresAt: new Date(Date.now() - 1000),
      },
      {
        workspaceId: wsB,
        provider: 'razorpay',
        tier: 'plus',
        billingCycle: 'monthly',
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);

    const result = await runBillingReconciliationSweep(db);
    expect(result.pendingCheckoutsCleared).toBe(1);
    const remaining = await db.select().from(pendingCheckouts);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.workspaceId).toBe(wsB);
  });
});
