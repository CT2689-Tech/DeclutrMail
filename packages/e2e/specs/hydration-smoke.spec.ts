import { expect, test } from '@playwright/test';

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
 */

const api = new ApiClient();

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  test.skip(live.mailboxId === null, 'reason' in live ? live.reason : undefined);
});

test.afterAll(async () => {
  await api.dispose();
});

test('authenticated server-hydrated routes mount without recovery', async ({ page }) => {
  const routes = [
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
  ];

  for (const route of routes) {
    const hydrationErrors: string[] = [];
    const onConsole = (message: { type(): string; text(): string }) => {
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

    if (route === '/senders') {
      const firstPeek = page.locator('button[data-dm-peek]').first();
      if ((await firstPeek.count()) > 0) {
        await firstPeek.click();
        const senderDetailRoute = await page
          .locator('a[href^="/senders/"]')
          .first()
          .getAttribute('href');
        if (senderDetailRoute !== null) routes.push(senderDetailRoute);
      }
    }

    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
});
