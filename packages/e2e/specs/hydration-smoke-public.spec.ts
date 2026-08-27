import { expect, test, type Page } from '@playwright/test';

test.use({ locale: 'de-DE', timezoneId: 'Asia/Kolkata' });

/**
 * PUBLIC cold-navigation hydration gate.
 *
 * The sibling `hydration-smoke.spec.ts` covers fifteen AUTHENTICATED
 * routes and nothing else, so until this file the `(marketing)` group —
 * every page a cold visitor, a crawler or an answer engine ever sees —
 * had no hydration coverage at all. That gap is why a 2026-08-27 report
 * of "every marketing page throws a hydration error" took a browser, a
 * production build and a hand-built detector to answer instead of one
 * command. It was not reproducible on `main` or on the open comparison
 * branch; the point of this file is that the next such question is
 * answered by CI.
 *
 * Why it matters beyond a console line: React discards the server tree
 * on a mismatch and re-renders the whole subtree on the client, which
 * lands directly on LCP and INP for the pages ranking depends on.
 *
 * AUTH-FREE and GMAIL-FREE, deliberately, and it must stay that way.
 * These routes render under `apps/web/src/app/(marketing)/layout.tsx`,
 * which has no `AuthProvider` in its chain. The suite-wide
 * `storageState` still applies but nothing here reads it, so this file
 * does NOT call `requireLiveStack()` — gating auth-free routes on a
 * mailbox would skip the entire file the moment the seed is absent, and
 * `scripts/assert-e2e-ran.mjs` fails a suite that reports any skip.
 *
 * ONE TEST PER ROUTE, for the reason the authed file documents at
 * length: `playwright.config.ts` sets `timeout` per TEST, so a single
 * walking test makes a slow runner fail whichever route happens to be
 * last and names the wrong page.
 *
 * `de-DE` / `Asia/Kolkata` are pinned here rather than in CI, matching
 * the authed lane. A locale-dependent render is the single most common
 * source of this defect, and it is invisible to an en-US runner.
 */

/**
 * One member per public renderer, not every public page — the long-form
 * clusters share a renderer, so one member proves the template. This
 * mirrors `PUBLIC_ROUTES` in `a11y-public.spec.ts` and is kept as its
 * own list on purpose: that file is a required accessibility gate, and
 * coupling two gates to one array means a coverage edit for either has
 * to reason about both.
 *
 *   landing        bespoke composition (hero, trust strip, FAQ, CTA)
 *   pricing        interactive: cycle toggle, tier cards, compare table
 *   inbox-sim      the only genuinely interactive public surface
 *   compare        comparison INDEX renderer
 *   vs/*           comparison DETAIL renderer (table-heavy)
 *   how-to/*       LearnArticle renderer, shared with /answers/*
 *   security       LegalPageLayout renderer, shared with the other 5
 *   how-it-works   ProductStoryShell renderer, shared with /methodology
 *   faq            FAQ surface
 */
const PUBLIC_HYDRATED_ROUTES = [
  '/',
  '/pricing',
  '/inbox-simulator',
  '/compare',
  '/vs/unroll-me',
  '/how-to/clean-gmail-by-sender',
  '/security',
  '/how-it-works',
  '/faq',
] as const;

/**
 * Navigate to `route` and assert it mounted from the server tree with no
 * hydration recovery.
 *
 * Duplicated from `hydration-smoke.spec.ts` rather than extracted into a
 * shared helper: that file is a required CI gate whose assertions were
 * tuned against real failures, and this file cannot be smoked against
 * the same stack, so editing it to share twenty lines buys less than it
 * risks. If a third caller appears, extract then.
 *
 * Both listener kinds are needed. React reports a dev mismatch through
 * `console.error` and a PRODUCTION one as an uncaught `Minified React
 * error #418`, which only `pageerror` sees — verified both ways on
 * 2026-08-27 by injecting a `typeof window` branch into the marketing
 * header and watching each fire.
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

for (const route of PUBLIC_HYDRATED_ROUTES) {
  test(`public route mounts without hydration recovery: ${route}`, async ({ page }) => {
    await expectRouteHydrates(page, route);
  });
}
