import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { ApiClient, requireLiveStack } from '../helpers/api';
import { dbConnect } from '../helpers/db';
import { BILLING_SEED } from '../helpers/seed-billing';
import { expectScreenMounted } from '../helpers/screen-ready';

test.use({ locale: 'de-DE', timezoneId: 'Asia/Kolkata' });

/**
 * Read-only cold-navigation coverage for authenticated server hydration.
 *
 * These routes intentionally render successful query data in the first
 * HTML response. A component that reads the browser clock, locale, or a
 * browser-only catalog during render can therefore look correct after
 * React recovers while still discarding the server tree. Treat React's
 * hydration diagnostics as a route failure rather than a harmless log.
 *
 * ONE TEST PER ROUTE, not one loop over all of them (2026-08-21).
 *
 * This was a single test walking every route in sequence, so all 16
 * navigations shared ONE 120s budget — `playwright.config.ts` sets
 * `timeout` per TEST, not per navigation. Two things followed, and both
 * bit on `main`:
 *
 *   1. A slow runner failed the LAST route regardless of that route's
 *      health. CI run 32536521106 timed out on `/admin/security` after
 *      the other 15 passed, on a runner whose Postgres service logged a
 *      45.5s checkpoint for 458 buffers. The report named the wrong
 *      route, and an exhausted budget read as a product bug.
 *   2. `/senders` runs first and is the slowest route in the product, so
 *      it spent the budget the later routes still needed.
 *
 * Split, each route gets its own budget and a failure names the route
 * that actually failed. Coverage is identical: same routes, same
 * assertions, same order.
 *
 * The sender-detail case used to `routes.push()` INTO THE ARRAY BEING
 * ITERATED, so the navigation count depended on what discovery found. It
 * now rides inside the `/senders` test, where the list it is discovered
 * from is rendered, and against that test's own budget.
 */

const api = new ApiClient();

/** Static routes that must hydrate from the server tree without recovery. */
const HYDRATED_ROUTES = [
  '/home',
  '/senders',
  '/triage',
  '/activity',
  '/autopilot',
  '/billing',
  '/brief',
  '/followups',
  '/later',
  '/quiet',
  '/screener',
  '/settings',
  '/settings/privacy',
  '/settings/senders',
  '/onboarding',
  '/admin/security',
] as const;

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  test.skip(live.mailboxId === null, 'reason' in live ? live.reason : undefined);
});

test.afterAll(async () => {
  await api.dispose();
});

/**
 * Navigate to `route` and assert it mounted from the server tree with no
 * hydration recovery. These are the assertions the single walking test
 * ran, unchanged — only the enclosing structure moved.
 */
