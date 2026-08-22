import { expect, test, type Page } from '@playwright/test';

import { ApiClient, requireLiveStack } from '../helpers/api';

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
    const firstPeek = page.locator('button[data-dm-peek]').first();
    if ((await firstPeek.count()) === 0) return;
    await firstPeek.click();
    const detailRoute = await page.locator('a[href^="/senders/"]').first().getAttribute('href');
    if (detailRoute === null) return;
    await expectRouteHydrates(page, detailRoute);
  });
}
