import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  pendingCheckouts,
  schema,
  subscriptionEvents,
  subscriptions,
  users,
  workspaces,
} from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DrizzleDb } from '../../db/db.module.js';
import { BillingCatalog, type CatalogEntry } from '../billing-catalog.js';
import type {
  FetchSubscriptionResult,
  NormalizedSubscription,
  SubscriptionSearchQuery,
  SubscriptionSearchResult,
} from '../billing-provider.interface.js';
import { BillingReconciliationService } from '../billing-reconciliation.service.js';
import { BillingWebhookService } from '../billing-webhook.service.js';
import type { PaddleAdapter } from '../paddle.adapter.js';
import type { RazorpayAdapter } from '../razorpay.adapter.js';
import { TEST_PRICE_IDS } from './fixtures.js';

/**
 * BillingReconciliationService integration tests (D249).
 *
 * Same PGlite-with-real-migrations harness as the webhook spec — the
 * point of D249 is that reconciliation feeds the SAME projector, so
 * these tests assert real subscription rows, real tier flips, and real
 * ledger dedup, with only the provider adapters faked.
 */

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

async function freshDb(): Promise<DrizzleDb> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema }) as unknown as DrizzleDb;
}

function testCatalog(): BillingCatalog {
  const entries: CatalogEntry[] = [
    {
      planCode: 'plus_monthly',
      tierId: 'plus',
      cycle: 'monthly',
      founding: false,
      usdCents: 900,
      paddlePriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      razorpayPlanId: TEST_PRICE_IDS.razorpay.plus_monthly,
    },
    {
      planCode: 'pro_annual',
      tierId: 'pro',
      cycle: 'annual',
      founding: false,
      usdCents: 19000,
      paddlePriceId: TEST_PRICE_IDS.paddle.pro_annual,
      razorpayPlanId: TEST_PRICE_IDS.razorpay.pro_annual,
    },
  ];
  return new BillingCatalog(entries, 250);
}

/** Minimal fake adapter — only the D249 read surface is exercised. */
function fakeAdapter(overrides: {
  fetchSubscription?: (id: string) => Promise<FetchSubscriptionResult>;
  searchSubscriptions?: (query: SubscriptionSearchQuery) => Promise<SubscriptionSearchResult>;
}): PaddleAdapter & RazorpayAdapter {
  return {
    fetchSubscription:
      overrides.fetchSubscription ??
      (async (): Promise<FetchSubscriptionResult> => ({ kind: 'not_found' })),
    searchSubscriptions:
      overrides.searchSubscriptions ??
      (async (): Promise<SubscriptionSearchResult> => ({ subscriptions: [], inProgress: 0 })),
  } as unknown as PaddleAdapter & RazorpayAdapter;
}

function activePlusSub(id: string, createdAt: Date): NormalizedSubscription {
  return {
    providerSubscriptionId: id,
    providerCustomerId: 'ctm_recon_test',
    providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
    status: 'active',
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    cancelAtPeriodEnd: false,
    pauseUntil: null,
    workspaceId: null,
    providerCreatedAt: createdAt.toISOString(),
  };
}