async function expectRouteHydrates(page: Page, route: string): Promise<void> {
  const hydrationErrors: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (
      message.type() === 'error' &&
      (text.includes('Hydration failed') || text.includes('Minified React error #418'))
    ) {
      hydrationErrors.push(text);
    }
  });
  page.on('pageerror', (error: Error) => hydrationErrors.push(error.message));

  const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
  await page.locator('body').waitFor({ state: 'visible' });
  if (route === '/autopilot') {
    // Free mounts the read-only preset preview; paid plans mount the library.
    // The preview has no help registration or collapsible preset section.
    const readOnlyPreview = page.getByTestId('autopilot-observe-preview');
    const senderLibrary = page.getByTestId('sender-rule-library');
    await expect(readOnlyPreview.or(senderLibrary)).toHaveCount(1);
    const essential = page.getByRole('button', { name: 'Essential only', exact: true });
    if (await essential.isVisible()) await essential.click();
    if (await senderLibrary.count()) {
      // A nonempty shell can precede the streamed sections and their diagnostics.
      await expectScreenMounted(page);
      await page.getByText(/^Preset rules ·/).click();
    } else {
      await expect(readOnlyPreview).toBeVisible();
      await expect(readOnlyPreview.getByRole('link', { name: /^Upgrade to / })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Rules', exact: true })).toBeVisible();
    for (const label of [
      'Loading Autopilot rules',
      'Loading Autopilot suggestions',
      'Loading your preset rules…',
      'Checking rule suggestions…',
    ])
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }
  await page.waitForTimeout(750);

  expect(response?.status(), `${route} response`).toBe(200);
  expect(
    (await page.locator('body').innerText()).trim().length,
    `${route} content`,
  ).toBeGreaterThan(0);
  await expect(
    page.locator('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay'),
    `${route} framework overlay`,
  ).toHaveCount(0);
  expect(hydrationErrors, `${route} hydration diagnostics`).toEqual([]);
}

/** Enough repeats to hit the races that showed up in 6 of 18 and 16 of 18 loads. */
const HYDRATION_LOADS = 6;

async function expectLoadsHydrate(
  page: Page,
  route: string,
  settled: () => Promise<void>,
): Promise<void> {
  const hydrationErrors: string[] = [];
  const onConsole = (message: ConsoleMessage) => {
    const text = message.text();
    if (
      message.type() === 'error' &&
      (text.includes('Hydration failed') || text.includes('Minified React error #418'))
    ) {
      hydrationErrors.push(text);
    }
  };
  const onPageError = (error: Error) => hydrationErrors.push(error.message);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    for (let load = 1; load <= HYDRATION_LOADS; load += 1) {
      hydrationErrors.length = 0;
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.locator('body').waitFor({ state: 'visible' });
      await page.waitForTimeout(750);
      expect(response?.status(), `${route} load ${load}`).toBe(200);
      expect(hydrationErrors, `${route} load ${load} hydration diagnostics`).toEqual([]);
      await settled();
    }
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
}

test('Pro Brief with undecided consent hydrates across repeated loads', async ({ page }) => {
  test.setTimeout(180_000);
  const sql = dbConnect();
  const [before] = await sql<{ tier: string }[]>`
    SELECT tier FROM workspaces WHERE id = ${BILLING_SEED.workspaceId}
  `;
  try {
    await sql`UPDATE workspaces SET tier = 'pro' WHERE id = ${BILLING_SEED.workspaceId}`;
    await sql`
      UPDATE users SET
        ai_consent_version = NULL,
        ai_explanations_consent_at = NULL,
        ai_explanations_revoked_at = NULL,
        ai_consent_scopes = NULL,
        ai_consent_declined_at = NULL,
        brief_ai_consent_at = NULL,
        brief_ai_consent_version = NULL,
        brief_ai_consent_revoked_at = NULL,
        brief_ai_declined_at = NULL
      WHERE id = ${BILLING_SEED.userId}
    `;
    await expectLoadsHydrate(page, '/brief', async () => {
      await expect(
        page.getByRole('heading', { name: 'Use AI to explain and summarize?' }),
      ).toBeVisible();
    });
  } finally {
    if (before) {
      await sql`UPDATE workspaces SET tier = ${before.tier} WHERE id = ${BILLING_SEED.workspaceId}`;
    }
    await sql.end();
  }
});

test('billing hydrates across repeated loads when the subscription read is disabled', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.context().addCookies([
    {
      name: 'dm_e2e_billing_dark',
      value: '1',
      url: process.env.E2E_WEB_URL ?? 'http://127.0.0.1:3104',
    },
  ]);
  await page.route('**/api/billing/subscription', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'BILLING_DISABLED', message: 'Billing is not available yet.' },
      }),
    });
  });
  await expectLoadsHydrate(page, '/billing', async () => {
    await expect(page.getByTestId('billing-disabled-notice')).toBeVisible();
  });
});

function usd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

function manifestPrice(tier: 'plus' | 'pro', cycle: 'monthly' | 'annual'): string {
  const point = TIER_MANIFEST[tier].prices[cycle];
  if (!point) throw new Error(`missing ${cycle} price for ${tier}`);
  return `${usd(point.usdCents)}${cycle === 'annual' ? '/yr' : '/mo'}`;
}

/**
 * Free, complimentary Pro, and paid Plus fixtures restore the synthetic
 * workspace. The grant and the paid row belong to this spec.
 */
async function withBillingFixture(
  setup: 'free' | 'complimentary-pro' | 'paid-plus',
  run: () => Promise<void>,
): Promise<void> {
  const sql = dbConnect();
  try {
    const [workspace] = await sql<{ tier: string }[]>`
      SELECT tier FROM workspaces WHERE id = ${BILLING_SEED.workspaceId}
    `;
    const grants = await sql<{ id: string }[]>`
      SELECT id FROM entitlement_grants WHERE email = ${BILLING_SEED.email}
    `;
    const subscriptions = await sql<{ id: string }[]>`
      SELECT id FROM subscriptions WHERE workspace_id = ${BILLING_SEED.workspaceId}
    `;
    if (!workspace) throw new Error('Hydration fixture requires its seeded synthetic workspace.');
    // Fail before any write or teardown if the disposable seed has billing state.
    expect(grants, 'Hydration fixture requires an empty grant baseline').toHaveLength(0);
    expect(subscriptions, 'Hydration fixture requires an empty subscription baseline').toHaveLength(
      0,
    );

    try {
      if (setup === 'complimentary-pro') {
        await sql`UPDATE workspaces SET tier = 'pro' WHERE id = ${BILLING_SEED.workspaceId}`;
        await sql`
          INSERT INTO entitlement_grants (email, tier, reason, granted_by, source)
          VALUES (${BILLING_SEED.email}, 'pro', 'hydration smoke', 'e2e', 'comp')
        `;
      } else if (setup === 'free') {
        await sql`UPDATE workspaces SET tier = 'free' WHERE id = ${BILLING_SEED.workspaceId}`;
      } else {
        await sql`UPDATE workspaces SET tier = 'plus' WHERE id = ${BILLING_SEED.workspaceId}`;
        await sql`
          INSERT INTO subscriptions (
            workspace_id, provider, provider_subscription_id, tier, status,
            provider_price_id, billing_cycle, current_period_end
          ) VALUES (
            ${BILLING_SEED.workspaceId}, 'paddle', 'sub_e2e_hydration_paid', 'plus', 'active',
            'pri_e2e_hydration', 'monthly', now() + interval '30 days'
          )
        `;
      }
      await run();
    } finally {
      await sql`DELETE FROM subscriptions WHERE workspace_id = ${BILLING_SEED.workspaceId} AND provider_subscription_id = 'sub_e2e_hydration_paid'`;
      await sql`UPDATE workspaces SET tier = ${workspace.tier} WHERE id = ${BILLING_SEED.workspaceId}`;
      await sql`
        DELETE FROM entitlement_grants WHERE email = ${BILLING_SEED.email}
          AND source = 'comp' AND reason = 'hydration smoke' AND granted_by = 'e2e'
      `;
    }
  } finally {
    await sql.end();
  }
}

