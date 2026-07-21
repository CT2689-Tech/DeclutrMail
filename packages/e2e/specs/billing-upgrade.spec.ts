import { expect, test, request } from '@playwright/test';
import type postgres from 'postgres';

import { ApiClient } from '../helpers/api';
import {
  BILLING_E2E_ENV,
  BILLING_STORAGE_STATE_PATH,
  ensureBillingStorageState,
  loginBillingUser,
  paddleRunIds,
  paddleSubscriptionActivated,
  postPaddleWebhook,
} from '../helpers/billing';
import { dbConnect } from '../helpers/db';
import { E2E_ENV } from '../helpers/env';
import { applyBillingSeed, BILLING_SEED, resetBillingVolatileState } from '../helpers/seed-billing';

/**
 * Money-path spec (D183 / D19 / D77 / D117 / D180) — free user hits the
 * paywall → SIGNED provider webhook activates the subscription →
 * entitlements flip → gates open.
 *
 * WHAT IT PROVES
 *   1. A Free workspace at its 5-lifetime-cleanup cap (D19) gets the
 *      designed upsell: Archive confirm → server 402 FREE_CAP_REACHED →
 *      UpgradeModal — and NO action row was written (the gate fires
 *      before insert).
 *   2. The Pro-only Screener (D77) shows its upsell surface, and the
 *      API 402s PRO_FEATURE_REQUIRED underneath (defense in depth).
 *   3. The Paddle webhook only accepts the REAL signature scheme
 *      (D180): a tampered `h1` is 401'd and changes nothing; the
 *      byte-exact HMAC (`ts:rawBody`, HMAC-SHA256, ±5s skew) flips
 *      `workspaces.tier` to pro in the same request.
 *   4. `/api/auth/me` reports tier=pro with the quota lifted;
 *      /screener renders the seeded queue instead of the upsell;
 *      /billing shows the active Paddle plan.
 *   5. Replaying the same event id acks `duplicate` with no double
 *      effect (at-least-once delivery safety).
 *
 * GMAIL-FREE: everything runs on the synthetic seeded workspace
 * (helpers/seed-billing.ts — applied by global-setup) — no Gmail
 * account, OAuth grant, sync, or mutation anywhere on this path. No
 * WORKER is needed either: the paywall 402s before enqueue, webhook
 * processing is synchronous inside the API request, and every other
 * step is a read.
 *
 * ## How to run (dedicated ports — the main dev stack on 4000/3000
 * stays untouched)
 *
 *   docker compose up -d redis
 *
 *   # api (:4183) — billing enabled, test-only provider config
 *   PORT=4183 WEB_URL=http://localhost:3183 \
 *   REDIS_URL=redis://localhost:6379/8 RATE_LIMIT_ENABLED=false \
 *   BILLING_ENABLED=true \
 *   PADDLE_WEBHOOK_SECRET=e2e_local_paddle_webhook_secret \
 *   BILLING_CATALOG_JSON='{"paddle":{"pro_monthly":"pri_e2e_pro_monthly"}}' \
 *     pnpm --filter @declutrmail/api start
 *
 *   # web (:3183)
 *   PORT=3183 NEXT_PUBLIC_API_URL=http://localhost:4183 \
 *     pnpm --filter @declutrmail/web dev
 *
 *   # spec (repo root; .env.local supplies DATABASE_URL + the D206
 *   # dev-login envs — DEV_AUTH_ENABLED=true, DEV_AUTH_EMAIL_PREFIX)
 *   E2E_WEB_URL=http://localhost:3183 E2E_API_URL=http://localhost:4183 \
 *   E2E_PADDLE_WEBHOOK_SECRET=e2e_local_paddle_webhook_secret \
 *     pnpm e2e billing-upgrade
 *
 * The synthetic login email must start with the api's
 * DEV_AUTH_EMAIL_PREFIX — the default `chintan.e2e.billing@synthetic.test`
 * matches the checked-in dev prefix (`chintan`); override via
 * E2E_BILLING_LOGIN_EMAIL if yours differs. E2E_PADDLE_PRICE_ID must
 * match the BILLING_CATALOG_JSON pro_monthly id (defaults align).
 *
 * RESTORE DISCIPLINE: the synthetic workspace is a persistent fixture
 * (like scripts/cloud-seed.sql); every VOLATILE effect of this run —
 * subscription + billing-customer + webhook-event rows, the tier flip,
 * the tampered-signature security_events row — is restored in teardown,
 * and the seed re-asserts baseline on the next run (crash-safe). The
 * founder's real workspace is never touched: every id is a fixed
 * `e2eb…` synthetic.
 */