describe('BillingReconciliationService (D249)', () => {
  let db: DrizzleDb;
  let workspaceId: string;

  beforeEach(async () => {
    db = await freshDb();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Recon WS' })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;
    await db.insert(users).values({ workspaceId, email: 'owner@example.test' });
  });

  function service(paddle: PaddleAdapter, razorpay?: RazorpayAdapter) {
    const catalog = testCatalog();
    return new BillingReconciliationService(
      db,
      catalog,
      new BillingWebhookService(db, catalog),
      paddle,
      razorpay ?? (fakeAdapter({}) as RazorpayAdapter),
    );
  }

  async function seedClaim(input: { provider: 'paddle' | 'razorpay'; providerRef?: string }) {
    await db.insert(pendingCheckouts).values({
      workspaceId,
      provider: input.provider,
      tier: 'plus',
      billingCycle: 'monthly',
      providerRef: input.providerRef ?? null,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
  }

  it('no open claim → no_pending, nothing written', async () => {
    const svc = service(fakeAdapter({}));
    expect(await svc.reconcilePendingCheckout(workspaceId)).toBe('no_pending');
    expect(await db.select().from(subscriptionEvents)).toHaveLength(0);
  });

  it('provider_ref ladder: fetches THAT subscription, grants, clears the claim', async () => {
    const razorpaySub: NormalizedSubscription = {
      ...activePlusSub('sub_rzp_1', new Date()),
      providerPriceId: TEST_PRICE_IDS.razorpay.plus_monthly,
    };
    await seedClaim({ provider: 'razorpay', providerRef: 'sub_rzp_1' });
    const fetched: string[] = [];
    const svc = service(
      fakeAdapter({}),
      fakeAdapter({
        fetchSubscription: async (id) => {
          fetched.push(id);
          return { kind: 'found', subscription: razorpaySub };
        },
      }),
    );

    expect(await svc.reconcilePendingCheckout(workspaceId)).toBe('granted');
    expect(fetched).toEqual(['sub_rzp_1']);

    const [row] = await db.select().from(subscriptions);
    expect(row).toMatchObject({ workspaceId, status: 'active', tier: 'plus' });
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('plus');
    // The grant path clears the claim — same as a webhook grant.
    expect(await db.select().from(pendingCheckouts)).toHaveLength(0);
    // Provenance is visible in the ledger.
    const [event] = await db.select().from(subscriptionEvents);
    expect(event!.eventType).toBe('reconciliation.subscription');
    expect(event!.providerEventId.startsWith('recon:razorpay:sub_rzp_1:')).toBe(true);
    expect(event!.processedAt).not.toBeNull();
  });

  it('email ladder: filters to the claim (tier/cycle, granting status, claim age), newest wins', async () => {
    await seedClaim({ provider: 'paddle' });
    const now = Date.now();
    const tooOld = activePlusSub('sub_old', new Date(now - 60 * 60_000)); // predates claim − 15m
    const wrongTier: NormalizedSubscription = {
      ...activePlusSub('sub_pro', new Date(now)),
      providerPriceId: TEST_PRICE_IDS.paddle.pro_annual,
    };
    const canceled: NormalizedSubscription = {
      ...activePlusSub('sub_gone', new Date(now)),
      status: 'canceled',
      currentPeriodEnd: null,
    };
    const older = activePlusSub('sub_match_older', new Date(now - 5 * 60_000));
    const newest = activePlusSub('sub_match_newest', new Date(now));
    const searched: string[] = [];
    const svc = service(
      fakeAdapter({
        searchSubscriptions: async (query) => {
          searched.push(query.email);
          return { subscriptions: [tooOld, wrongTier, canceled, older, newest], inProgress: 0 };
        },
      }),
    );

    expect(await svc.reconcilePendingCheckout(workspaceId)).toBe('granted');
    expect(searched).toEqual(['owner@example.test']);
    const rows = await db.select().from(subscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.providerSubscriptionId).toBe('sub_match_newest');
  });

  it('Codex fix 1: a pre-grant provider artifact is payment_in_progress, never none_found', async () => {
    // Razorpay `created`/`authenticated` — the 3DS window. Reporting
    // "no payment found" here unlocks the release seconds before a
    // charge settles: the exact double-charge the lock exists to stop.
    await seedClaim({ provider: 'razorpay', providerRef: 'sub_3ds' });
    const svc = service(
      fakeAdapter({}),
      fakeAdapter({
        fetchSubscription: async () => ({
          kind: 'found_unmapped',
          providerStatus: 'authenticated',
        }),
      }),
    );

    expect(await svc.reconcilePendingCheckout(workspaceId)).toBe('payment_in_progress');
    expect(await db.select().from(pendingCheckouts)).toHaveLength(1);
    expect(await db.select().from(subscriptionEvents)).toHaveLength(0);
  });

  it('Codex fix 4: an inconclusive provider_ref falls back to the search — never concludes alone', async () => {
    // Rotten ref (provider 404s our own id): the ref is a fast path,
    // not the only witness. The search must still run and find the
    // money.
    const found: NormalizedSubscription = {
      ...activePlusSub('sub_found_by_search', new Date()),
      providerPriceId: TEST_PRICE_IDS.razorpay.plus_monthly,
    };
    await seedClaim({ provider: 'razorpay', providerRef: 'sub_rotten' });
    const svc = service(
      fakeAdapter({}),
      fakeAdapter({
        fetchSubscription: async () => ({ kind: 'not_found' }),
        searchSubscriptions: async () => ({ subscriptions: [found], inProgress: 0 }),
      }),
    );
    expect(await svc.reconcilePendingCheckout(workspaceId)).toBe('granted');
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('plus');
  });

  it('Codex fix 4: a found-but-canceled ref (reclaimed claim) does not suppress the search', async () => {
    // Reclaim shape: claim points at attempt #2 (canceled), while
    // attempt #1 carried the payment. Concluding none_found from the
    // ref alone released toward real money.
    const attempt2Canceled: NormalizedSubscription = {
      ...activePlusSub('sub_attempt2', new Date()),
      providerPriceId: TEST_PRICE_IDS.razorpay.plus_monthly,
      status: 'canceled',
      currentPeriodEnd: null,
    };
    const attempt1Paid: NormalizedSubscription = {
      ...activePlusSub('sub_attempt1', new Date()),
      providerPriceId: TEST_PRICE_IDS.razorpay.plus_monthly,
    };
    await seedClaim({ provider: 'razorpay', providerRef: 'sub_attempt2' });
    const svc = service(
      fakeAdapter({}),
      fakeAdapter({
        fetchSubscription: async () => ({ kind: 'found', subscription: attempt2Canceled }),
        searchSubscriptions: async () => ({ subscriptions: [attempt1Paid], inProgress: 0 }),
      }),
    );
    expect(await svc.reconcilePendingCheckout(workspaceId)).toBe('granted');
    const rows = await db.select().from(subscriptions);
    expect(rows.map((r) => r.providerSubscriptionId)).toEqual(['sub_attempt1']);
  });

  it('Codex fix 3: a stale RAZORPAY lock is found via plan_id + notes — Razorpay IS asked', async () => {
    // No claim row (swept), no provider_ref — the first cut's "[]"
    // Razorpay search meant none_found without asking Razorpay, while
    // its orphan stayed payable from the provider's own email.
    const rzpQueries: SubscriptionSearchQuery[] = [];
    const rzpSub: NormalizedSubscription = {
      ...activePlusSub('sub_rzp_stale', new Date()),
      providerPriceId: TEST_PRICE_IDS.razorpay.plus_monthly,
      workspaceId: null,
    };
    const svc = service(
      fakeAdapter({}), // paddle finds nothing
      fakeAdapter({
        searchSubscriptions: async (query) => {
          rzpQueries.push(query);
          return { subscriptions: [rzpSub], inProgress: 0 };
        },
      }),
    );

    const outcome = await svc.reconcilePendingCheckout(workspaceId, {
      tier: 'plus',
      cycle: 'monthly',
      startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    });
    expect(outcome).toBe('granted');
    // Razorpay was queried with ITS plan ids + the workspace to match
    // notes against — the search key set that makes it answerable.
    expect(rzpQueries).toHaveLength(1);
    expect(rzpQueries[0]!.workspaceId).toBe(workspaceId);
    expect(rzpQueries[0]!.providerPriceIds).toContain(TEST_PRICE_IDS.razorpay.plus_monthly);
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('plus');
  });

  it('Codex fix 3: search-path pre-grant activity is payment_in_progress, not none_found', async () => {
    const svc = service(
      fakeAdapter({
        searchSubscriptions: async () => ({ subscriptions: [], inProgress: 1 }),
      }),
    );
    const outcome = await svc.reconcilePendingCheckout(workspaceId, {
      tier: 'plus',
      cycle: 'monthly',
    });
    expect(outcome).toBe('payment_in_progress');
    expect(await db.select().from(subscriptionEvents)).toHaveLength(0);
  });

  it('Codex fix 2: a stale lock (claim swept) reconciles via the FE hint, not no_pending', async () => {
    // No pending_checkouts row — the 30-min TTL passed and the sweep
    // deleted it, but the BROWSER still holds its never-auto-expiring
    // lock. The hint (what that browser awaited) drives a real
    // provider search; a match grants exactly like the claim path.
    const found = activePlusSub('sub_after_ttl', new Date());
    const svc = service(
      fakeAdapter({ searchSubscriptions: async () => ({ subscriptions: [found], inProgress: 0 }) }),
    );

    const outcome = await svc.reconcilePendingCheckout(workspaceId, {
      tier: 'plus',
      cycle: 'monthly',
      startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    });
    expect(outcome).toBe('granted');
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('plus');

    // And with NOTHING at the provider either, the hint path answers
    // none_found (we asked!) — no_pending is reserved for hintless
    // calls only.
    const empty = service(
      fakeAdapter({ searchSubscriptions: async () => ({ subscriptions: [], inProgress: 0 }) }),
    );
    // New workspace to avoid the granted row above.
    const [ws2] = await db
      .insert(workspaces)
      .values({ name: 'Recon WS 2' })
      .returning({ id: workspaces.id });
    await db.insert(users).values({ workspaceId: ws2!.id, email: 'owner2@example.test' });
    expect(await empty.reconcilePendingCheckout(ws2!.id, { tier: 'plus', cycle: 'monthly' })).toBe(
      'none_found',
    );
    expect(await empty.reconcilePendingCheckout(ws2!.id)).toBe('no_pending');
  });

  it('provider answers empty → none_found; the claim SURVIVES (release stays a user decision)', async () => {
    await seedClaim({ provider: 'paddle' });
    const svc = service(
      fakeAdapter({ searchSubscriptions: async () => ({ subscriptions: [], inProgress: 0 }) }),
    );

    expect(await svc.reconcilePendingCheckout(workspaceId)).toBe('none_found');
    expect(await db.select().from(pendingCheckouts)).toHaveLength(1);
    expect(await db.select().from(subscriptionEvents)).toHaveLength(0);
  });

  it('provider unreachable → provider_unavailable; nothing asserted, nothing written', async () => {
    await seedClaim({ provider: 'paddle' });
    const svc = service(
      fakeAdapter({
        searchSubscriptions: async () => {
          throw new Error('ECONNRESET');
        },
      }),
    );

    expect(await svc.reconcilePendingCheckout(workspaceId)).toBe('provider_unavailable');
    expect(await db.select().from(pendingCheckouts)).toHaveLength(1);
    expect(await db.select().from(subscriptionEvents)).toHaveLength(0);
  });

  it('drift sweep: applies a provider-side cancel the webhook never delivered', async () => {
    // A live local row (as if a webhook granted it long ago)…
    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_drift',
      tier: 'plus',
      status: 'active',
      providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      cancelAtPeriodEnd: false,
    });
    await db.update(workspaces).set({ tier: 'plus' }).where(eq(workspaces.id, workspaceId));
    // …while the provider says it is CANCELED (the dropped-webhook case).
    const providerTruth: NormalizedSubscription = {
      ...activePlusSub('sub_drift', new Date()),
      status: 'canceled',
      currentPeriodEnd: null,
    };
    const svc = service(
      fakeAdapter({
        fetchSubscription: async () => ({ kind: 'found', subscription: providerTruth }),
      }),
    );

    const first = await svc.reconcileLiveSubscriptions();
    expect(first).toMatchObject({
      subscriptionsChecked: 1,
      subscriptionsDrifted: 1,
      providerErrors: 0,
    });
    const [row] = await db.select().from(subscriptions);
    expect(row!.status).toBe('canceled');
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('free');
  });

  it('drift sweep is idempotent: unchanged provider truth dedups in the ledger', async () => {
    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_same',
      tier: 'plus',
      status: 'active',
      providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      cancelAtPeriodEnd: false,
    });
    const truth = activePlusSub('sub_same', new Date());
    const svc = service(
      fakeAdapter({ fetchSubscription: async () => ({ kind: 'found', subscription: truth }) }),
    );

    const first = await svc.reconcileLiveSubscriptions();
    // First look records the snapshot (a state write of the same data).
    expect(first.subscriptionsChecked).toBe(1);
    const second = await svc.reconcileLiveSubscriptions();
    expect(second).toMatchObject({ subscriptionsChecked: 1, subscriptionsUnchanged: 1 });
    // ONE ledger row for the unchanged state — the deterministic recon
    // id deduped the second pass; no new machinery involved.
    const events = await db.select().from(subscriptionEvents);
    expect(events).toHaveLength(1);
  });

  it('drift sweep: a provider 404 is logged, counted, and NEVER cancels the row', async () => {
    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_missing',
      tier: 'plus',
      status: 'active',
      providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      cancelAtPeriodEnd: false,
    });
    const svc = service(fakeAdapter({ fetchSubscription: async () => ({ kind: 'not_found' }) }));

    const result = await svc.reconcileLiveSubscriptions();
    expect(result).toMatchObject({ subscriptionsChecked: 1, subscriptionsUnreadable: 1 });
    const [row] = await db.select().from(subscriptions);
    expect(row!.status).toBe('active');
  });
});