test('live Pro complimentary billing hydrates on annual across repeated loads', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await withBillingFixture('complimentary-pro', async () => {
    await expectLoadsHydrate(page, '/billing', async () => {
      await expect(page.getByTestId('complimentary-note')).toContainText(
        'Pro is complimentary on this account',
      );
      await expect(page.getByRole('button', { name: /^Annual/, pressed: true })).toBeVisible();
      await expect(page.getByText(manifestPrice('plus', 'annual')).first()).toBeVisible();
      await expect(page.getByText(manifestPrice('pro', 'annual')).first()).toBeVisible();
    });
  });
});

test('live Pro complimentary billing hydrates with the monthly toggle selected', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await withBillingFixture('complimentary-pro', async () => {
    await expectLoadsHydrate(page, '/billing?plan=plus&cycle=monthly', async () => {
      await expect(page.getByTestId('complimentary-note')).toContainText(
        'Pro is complimentary on this account',
      );
      await expect(page.getByRole('button', { name: 'Monthly', pressed: true })).toBeVisible();
      await expect(page.getByText(manifestPrice('plus', 'monthly')).first()).toBeVisible();
    });
  });
});

test('a normal paid plan hydrates across repeated loads', async ({ page }) => {
  test.setTimeout(180_000);
  await withBillingFixture('paid-plus', async () => {
    await expectLoadsHydrate(page, '/billing', async () => {
      await expect(page.getByTestId('complimentary-note')).toHaveCount(0);
      await expect(page.getByText(manifestPrice('plus', 'monthly')).first()).toBeVisible();
      await expect(page.getByTestId('current-plan-card')).toContainText('Plus');
    });
  });
});

test('paid Autopilot library hydrates with its preset review section', async ({ page }) => {
  await withBillingFixture('paid-plus', async () => {
    await expectRouteHydrates(page, '/autopilot');
    await expect(page.getByTestId('sender-rule-library')).toBeVisible();
    await expect(page.getByTestId('autopilot-observe-preview')).toHaveCount(0);
  });
});

test('Free Autopilot read-only preview hydrates with its upgrade link', async ({ page }) => {
  await withBillingFixture('free', async () => {
    await expectRouteHydrates(page, '/autopilot');
    await expect(page.getByTestId('autopilot-observe-preview')).toBeVisible();
    await expect(page.getByTestId('sender-rule-library')).toHaveCount(0);
  });
});

test('settings hydrates across repeated loads', async ({ page }) => {
  test.setTimeout(180_000);
  await expectLoadsHydrate(page, '/settings', async () => {
    await expect(page.getByRole('heading', { name: 'Gmail accounts' })).toBeVisible();
  });
});

for (const route of HYDRATED_ROUTES) {
  test(`server-hydrated route mounts without recovery: ${route}`, async ({ page }) => {
    await expectRouteHydrates(page, route);

    // The sender DETAIL route can only be named once a list has rendered,
    // so its discovery rides here, inside this test's own budget.
    //
    // Tolerant of an empty list ON PURPOSE, exactly as the walking test
    // was: `requireLiveStack` guarantees an active mailbox and nothing
    // more, so rows are not promised. `test.skip()` would be wrong here —
    // `scripts/assert-e2e-ran.mjs` FAILS a suite that reports any skip,
    // so an empty seed would turn a healthy run red.
    if (route !== '/senders') return;
    // Every list row's name is a real link to its detail page, present
    // in the server HTML — no click (and so no hydration race) is needed
    // to discover the route.
    const detailLink = page.locator('[data-testid^="sender-row-"] a[href^="/senders/"]').first();
    if ((await detailLink.count()) === 0) return;
    const detailRoute = await detailLink.getAttribute('href');
    expect(detailRoute, 'sender row rendered no detail link').not.toBeNull();
    await expectRouteHydrates(page, detailRoute!);
  });
}