/** `/api/auth/me` fields this spec asserts (subset of MeEnvelope). */
interface BillingMe {
  activeMailboxId: string | null;
  tier: string;
  cleanupRemaining: number | null;
}

/** D202 error envelope (subset). */
interface ErrorEnvelope {
  error?: { code?: string };
}

/** `GET /api/billing/subscription` (subset of BillingSubscription). */
interface SubscriptionView {
  tier: string;
  foundingMember: boolean;
  subscription: { provider: string; status: string; cycle: string } | null;
}

/** Bare webhook controller response (not D202-enveloped). */
interface WebhookAck {
  status?: string;
}

// The browser rides the SYNTHETIC user's session, not the suite-wide
// storage state global-setup wrote for E2E_LOGIN_EMAIL.
test.use({ storageState: BILLING_STORAGE_STATE_PATH });

const api = new ApiClient(BILLING_STORAGE_STATE_PATH);
let sql: postgres.Sql;
let runStart: Date;
let negativeLegRan = false;

test.beforeAll(async () => {
  test.setTimeout(600_000); // route warming below can hit cold Next compiles
  // FIRST: the storage-state file must exist before ANY context is
  // created in this worker (the `test.use` option above is inherited
  // by every context, including `request.newContext()`).
  ensureBillingStorageState();
  runStart = new Date();
  sql = dbConnect();

  // Baseline (idempotent; global-setup already ran it — re-assert so a
  // crashed previous run can never leak volatile state into this one).
  await applyBillingSeed(sql);

  // Synthetic-user session — honest runtime probes, requireLiveStack-style.
  const loginProblem = await loginBillingUser(BILLING_SEED.email);
  test.skip(loginProblem !== null, loginProblem ?? undefined);

  const me = await api.get<BillingMe>('/api/auth/me');
  expect(me.activeMailboxId, 'seed must make the synthetic mailbox active').toBe(
    BILLING_SEED.mailboxId,
  );

  // Billing must be live on the api under test (503 = booted dark).
  const sub = await api.getRaw('/api/billing/subscription');
  test.skip(
    sub.status === 503,
    'api booted without BILLING_ENABLED=true (+ PADDLE_WEBHOOK_SECRET/BILLING_CATALOG_JSON) — see spec header',
  );
  expect(sub.status, 'billing subscription read must succeed for the seeded workspace').toBe(200);

  test.skip(
    BILLING_E2E_ENV.webhookSecret === '',
    'E2E_PADDLE_WEBHOOK_SECRET not set — must equal the PADDLE_WEBHOOK_SECRET the api was booted with',
  );

  // Warm the Next dev server for the routes this spec visits (compile
  // is auth-agnostic; global-setup already warmed /senders). Best-effort.
  const warm = await request.newContext({ baseURL: E2E_ENV.webUrl });
  for (const route of ['/screener', '/billing']) {
    try {
      await warm.get(route, { timeout: 600_000 });
    } catch {
      // Non-fatal — the spec's own navigations assert with real timeouts.
    }
  }
  await warm.dispose();
});

