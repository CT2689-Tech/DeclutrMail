import {
  pendingCheckouts,
  subscriptionEvents,
  subscriptions,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { AutopilotReadService } from '../../autopilot/autopilot.read-service.js';
import type { DrizzleDb } from '../../db/db.module.js';
import { BillingCatalog, type CatalogEntry } from '../billing-catalog.js';
import {
  FetchSubscriptionResult,
  ProviderCancellationFacts,
  NormalizedSubscription,
  SubscriptionSearchQuery,
  SubscriptionSearchResult,
} from '../billing-provider.interface.js';
import {
  BillingReconciliationService,
  VERDICT_PASS_MAX_ROWS,
} from '../billing-reconciliation.service.js';
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

async function freshDb(): Promise<DrizzleDb> {
  return (await freshTestDb()) as unknown as DrizzleDb;
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
  cancelSubscription?: (id: string) => Promise<void>;
  providerCancellationFacts?: (id: string) => Promise<ProviderCancellationFacts | null>;
}): PaddleAdapter & RazorpayAdapter {
  return {
    fetchSubscription:
      overrides.fetchSubscription ??
      (async (): Promise<FetchSubscriptionResult> => ({ kind: 'not_found' })),
    searchSubscriptions:
      overrides.searchSubscriptions ??
      (async (): Promise<SubscriptionSearchResult> => ({ subscriptions: [], inProgress: 0 })),
    // Absent by default so an unexpected outbound cancel throws rather
    // than silently passing — this adapter's WRITE surface is the thing
    // enforceLocalVerdicts is trusted with.
    cancelSubscription: overrides.cancelSubscription,
    // Defaults to the REFUSING answer — nothing settled, nothing
    // refuted. A test that means to exercise the cancel has to say so;
    // one that forgets cannot drift into sending a provider cancel it
    // never asked for.
    providerCancellationFacts:
      overrides.providerCancellationFacts ??
      (async () => ({ settled: null, refuted: { refund: false, chargeback: false } })),
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

const SETTLED_REFUND: ProviderCancellationFacts = {
  settled: 'refund',
  refuted: { refund: false, chargeback: false },
};
const SETTLED_CHARGEBACK: ProviderCancellationFacts = {
  settled: 'chargeback',
  refuted: { refund: false, chargeback: false },
};
/** Paddle rejected (or reversed) the refund — our refund verdict is void. */
const REFUTED_REFUND: ProviderCancellationFacts = {
  settled: null,
  refuted: { refund: true, chargeback: false },
};

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
      new BillingWebhookService(db, catalog, new AutopilotReadService(db)),
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

  // ── enforceLocalVerdicts — the one OUTBOUND write ────────────────
  //
  // A refund/chargeback is a verdict only we hold: Paddle records the
  // adjustment against a transaction and keeps renewing the
  // subscription beside it. Without this the customer is charged for a
  // period we no longer grant (matrix H1/H2 follow-up, 2026-07-31).

  /** A live row already carrying a local verdict. */
  async function seedVerdictRow(input: {
    cancelSource: 'refund' | 'chargeback';
    providerSubscriptionId?: string;
  }) {
    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'paddle',
      providerSubscriptionId: input.providerSubscriptionId ?? 'sub_verdict',
      tier: 'plus',
      status: 'active',
      providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      cancelAtPeriodEnd: true,
      cancelSource: input.cancelSource,
      entitlementEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
  }

  it('refunded row + provider still renewing → cancels at the provider', async () => {
    await seedVerdictRow({ cancelSource: 'refund' });
    const canceled: string[] = [];
    const svc = service(
      fakeAdapter({
        // Paddle's own view: perfectly healthy, renewal on.
        fetchSubscription: async () => ({
          kind: 'found',
          subscription: activePlusSub('sub_verdict', new Date()),
        }),
        providerCancellationFacts: async () => SETTLED_REFUND,
        cancelSubscription: async (id) => {
          canceled.push(id);
        },
      }),
    );

    const result = await svc.enforceLocalVerdicts(0);
    expect(canceled).toEqual(['sub_verdict']);
    expect(result).toMatchObject({ enforced: 1, unenforced: 0 });
  });

  it('chargeback row is enforced too', async () => {
    await seedVerdictRow({ cancelSource: 'chargeback' });
    const canceled: string[] = [];
    const svc = service(
      fakeAdapter({
        fetchSubscription: async () => ({
          kind: 'found',
          subscription: activePlusSub('sub_verdict', new Date()),
        }),
        providerCancellationFacts: async () => SETTLED_CHARGEBACK,
        cancelSubscription: async (id) => {
          canceled.push(id);
        },
      }),
    );

    await svc.enforceLocalVerdicts(0);
    expect(canceled).toEqual(['sub_verdict']);
  });

  it('provider already scheduled the cancel → converged, nothing sent', async () => {
    await seedVerdictRow({ cancelSource: 'refund' });
    const canceled: string[] = [];
    const svc = service(
      fakeAdapter({
        fetchSubscription: async () => ({
          kind: 'found',
          subscription: { ...activePlusSub('sub_verdict', new Date()), cancelAtPeriodEnd: true },
        }),
        providerCancellationFacts: async () => SETTLED_REFUND,
        cancelSubscription: async (id) => {
          canceled.push(id);
        },
      }),
    );

    const result = await svc.enforceLocalVerdicts(0);
    expect(canceled).toEqual([]);
    expect(result).toMatchObject({ enforced: 0, unenforced: 0 });
  });

  // A null from providerCancellationFacts is a READ FAILURE, not
  // "nothing settled". It does not throw, so the loop's catch never sees
  // it, and the successful fetchSubscription just before it has already
  // reset the provider's error counter — so an adjustments endpoint that
  // is down while the subscriptions endpoint is healthy could be polled
  // once per row, every pass, forever.
  it('unreadable facts trip the provider circuit breaker', async () => {
    const TRIP_AFTER = 3; // mirrors DRIFT_SWEEP_TRIP_AFTER (module-private)
    // One workspace each: subscriptions_one_live_per_workspace permits a
    // single active row per workspace, which is the whole invariant D253
    // is built around.
    for (let i = 0; i < TRIP_AFTER + 2; i += 1) {
      const [ws] = await db
        .insert(workspaces)
        .values({ name: `Unreadable WS ${i}` })
        .returning({ id: workspaces.id });
      await db.insert(subscriptions).values({
        workspaceId: ws!.id,
        provider: 'paddle',
        providerSubscriptionId: `sub_unreadable_${i}`,
        tier: 'plus',
        status: 'active',
        providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
        billingCycle: 'monthly',
        currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        cancelAtPeriodEnd: true,
        cancelSource: 'refund',
        entitlementEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      });
    }
    let factsCalls = 0;
    const svc = service(
      fakeAdapter({
        fetchSubscription: async (id) => ({
          kind: 'found',
          subscription: activePlusSub(id, new Date()),
        }),
        providerCancellationFacts: async () => {
          factsCalls += 1;
          return null;
        },
      }),
    );

    await svc.enforceLocalVerdicts(0);

    // Stops asking once the breaker trips, rather than walking every row.
    expect(factsCalls).toBe(TRIP_AFTER);
  });

  // The customer cancels in-app, THEN asks for their money back, and
  // Paddle rejects the refund. Paddle has held `scheduled_change: cancel`
  // since their own cancel, so `cancelAtPeriodEnd` is true throughout.
  //
  // That flag used to short-circuit this loop before the facts read, so
  // the refutation below was unreachable: `entitlement_ends_at` stayed
  // pinned at the moment the refund was requested and the customer kept
  // paying for a plan we no longer granted. Nothing logged it, because
  // from the sweep's side the row had simply "converged".
  it('provider scheduled the cancel AND rejected the refund → verdict is still lifted', async () => {
    await seedVerdictRow({ cancelSource: 'refund' });
    const canceled: string[] = [];
    const svc = service(
      fakeAdapter({
        fetchSubscription: async () => ({
          kind: 'found',
          subscription: { ...activePlusSub('sub_verdict', new Date()), cancelAtPeriodEnd: true },
        }),
        providerCancellationFacts: async () => REFUTED_REFUND,
        cancelSubscription: async (id) => {
          canceled.push(id);
        },
      }),
    );

    const result = await svc.enforceLocalVerdicts(0);

    expect(result).toMatchObject({ refuted: 1 });
    expect(canceled).toEqual([]);

    const [row] = await db
      .select({
        cancelSource: subscriptions.cancelSource,
        entitlementEndsAt: subscriptions.entitlementEndsAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, 'sub_verdict'));
    expect(row?.cancelSource).toBeNull();
    expect(row?.entitlementEndsAt).toBeNull();
  });

  it('an ORDINARY live row is never cancelled by the verdict pass', async () => {
    // The blast radius that matters: a row with no local verdict must
    // never receive an outbound cancel. `cancelSubscription` is left
    // undefined, so any call throws instead of passing silently.
    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_healthy',
      tier: 'plus',
      status: 'active',
      providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      cancelAtPeriodEnd: false,
    });
    const svc = service(
      fakeAdapter({
        fetchSubscription: async () => ({
          kind: 'found',
          subscription: activePlusSub('sub_healthy', new Date()),
        }),
      }),
    );

    const result = await svc.enforceLocalVerdicts(0);
    expect(result.enforced).toBe(0);
  });

  it('provider read miss → no cancel claimed, counted unenforced', async () => {
    await seedVerdictRow({ cancelSource: 'refund' });
    const svc = service(fakeAdapter({ fetchSubscription: async () => ({ kind: 'not_found' }) }));

    const result = await svc.enforceLocalVerdicts(0);
    expect(result).toMatchObject({ enforced: 0, unenforced: 1 });
  });

  // The outbound cancel needs TWO facts, and our own marker is only the
  // first. On a live Paddle account `adjustment.created` fires while the
  // refund is still `pending_approval`; sandbox auto-approves, so this
  // shape never appears in testing. Cancelling on it would end the
  // subscription of a customer Paddle may still decide is paying.
  const NOTHING_YET: ProviderCancellationFacts = {
    settled: null,
    refuted: { refund: false, chargeback: false },
  };
  /** An unrelated old dispute was reversed; OUR refund is still pending. */
  const OTHER_VERDICT_REFUTED: ProviderCancellationFacts = {
    settled: null,
    refuted: { refund: false, chargeback: true },
  };
  for (const [label, facts] of [
    ['a refund Paddle has NOT approved yet', NOTHING_YET],
    ['an adjustments read we could not make', null],
    ['a reversed CHARGEBACK while our refund is still pending', OTHER_VERDICT_REFUTED],
  ] as const) {
    it(`${label} → no cancel sent`, async () => {
      await seedVerdictRow({ cancelSource: 'refund' });
      const canceled: string[] = [];
      const svc = service(
        fakeAdapter({
          fetchSubscription: async () => ({
            kind: 'found',
            subscription: activePlusSub('sub_verdict', new Date()),
          }),
          providerCancellationFacts: async () => facts,
          cancelSubscription: async (id) => {
            canceled.push(id);
          },
        }),
      );

      const result = await svc.enforceLocalVerdicts(0);
      expect(canceled).toEqual([]);
      expect(result).toMatchObject({ enforced: 0, unenforced: 1 });
    });
  }

  it('a REFUTED verdict is lifted and the plan comes back', async () => {
    // The cruellest state this system can produce: Paddle rejected the
    // refund (live accounts create them `pending_approval`), so the
    // customer is billed normally, holds Free, and every self-serve exit
    // is shut. Corrected from the POLL rather than `adjustment.updated`
    // so it works without that event being subscribed at the provider
    // (Codex stop-review, 2026-07-31).
    await seedVerdictRow({ cancelSource: 'refund' });
    await db.update(workspaces).set({ tier: 'free' }).where(eq(workspaces.id, workspaceId));
    const canceled: string[] = [];
    const svc = service(
      fakeAdapter({
        fetchSubscription: async () => ({
          kind: 'found',
          subscription: activePlusSub('sub_verdict', new Date()),
        }),
        providerCancellationFacts: async () => REFUTED_REFUND,
        cancelSubscription: async (id) => {
          canceled.push(id);
        },
      }),
    );

    const result = await svc.enforceLocalVerdicts(0);
    expect(canceled).toEqual([]); // never cancel a verdict the provider denies
    expect(result).toMatchObject({ refuted: 1, enforced: 0 });

    const [row] = await db.select().from(subscriptions);
    expect(row!.cancelSource).toBeNull();
    expect(row!.entitlementEndsAt).toBeNull();
    // …and the flag stays, because the sweep may already have scheduled a
    // cancel at the provider. With `cancel_source` null the D118 "Keep my
    // subscription" button renders and works — the customer's way back.
    expect(row!.cancelAtPeriodEnd).toBe(true);
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('plus');
  });

  it('the settled cause is read from the PROVIDER, not from our own row', async () => {
    // A local `chargeback` marker over a provider that only confirms a
    // refund still cancels — but the log and the decision follow the
    // provider. The marker's job is to select candidates, not to decide.
    await seedVerdictRow({ cancelSource: 'chargeback' });
    const canceled: string[] = [];
    const asked: string[] = [];
    const svc = service(
      fakeAdapter({
        fetchSubscription: async () => ({
          kind: 'found',
          subscription: activePlusSub('sub_verdict', new Date()),
        }),
        providerCancellationFacts: async (id) => {
          asked.push(id);
          return SETTLED_REFUND;
        },
        cancelSubscription: async (id) => {
          canceled.push(id);
        },
      }),
    );

    const result = await svc.enforceLocalVerdicts(0);
    expect(asked).toEqual(['sub_verdict']);
    expect(canceled).toEqual(['sub_verdict']);

    // …but it does NOT release the plan slot. A dispute was raised on
    // this subscription, and the provider read cannot un-say that: a
    // chargeback later reversed reports `settled: 'refund'` while our
    // row still records the dispute. Re-arming a disputed payment
    // method early is the founder's stated reason for the
    // refund/chargeback asymmetry (2026-08-13), so both sources must
    // AGREE before the slot opens.
    const [unflipped] = await db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, 'sub_verdict'));
    expect(unflipped?.status).toBe('active');
    expect(result.settled).toBe(0);
  });

  // ── D253 — a refunded customer must be able to buy again ──────────
  //
  // A full refund ends entitlement instantly but leaves `status='active'`,
  // and five surfaces read `active` as "this workspace has a
  // subscription": the checkout guard, the one-live-per-workspace partial
  // index, the drift and verdict selectors, and the frontend picker. So
  // the refunded customer held nothing AND could not repurchase for the
  // rest of a period they had already been paid back for.

  it('a settled refund frees the slot: the row flips AND a repurchase inserts', async () => {
    await seedVerdictRow({ cancelSource: 'refund' });
    const svc = service(
      fakeAdapter({
        fetchSubscription: async () => ({
          kind: 'found',
          // Already scheduled to stop, so no outbound cancel is needed —
          // the steady state the old short-circuit skipped entirely.
          subscription: { ...activePlusSub('sub_verdict', new Date()), cancelAtPeriodEnd: true },
        }),
        providerCancellationFacts: async () => SETTLED_REFUND,
      }),
    );

    const result = await svc.enforceLocalVerdicts(0);
    expect(result.settled).toBe(1);

    const [row] = await db
      .select({
        status: subscriptions.status,
        cancelSource: subscriptions.cancelSource,
        entitlementEndsAt: subscriptions.entitlementEndsAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, 'sub_verdict'));
    expect(row?.status).toBe('canceled');
    // Provenance SURVIVES the flip. "Ended by refund" must stay
    // distinguishable from "cancelled normally" for churn reporting, and
    // the post-flip watch selects on exactly these two columns.
    expect(row?.cancelSource).toBe('refund');
    expect(row?.entitlementEndsAt).not.toBeNull();

    // THE assertion. A guard-only check passes against a broken system:
    // the lockout lived in the `subscriptions_one_live_per_workspace`
    // partial index, so the only proof the customer can actually buy
    // again is a second live row inserting beside the dead one.
    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_repurchase',
      tier: 'plus',
      status: 'active',
      providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      cancelAtPeriodEnd: false,
    });
    const live = await db
      .select({ id: subscriptions.providerSubscriptionId })
      .from(subscriptions)
      .where(and(eq(subscriptions.workspaceId, workspaceId), eq(subscriptions.status, 'active')));
    expect(live.map((r) => r.id)).toEqual(['sub_repurchase']);
  });

  it('a settled CHARGEBACK does not free the slot', async () => {
    // Founder decision 2026-08-13. Under a merchant of record, repeat
    // chargebacks flag a seller account, and re-arming the same payment
    // method same-day is how that starts. They release normally when the
    // period ends — not early.
    await seedVerdictRow({ cancelSource: 'chargeback' });
    const svc = service(
      fakeAdapter({
        fetchSubscription: async () => ({
          kind: 'found',
          subscription: { ...activePlusSub('sub_verdict', new Date()), cancelAtPeriodEnd: true },
        }),
        providerCancellationFacts: async () => SETTLED_CHARGEBACK,
      }),
    );

    const result = await svc.enforceLocalVerdicts(0);
    expect(result.settled).toBe(0);
    const [row] = await db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, 'sub_verdict'));
    expect(row?.status).toBe('active');
  });

  it('re-observing the same settled refund is a no-op, not a second flip', async () => {
    await seedVerdictRow({ cancelSource: 'refund' });
    const svc = service(
      fakeAdapter({
        fetchSubscription: async () => ({
          kind: 'found',
          subscription: { ...activePlusSub('sub_verdict', new Date()), cancelAtPeriodEnd: true },
        }),
        providerCancellationFacts: async () => SETTLED_REFUND,
      }),
    );

    await svc.enforceLocalVerdicts(0);
    // Second pass: the row is `canceled` now, so the verdict selector no
    // longer returns it at all. Nothing to settle, nothing to write, and
    // exactly one ledger row for the settlement.
    const second = await svc.enforceLocalVerdicts(0);
    expect(second.settled).toBe(0);

    const events = await db
      .select({ eventType: subscriptionEvents.eventType })
      .from(subscriptionEvents);
    expect(events.filter((e) => e.eventType === 'reconciliation.refund_settled')).toHaveLength(1);
  });

  it('an adapter that cannot answer never settles — the scope is the ADAPTER, not a provider check', async () => {
    // No `provider !== 'razorpay'` check exists anywhere, deliberately.
    // A hardcoded one would have become a permanent lockout for every
    // Indian customer the moment Razorpay refunds were mapped — the
    // exact bug this feature removes, re-created by the mitigation.
    //
    // So the rule is provider-agnostic: an adapter that answers `null`
    // cannot settle, and one that answers settles. Razorpay's adapter
    // now DOES answer (it reads invoices → refunds → disputes), so this
    // test no longer describes Razorpay's production state — it pins the
    // general property, which is what has to keep holding.

    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'razorpay',
      providerSubscriptionId: 'sub_rzp',
      tier: 'plus',
      status: 'active',
      providerPriceId: TEST_PRICE_IDS.razorpay.plus_monthly,
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      cancelAtPeriodEnd: true,
      cancelSource: 'refund',
      entitlementEndsAt: new Date(),
    });
    const svc = service(
      fakeAdapter({}),
      fakeAdapter({
        fetchSubscription: async () => ({
          kind: 'found',
          subscription: activePlusSub('sub_rzp', new Date()),
        }),
        providerCancellationFacts: async () => null,
      }) as RazorpayAdapter,
    );

    const result = await svc.enforceLocalVerdicts(0);
    expect(result.settled).toBe(0);
    const [row] = await db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, 'sub_rzp'));
    expect(row?.status).toBe('active');
  });

  it('a verdict backlog past the cap does NOT starve the rows behind it', async () => {
    // The cap is 100 and both capped passes select at RANDOM, not by
    // `updated_at`. That looks arbitrary until you notice an unsettled
    // row writes nothing — deliberately, it is the whole restraint — so
    // its `updated_at` never moves. Ordered by `updated_at ASC LIMIT
    // 100`, the leading 100 rows would be the SAME 100 forever, and
    // they are precisely the ones that cannot progress. Row 101 would
    // never be examined again: a refunded customer permanently unable
    // to buy, which is the bug this whole feature removes.
    //
    // So the assertion is not "one pass covers everything" — it cannot,
    // and should not. It is that REPEATED passes reach past the cap.
    // A single-pass test is exactly what missed this (Codex
    // stop-review, 2026-08-13).
    // 300 rows at a 60-row bucket target is 5 buckets, each comfortably
    // under the 100 cap. The RATIO is chosen deliberately: at 130 rows a
    // random-only selection covers everything in three runs about 99% of
    // the time, so a test at that size PASSES against the broken
    // implementation most runs — which is precisely the "unbounded
    // probabilistic delay" being fixed, showing up as a flaky test
    // instead of a caught bug. At 3× the cap, random-only misses ~40
    // rows and fails every time.
    const TOTAL = 300;
    // Seeded `paused`, not `active`, purely so one workspace can hold
    // them all: `subscriptions_one_live_per_workspace` covers
    // active/past_due only. `paused` is in the verdict selector, which
    // is the part under test, and 130 workspaces would prove the same
    // thing far more slowly.
    await db.insert(subscriptions).values(
      Array.from({ length: TOTAL }, (_, i) => ({
        workspaceId,
        provider: 'paddle' as const,
        providerSubscriptionId: `sub_backlog_${i}`,
        tier: 'plus' as const,
        status: 'paused' as const,
        providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
        billingCycle: 'monthly' as const,
        currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        cancelAtPeriodEnd: true,
        cancelSource: 'refund' as const,
        entitlementEndsAt: new Date(),
      })),
    );

    const everAsked = new Set<string>();
    const svc = service(
      fakeAdapter({
        fetchSubscription: async (id) => ({
          kind: 'found',
          subscription: { ...activePlusSub(id, new Date()), cancelAtPeriodEnd: true },
        }),
        // Nothing ever settles — the state that pins the leading rows in
        // place under a stable ordering, and writes nothing.
        providerCancellationFacts: async (id) => {
          everAsked.add(id);
          return { settled: null, refuted: { refund: false, chargeback: false } };
        },
      }),
    );

    // The bound, not a probability. 5 buckets means FIVE consecutive run
    // indices must cover the whole population — the guarantee the
    // round-robin makes and `random()` alone cannot (Codex stop-review
    // round 2: "random sampling replaces permanent starvation with
    // unbounded probabilistic delay"). Consecutive indices, because the
    // run index advances by exactly one per scheduled run.
    for (let runIndex = 0; runIndex < 5; runIndex += 1) {
      await svc.enforceLocalVerdicts(runIndex);
    }

    // Exhaustive, not "most of them". Under `updated_at ASC` this is
    // exactly 100 however many passes run; under random-only it lands
    // around 260.
    expect(everAsked.size).toBe(TOTAL);
    expect(everAsked.size).toBeGreaterThan(VERDICT_PASS_MAX_ROWS);
  });

  it('the round-robin is a no-op below the bucket target', async () => {
    // The partition only engages under load. At real volume — which is
    // where this product actually is — there is one bucket and every
    // row is examined every run, so no customer waits for their slice
    // to come around.
    await seedVerdictRow({ cancelSource: 'refund', providerSubscriptionId: 'sub_only' });
    const asked: string[] = [];
    const svc = service(
      fakeAdapter({
        fetchSubscription: async (id) => ({
          kind: 'found',
          subscription: { ...activePlusSub(id, new Date()), cancelAtPeriodEnd: true },
        }),
        providerCancellationFacts: async (id) => {
          asked.push(id);
          return { settled: null, refuted: { refund: false, chargeback: false } };
        },
      }),
    );

    // Any run index, same answer — no row is ever skipped for being in
    // "another bucket" when there is only one.
    for (const runIndex of [0, 1, 7, 12345]) await svc.enforceLocalVerdicts(runIndex);
    expect(asked).toEqual(['sub_only', 'sub_only', 'sub_only', 'sub_only']);
  });

  // ── D253 — the flipped row stays watched ──────────────────────────
  //
  // Flipping to `canceled` makes every other pass lose interest, and the
  // terminal-canceled floor discards any later granting payload. So if
  // the provider's cancel is cleared or never sticks, it keeps charging
  // a customer we hold on Free and nothing notices — strictly worse than
  // the lockout, and invisible where the lockout at least had a confused
  // customer to report it.

  /** A row already flipped by a settled refund. */
  async function seedFlippedRefundRow(input: { currentPeriodEnd: Date }) {
    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_flipped',
      tier: 'plus',
      status: 'canceled',
      providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      billingCycle: 'monthly',
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: true,
      cancelSource: 'refund',
      entitlementEndsAt: new Date(),
    });
  }

  it('a flipped row the provider is still set to RENEW raises the alert', async () => {
    await seedFlippedRefundRow({ currentPeriodEnd: new Date(Date.now() + 20 * 24 * 3600 * 1000) });
    const svc = service(
      fakeAdapter({
        // Paddle's scheduled cancel is gone — it intends to bill again.
        fetchSubscription: async () => ({
          kind: 'found',
          subscription: activePlusSub('sub_flipped', new Date()),
        }),
      }),
    );

    const result = await svc.watchSettledRefunds(0);
    expect(result).toMatchObject({ watched: 1, rebilling: 1 });
    // An alert, never a write — resurrecting the row would re-enter the
    // live slot a repurchase may already hold, which is the collision
    // the whole design makes unrepresentable.
    const [row] = await db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, 'sub_flipped'));
    expect(row?.status).toBe('canceled');
  });

  it('a flipped row the provider agrees is terminal stays quiet', async () => {
    await seedFlippedRefundRow({ currentPeriodEnd: new Date(Date.now() + 20 * 24 * 3600 * 1000) });
    const svc = service(fakeAdapter({ fetchSubscription: async () => ({ kind: 'not_found' }) }));

    // `not_found` is the GOOD outcome — the subscription is gone at the
    // provider, which is exactly what we want to be true.
    expect(await svc.watchSettledRefunds(0)).toMatchObject({
      watched: 1,
      rebilling: 0,
      unreadable: 0,
    });
  });

  it('the watch stops once the renewal it guards against has passed', async () => {
    // Self-terminating with no attempt counter and no schema change: a
    // provider can only charge again at `current_period_end`, so past it
    // plus a grace window there is nothing left to catch.
    await seedFlippedRefundRow({ currentPeriodEnd: new Date(Date.now() - 60 * 24 * 3600 * 1000) });
    const asked: string[] = [];
    const svc = service(
      fakeAdapter({
        fetchSubscription: async (id) => {
          asked.push(id);
          return { kind: 'found', subscription: activePlusSub('sub_flipped', new Date()) };
        },
      }),
    );

    expect(await svc.watchSettledRefunds(0)).toMatchObject({ watched: 0, rebilling: 0 });
    expect(asked).toEqual([]);
  });

  it('the watch ignores rows that are not refund-canceled', async () => {
    // An ordinary cancelled row carries no refund verdict and is not our
    // business; polling it would cost a provider call per churned
    // customer, forever.
    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_ordinary',
      tier: 'plus',
      status: 'canceled',
      providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * 3600 * 1000),
      cancelAtPeriodEnd: true,
      cancelSource: 'provider',
      entitlementEndsAt: new Date(),
    });
    const asked: string[] = [];
    const svc = service(
      fakeAdapter({
        fetchSubscription: async (id) => {
          asked.push(id);
          return { kind: 'not_found' };
        },
      }),
    );

    expect(await svc.watchSettledRefunds(0)).toMatchObject({ watched: 0 });
    expect(asked).toEqual([]);
  });

  // ── reconcileWorkspaceSubscriptions — the stuck-plan-change path ──
  //
  // An immediate upgrade writes no scheduled-change marker, so a lost
  // webhook leaves a row indistinguishable from a healthy pre-change
  // one. These pin the per-workspace variant's outcome mapping.

  it('workspace reconcile: applies a provider-side upgrade the webhook never delivered → granted', async () => {
    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_upg',
      tier: 'plus',
      status: 'active',
      providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      cancelAtPeriodEnd: false,
    });
    await db.update(workspaces).set({ tier: 'plus' }).where(eq(workspaces.id, workspaceId));
    // Provider truth: the founder's live repro — pro/annual applied at
    // Paddle while the local row still says plus/monthly.
    const providerTruth: NormalizedSubscription = {
      ...activePlusSub('sub_upg', new Date()),
      providerPriceId: TEST_PRICE_IDS.paddle.pro_annual,
    };
    const svc = service(
      fakeAdapter({
        fetchSubscription: async () => ({ kind: 'found', subscription: providerTruth }),
      }),
    );

    expect(await svc.reconcileWorkspaceSubscriptions(workspaceId)).toBe('granted');
    const [row] = await db.select().from(subscriptions);
    expect(row!.tier).toBe('pro');
    expect(row!.billingCycle).toBe('annual');
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('pro');
  });

  it('workspace reconcile: unchanged provider truth → already_recorded (idempotent, one ledger row)', async () => {
    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_ws_same',
      tier: 'plus',
      status: 'active',
      providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      cancelAtPeriodEnd: false,
    });
    const truth = activePlusSub('sub_ws_same', new Date());
    const svc = service(
      fakeAdapter({ fetchSubscription: async () => ({ kind: 'found', subscription: truth }) }),
    );

    // First pass records the snapshot; the second dedups in the ledger.
    expect(await svc.reconcileWorkspaceSubscriptions(workspaceId)).toBe('granted');
    expect(await svc.reconcileWorkspaceSubscriptions(workspaceId)).toBe('already_recorded');
    expect(await db.select().from(subscriptionEvents)).toHaveLength(1);
  });

  it('workspace reconcile with a target hint: the hint gates every outcome, including the first pass', async () => {
    // Provider and DB agree on plus/monthly — the awaited pro/annual
    // change NEVER HAPPENED.
    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_hint',
      tier: 'plus',
      status: 'active',
      providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      cancelAtPeriodEnd: false,
    });
    const truth = activePlusSub('sub_hint', new Date());
    const svc = service(
      fakeAdapter({ fetchSubscription: async () => ({ kind: 'found', subscription: truth }) }),
    );

    // FIRST pass — the never-reconciled row projects its bookkeeping
    // snapshot ('processed' in the ledger), which is NOT the awaited
    // change. Mapping that projection to 'granted' falsely confirmed an
    // unapplied change on the very first check (Codex 2026-07-30,
    // second round).
    expect(
      await svc.reconcileWorkspaceSubscriptions(workspaceId, { tier: 'pro', cycle: 'annual' }),
    ).toBe('none_found');
    // The snapshot WAS written — the answer stayed truthful anyway.
    expect(await db.select().from(subscriptionEvents)).toHaveLength(1);

    // Awaiting the state that IS recorded → a true confirmation.
    expect(
      await svc.reconcileWorkspaceSubscriptions(workspaceId, { tier: 'plus', cycle: 'monthly' }),
    ).toBe('already_recorded');

    // No hint → neutral, never a payment claim in either direction.
    expect(await svc.reconcileWorkspaceSubscriptions(workspaceId)).toBe('already_recorded');
  });

  it('workspace reconcile: no live rows → no_pending; provider throw → provider_unavailable; 404 → unresolved', async () => {
    // No rows at all.
    const empty = service(fakeAdapter({}));
    expect(await empty.reconcileWorkspaceSubscriptions(workspaceId)).toBe('no_pending');

    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_ws_err',
      tier: 'plus',
      status: 'active',
      providerPriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      cancelAtPeriodEnd: false,
    });
    const throwing = service(
      fakeAdapter({
        fetchSubscription: async () => {
          throw new Error('ECONNRESET');
        },
      }),
    );
    expect(await throwing.reconcileWorkspaceSubscriptions(workspaceId)).toBe(
      'provider_unavailable',
    );

    const missing = service(
      fakeAdapter({ fetchSubscription: async () => ({ kind: 'not_found' }) }),
    );
    expect(await missing.reconcileWorkspaceSubscriptions(workspaceId)).toBe('unresolved');
    // Neither outcome wrote anything.
    const [row] = await db.select().from(subscriptions);
    expect(row!.status).toBe('active');
    expect(await db.select().from(subscriptionEvents)).toHaveLength(0);
  });
});
