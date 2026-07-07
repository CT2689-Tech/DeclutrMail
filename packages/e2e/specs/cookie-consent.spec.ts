/// <reference lib="dom" />
// ^ page.evaluate callbacks below run in the BROWSER and read
//   window/localStorage; the e2e tsconfig is Node-only, so pull the
//   DOM lib in for this file alone.

import { gunzipSync } from 'node:zlib';

import { expect, test, type Page } from '@playwright/test';

import { E2E_ENV } from '../helpers/env';

/**
 * D147 cookie-consent flow — the privacy-policy promise under test:
 * "Optional analytics (PostHog) is initialized only after you accept
 * it in the cookie banner; it is off by default."
 *
 * Both specs run against the public marketing surface (no login, no
 * Gmail, no worker), on a FRESH browser profile — the suite-wide
 * authed storageState is overridden so no prior consent (or session)
 * leaks in. Every PostHog request is route-intercepted and fulfilled
 * locally, so nothing ever reaches the real PostHog and the specs can
 * assert exactly what left the browser.
 *
 * The DECLINE spec runs against any web build (with no
 * `NEXT_PUBLIC_POSTHOG_KEY` its network assertion is vacuous — the
 * banner/persistence assertions still bite). The ACCEPT spec observes
 * real SDK traffic, so it needs the web server booted with a key and
 * skips honestly otherwise. Recipe:
 *
 *     PORT=3104 NEXT_PUBLIC_API_URL=http://localhost:4104 \
 *     NEXT_PUBLIC_POSTHOG_KEY=phc_e2e_dummy \
 *       pnpm --filter @declutrmail/web dev
 *
 *     E2E_POSTHOG=1 pnpm e2e -- cookie-consent
 *
 * (A dummy key is fine — interception keeps all traffic local. If the
 * web server uses a custom `NEXT_PUBLIC_POSTHOG_HOST`, export the same
 * value for the spec run so the interceptor covers it.)
 */

/* Fresh profile: no auth cookies, no stored consent.
 *
 * The browser must NOT look automated: posthog-js silently drops every
 * capture from a "likely bot" (posthog-core `capture()` →
 * `isLikelyBot`), which checks the UA string ('headlesschrome', …),
 * `userAgentData.brands`, and `navigator.webdriver` — the last is
 * always true under Playwright. Without the UA override + the init
 * script below, the ACCEPT spec could never observe an event, and
 * worse, the DECLINE spec's "zero requests" would pass vacuously even
 * against a broken consent gate. */
test.use({
  storageState: { cookies: [], origins: [] },
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
  });
});

test.beforeAll(async () => {
  let webUp = true;
  try {
    await fetch(E2E_ENV.webUrl, { signal: AbortSignal.timeout(5_000) });
  } catch {
    webUp = false;
  }
  test.skip(!webUp, `web not reachable at ${E2E_ENV.webUrl} — boot it per playwright.config.ts`);
});

/**
 * Decode a posthog-js capture body. The SDK gzips by default
 * (`compression=gzip-js` in the query string); older/fallback paths
 * send form-encoded `data=<base64>` or plain JSON. Return SOMETHING
 * text-searchable in all three cases.
 */
function decodePosthogBody(buf: Buffer | null, url: string): string {
  if (!buf) return '';
  if (url.includes('compression=gzip-js')) {
    try {
      return gunzipSync(buf).toString('utf8');
    } catch {
      // Not actually gzipped — fall through to the text paths.
    }
  }
  const text = buf.toString('utf8');
  const encoded = /(?:^|&)data=([^&]+)/.exec(text)?.[1];
  if (encoded) {
    try {
      return Buffer.from(decodeURIComponent(encoded), 'base64').toString('utf8');
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * Intercept every request bound for PostHog (default cloud host or a
 * custom `NEXT_PUBLIC_POSTHOG_HOST`), record it, and answer `{}` so
 * the SDK stays happy without touching the network.
 */
async function interceptPosthog(page: Page): Promise<{ url: string; body: string }[]> {
  const collected: { url: string; body: string }[] = [];
  const customHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  await page.route(
    (url) => url.href.includes('posthog.com') || (!!customHost && url.href.startsWith(customHost)),
    async (route) => {
      const req = route.request();
      collected.push({
        url: req.url(),
        body: decodePosthogBody(req.postDataBuffer() ?? null, req.url()),
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    },
  );
  return collected;
}

test('decline is the default: "Essential only" persists and PostHog stays fully silent', async ({
  page,
}) => {
  const posthogRequests = await interceptPosthog(page);

  await page.goto('/');
  const banner = page.getByTestId('cookie-consent-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('We use essential cookies for sign-in and billing.');
  await expect(banner).toContainText('We never see your inbox content.');

  await page.getByRole('button', { name: 'Essential only' }).click();
  await expect(banner).toBeHidden();

  // Remount the page_viewed emitter (the landing nav tracks on mount).
  // With consent declined the call must stay a no-op.
  await page.reload();
  await expect(banner).toBeHidden(); // the banner never returns (D147)
  // Negative network assertion needs a window — a leaking SDK would
  // import, init, and fire within moments of the mount above.
  await page.waitForTimeout(2_000);

  expect(posthogRequests).toEqual([]);

  // Stronger, transport-independent: PostHog's init writes ph_*
  // storage. Declined ⇒ the SDK never initialized ⇒ zero artifacts.
  const phStorageKeys = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((k) => k.startsWith('ph_')),
  );
  expect(phStorageKeys).toEqual([]);
  const cookies = await page.context().cookies();
  expect(cookies.filter((c) => c.name.startsWith('ph_'))).toEqual([]);

  // The choice itself is persisted in both stores (D147 + mirror).
  const storedChoice = await page.evaluate(() => window.localStorage.getItem('dm-cookie-consent'));
  expect(storedChoice).toBe('essential');
  expect(cookies.find((c) => c.name === 'dm_cookie_consent')?.value).toBe('essential');
});

test('"Accept all" initializes PostHog and page_viewed reaches the wire', async ({ page }) => {
  test.skip(
    process.env.E2E_POSTHOG !== '1',
    'needs the web server booted with NEXT_PUBLIC_POSTHOG_KEY — set E2E_POSTHOG=1 (recipe in the header)',
  );

  const posthogRequests = await interceptPosthog(page);

  await page.goto('/');
  const banner = page.getByTestId('cookie-consent-banner');
  await expect(banner).toBeVisible();
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect(banner).toBeHidden();

  // Remount the landing page_viewed emitter — now consented, the SDK
  // must initialize and the capture must leave the browser.
  await page.reload();
  await expect(banner).toBeHidden(); // choice survived the reload

  await expect
    .poll(() => posthogRequests.some((r) => r.body.includes('page_viewed')), {
      timeout: 15_000,
      message: 'expected a PostHog capture containing page_viewed after Accept all',
    })
    .toBe(true);
});