test.afterAll(async () => {
  if (sql) {
    // Volatile state → baseline: subscription/customer/event rows out,
    // tier back to free. (Seed re-asserts the same on the next run.)
    await resetBillingVolatileState(sql);
    // The tampered-signature leg wrote exactly one audit row via the
    // D181 security-events path — synthetic noise from a deliberate
    // negative test, removed on the same leave-no-trace rule as the
    // other specs' cleanup (scoped: type + source + this run's window).
    if (negativeLegRan && runStart) {
      await sql`
        DELETE FROM security_events
        WHERE event_type = 'webhook.signature_failure'
          AND payload->>'source' = 'billing.paddle'
          AND occurred_at >= ${runStart.toISOString()}
      `;
    }
    await sql.end();
  }
  await api.dispose();
});

test('free user hits the paywall; signed Paddle webhook flips the tier; Pro gates open', async ({
  page,
}) => {
  test.setTimeout(300_000); // six navigations on a real dev stack

  // ---- Baseline re-assert (tier/preferences are volatile — never
  // assume a prior step's state survived).
  const me = await api.get<BillingMe>('/api/auth/me');
  expect(me.tier).toBe('free');
  expect(me.cleanupRemaining, 'seed must leave 0 of 5 lifetime cleanup actions').toBe(0);

  // ---- 1. Paywall: Archive on /senders → D226 preview → confirm →
  // server 402 FREE_CAP_REACHED → the designed UpgradeModal.
  await page.goto('/senders');
  const card = page.getByTestId(`sender-card-${BILLING_SEED.archiveSenderId}`);
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button', { name: 'More actions' }).click();
  await card.getByRole('menuitem', { name: /Archive/ }).click();

  const preview = page.getByRole('dialog');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Preview · before anything changes');
  const confirm = preview.getByRole('button', { name: /Archive \d/ });
  await expect(confirm).toBeEnabled();
  await confirm.click();

  const upgradeModal = page.getByTestId('upgrade-modal');
  await expect(upgradeModal).toBeVisible({ timeout: 15_000 });
  await expect(upgradeModal).toContainText(/used all 5 free sender actions/);

  // The gate fired BEFORE any insert — the quota ledger still holds
  // exactly the 5 seeded units and nothing else.
  const stray = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM action_jobs
    WHERE mailbox_account_id = ${BILLING_SEED.mailboxId}
      AND idempotency_key NOT LIKE ${BILLING_SEED.quotaKeyPrefix + '%'}
  `;
  expect(stray[0]!.n, 'a capped enqueue must write NO action_jobs row').toBe(0);

  // The modal's designed funnel (D117 one-path): the CTA deep-links the
  // nudged plan into /billing's confirm step — the D226 preview opens
  // pre-selected, one click from the provider surface.
  await upgradeModal.getByRole('link', { name: 'Upgrade to Plus' }).click();
  await expect(page).toHaveURL(/\/billing\?plan=plus&cycle=monthly/);
  const planCard = page.getByTestId('current-plan-card');
  await expect(planCard).toBeVisible({ timeout: 60_000 });
  await expect(planCard).toContainText('Free');
  await expect(planCard).toContainText('0 of 5 lifetime cleanup actions left.');
  await expect(page.getByTestId('checkout-panel')).toBeVisible();
  await expect(page.getByTestId('checkout-panel')).toContainText(
    'Preview · before anything changes',
  );

  // ---- 2. Pro surface paywall: /screener renders the upsell for a
  // Free workspace (client tier gate) AND the API 402s underneath.
  await page.goto('/screener');
  await expect(page.getByText('A queue of new senders, ready when you are.')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: 'See Pro plans' })).toBeVisible();
  const gated = await api.getRaw('/api/screener/queue?limit=5');
  expect(gated.status, 'screener read must 402 for a Free workspace').toBe(402);
  expect((gated.body as ErrorEnvelope).error?.code).toBe('PRO_FEATURE_REQUIRED');

  // ---- 3. Provider webhook. One payload for the whole leg — the
  // replay below must reuse the exact event id.
  const ids = paddleRunIds();
  const payload = paddleSubscriptionActivated({
    ...ids,
    priceId: BILLING_E2E_ENV.proMonthlyPriceId,
    workspaceId: BILLING_SEED.workspaceId,
    periodEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });

  // 3a. Tampered signature → 401, and NOTHING changed (the door is
  // locked, not decorative). Signed properly — just with a wrong secret.
  negativeLegRan = true;
  const denied = await postPaddleWebhook({ payload, secret: 'e2e-not-the-real-secret' });
  expect(denied.status, 'a wrong-secret signature must be rejected').toBe(401);
  const tierAfterDenied = await sql<{ tier: string }[]>`
    SELECT tier FROM workspaces WHERE id = ${BILLING_SEED.workspaceId}
  `;
  expect(tierAfterDenied[0]!.tier).toBe('free');

  // 3b. Byte-exact valid signature → processed; the tier flip is
  // synchronous inside the webhook request (D117 grant path).
  const accepted = await postPaddleWebhook({
    payload,
    secret: BILLING_E2E_ENV.webhookSecret,
  });
  expect(
    accepted.status,
    `valid webhook must 200 — got ${accepted.status} (${JSON.stringify(accepted.body)}); ` +
      'does E2E_PADDLE_WEBHOOK_SECRET match the PADDLE_WEBHOOK_SECRET the api booted with?',
  ).toBe(200);
  expect(
    (accepted.body as WebhookAck).status,
    'an unknown price id is (correctly) ignored — BILLING_CATALOG_JSON must map ' +
      `pro_monthly to ${BILLING_E2E_ENV.proMonthlyPriceId} (E2E_PADDLE_PRICE_ID)`,
  ).toBe('processed');
  const tierAfterGrant = await sql<{ tier: string }[]>`
    SELECT tier FROM workspaces WHERE id = ${BILLING_SEED.workspaceId}
  `;
  expect(tierAfterGrant[0]!.tier).toBe('pro');

  // ---- 4. Entitlements flip on the wire: tier=pro, quota lifted.
  await expect
    .poll(async () => (await api.get<BillingMe>('/api/auth/me')).tier, {
      timeout: 30_000,
      message: 'auth/me must report tier=pro after the webhook grant',
    })
    .toBe('pro');
  expect((await api.get<BillingMe>('/api/auth/me')).cleanupRemaining).toBeNull();

  // ---- 5. Gates open: /screener now renders the seeded queue (fresh
  // page load ⇒ fresh me fetch — no stale client cache in play).
  await page.goto('/screener');
  const queueList = page.getByRole('list', { name: 'Screener queue' });
  await expect(queueList).toBeVisible({ timeout: 60_000 });
  await expect(queueList).toContainText(BILLING_SEED.screenerSenderName);
  await expect(page.getByText('A queue of new senders, ready when you are.')).toHaveCount(0);
  const opened = await api.getRaw('/api/screener/queue?limit=5');
  expect(opened.status, 'screener read must open for the Pro workspace').toBe(200);

  // ---- 6. /billing shows the ACTIVE plan.
  await page.goto('/billing');
  const proCard = page.getByTestId('current-plan-card');
  await expect(proCard).toBeVisible({ timeout: 60_000 });
  await expect(proCard).toContainText('Pro');
  await expect(proCard).toContainText('via Paddle');
  await expect(proCard).toContainText('Next renewal');
  await expect(proCard.getByRole('button', { name: 'Cancel subscription' })).toBeVisible();
  const sub = await api.get<SubscriptionView>('/api/billing/subscription');
  expect(sub.tier).toBe('pro');
  expect(sub.foundingMember, 'pro_monthly is not the founding price').toBe(false);
  expect(sub.subscription?.provider).toBe('paddle');
  expect(sub.subscription?.status).toBe('active');
  expect(sub.subscription?.cycle).toBe('monthly');

  // ---- 7. At-least-once safety: replaying the SAME event id acks as
  // a duplicate and double-applies nothing.
  const replay = await postPaddleWebhook({ payload, secret: BILLING_E2E_ENV.webhookSecret });
  expect(replay.status).toBe(200);
  expect((replay.body as WebhookAck).status).toBe('duplicate');
  const subRows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM subscriptions WHERE workspace_id = ${BILLING_SEED.workspaceId}
  `;
  expect(subRows[0]!.n).toBe(1);
});
