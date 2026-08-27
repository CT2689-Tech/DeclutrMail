/// <reference lib="dom" />

import { expect, test } from '@playwright/test';

import { expectNoBlockingAxeViolations, expectNoViewportOverflow } from '../helpers/a11y';

/**
 * PUBLIC accessibility release gate.
 *
 * The sibling `a11y-smoke.spec.ts` covers five AUTHENTICATED screens and
 * nothing else, so until this file the marketing surface — the pages a
 * cold visitor actually lands on, and the only pages a launch audience
 * ever sees — had no accessibility gate at all.
 *
 * GMAIL-FREE and AUTH-FREE: every route here renders in the
 * `(marketing)` route group, which has no `AuthProvider` in its chain
 * (see `apps/web/src/app/(marketing)/layout.tsx`). The shared
 * `storageState` still applies, but nothing asserted below depends on
 * session state.
 *
 * Runs in the same two projects as the authed lane:
 *   - desktop, 1280×800
 *   - mobile, 375×812 with `prefers-reduced-motion: reduce`
 *
 * The mobile pass is the point. Horizontal overflow at phone widths is a
 * recurring finding in this repo that static CSS reading could not
 * settle; `expectNoViewportOverflow` measures the rendered document.
 */

/**
 * Representative coverage of every public page TYPE, not every page —
 * the long-form clusters share one renderer each, so one member proves
 * the template.
 *
 *   landing        bespoke composition (hero, trust strip, FAQ, CTA)
 *   pricing        interactive: cycle toggle, tier cards, compare table
 *   inbox-sim      the only genuinely interactive public surface
 *   compare        comparison INDEX renderer
 *   vs/*           comparison DETAIL renderer (table-heavy)
 *   alternatives/* round-up renderer — its own component, and the one
 *                  whose card grid and definition lists nothing else
 *                  on this list would exercise
 *   how-to/*       LearnArticle renderer, shared with /answers/*
 *   security       LegalPageLayout renderer, shared with the other 5
 *   privacy        the longest legal page — TOC + 12 sections
 *   how-it-works   ProductStoryShell renderer, shared with /methodology
 *   faq            FAQ surface
 *   contact        short support page (published addresses)
 */
const PUBLIC_ROUTES = [
  '/',
  '/pricing',
  '/inbox-simulator',
  '/compare',
  '/vs/unroll-me',
  '/alternatives/clean-email',
  '/how-to/clean-gmail-by-sender',
  '/security',
  '/privacy',
  '/how-it-works',
  '/faq',
  '/contact',
] as const;

/**
 * Reduced motion in BOTH projects, unlike the authed lane.
 *
 * The landing hero's illustrative sequence runs `8s 1 forwards` and the
 * section reveals are a 0.7s fade with up to 0.24s of stagger, so an
 * axe scan that starts as soon as the h1 is visible measures elements
 * mid-fade and reports their PARTIAL opacity as a contrast failure. That
 * is a race, not a defect: `.dm-mkt-hero-note` settles at 5.11:1 light
 * and 6.04:1 dark, comfortably over the 4.5:1 floor.
 *
 * Emulating `prefers-reduced-motion: reduce` takes the global override
 * in `packages/shared/src/styles/tokens.css:386`, which collapses those
 * animations to their end state. So this scans the settled presentation
 * — the one contrast rules actually govern — deterministically, and it
 * scans the reduced-motion path, which is itself a shipped
 * accessibility feature.
 */
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    'the public accessibility lane must emulate reduced motion in every project',
  ).toBe(true);
});

for (const path of PUBLIC_ROUTES) {
  test(`${path} passes the public accessibility smoke`, async ({ page }) => {
    await page.goto(path);

    // Ready signal: the landmark plus a level-1 heading. Every public
    // page ships exactly one h1, and waiting on it (rather than on
    // `main` alone) means the scan runs against settled content instead
    // of a shell — the same failure the authed lane's ready-signal
    // comment documents.
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });

    await expectNoViewportOverflow(page);
    await expectNoBlockingAxeViolations(page);
  });
}

test('the public shell exposes a working skip link as the first tab stop', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: /skip/i });
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page.getByRole('main')).toBeVisible();
});
