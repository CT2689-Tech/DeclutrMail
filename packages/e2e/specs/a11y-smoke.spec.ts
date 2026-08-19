/// <reference lib="dom" />

import { expect, test, type Page } from '@playwright/test';

import { expectNoBlockingAxeViolations, expectNoViewportOverflow } from '../helpers/a11y';

/**
 * Authenticated accessibility release gate.
 *
 * GMAIL-FREE: global setup signs in as the fixed synthetic workspace from
 * `seed-billing.ts`. These tests perform reads and local keyboard interaction
 * only. They never enqueue an action, call Gmail, or require a worker.
 *
 * The focused CI lane runs this file in two projects:
 *   - desktop, 1280×800
 *   - mobile, 375×812 with `prefers-reduced-motion: reduce`
 */

const ROUTES = [
  { path: '/senders', readyRole: 'region', readyName: 'About How Senders works' },
  // A3 (D19) granted Free the real Triage screen, not the TierGate
  // placeholder. The "How Triage works" ScreenIntro is NOT a valid ready
  // signal here — triage-screen.tsx renders it unconditionally for the
  // 'daily' journey regardless of `state.kind`, so it appears before the
  // queue/stats reads ever settle and the gate would pass on a page
  // permanently stuck on "Loading your decisions…". Anchor on the
  // composed h1 instead, which only reaches this text once
  // `composeTriageState` has left 'loading' for a real outcome —
  // 'ready' (N decisions) or 'empty' (nothing waiting). A genuine load
  // failure ('error') is deliberately EXCLUDED so it still times out
  // and fails the gate rather than being waved through.
  {
    path: '/triage',
    readyRole: 'heading',
    readyName: /^(\d+ decisions?, one at a time\.|Nothing waiting\.)$/,
  },
  { path: '/activity', readyRole: 'region', readyName: 'About Activity' },
  { path: '/settings/privacy', readyRole: 'region', readyName: 'About Privacy & Data' },
  { path: '/billing', readyRole: 'region', readyName: 'About Plan & billing' },
] as const;

const MOBILE_PROJECT = 'a11y-mobile-reduced-motion';

/**
 * The trust strip (plain-language full-email-content promise / "Undo windows") is
 * DESKTOP-ONLY from the B3 fix onward. Below 600px the topbar's fixed
 * chrome — hamburger, theme toggle, Sync now, account pill — leaves it
 * under ~40px, and it clipped `overflow: hidden` MID-WORD, painting a
 * slice of "UNDO WINDOWS" as garbage ("o wir") on every authed screen.
 * Both claims are buttons routing to Activity and Settings, and both
 * routes stay one tap away in the drawer nav, so dropping the strip
 * costs no destination.
 *
 * Asserted in BOTH directions on purpose: named on desktop, genuinely
 * absent on mobile. A one-sided assertion would pass just as happily if
 * the strip vanished from every viewport, which is the regression this
 * gate exists to catch.
 */
async function expectCriticalControlsHaveNames(page: Page, isMobile: boolean): Promise<void> {
  const trustClaim = page.getByRole('button', { name: 'Undo windows' });
  if (isMobile) {
    await expect(trustClaim, 'trust strip must not render at phone widths').toHaveCount(0);
  } else {
    await expect(trustClaim).toHaveAccessibleName('Undo windows');
  }

  // The hamburger is the mirror image of the trust strip: present ONLY at
  // phone widths. It needs the same both-directions assertion for the same
  // reason, and it has the receipts — an inline `display: inline-flex`
  // outranked `.dm-topbar-hamburger { display: none }` for 35 days, so the
  // button rendered on desktop and opened a duplicate sidebar in an
  // aria-modal dialog over the real one. The jsdom unit test could not see
  // it (tokens.css never loads there); only a real browser at a real
  // viewport can, which is why the pin belongs here.
  const drawerOpener = page.getByRole('button', { name: 'Open navigation menu' });
  if (isMobile) {
    await expect(drawerOpener).toHaveAccessibleName('Open navigation menu');
  } else {
    await expect(
      drawerOpener,
      'hamburger must not render above the 900px breakpoint — the desktop sidebar is already visible',
    ).toHaveCount(0);
  }
  await expect(
    page.getByRole('button', { name: 'chintan.e2e.billing@synthetic.test', exact: true }),
  ).toHaveAccessibleName('chintan.e2e.billing@synthetic.test');
}

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === MOBILE_PROJECT) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      'mobile accessibility project must emulate reduced motion',
    ).toBe(true);
  }
});

for (const route of ROUTES) {
  test(`${route.path} passes the authenticated accessibility smoke`, async ({ page }, testInfo) => {
    await page.goto(route.path);
    await expect(page.getByRole('main')).toBeVisible();
    const ready =
      route.readyRole === 'region'
        ? page.getByRole('region', { name: route.readyName })
        : page.getByRole('heading', {
            name: route.readyName,
            ...(typeof route.readyName === 'string' ? { exact: true } : {}),
          });
    await expect(ready).toBeVisible({ timeout: 60_000 });

    await expectCriticalControlsHaveNames(page, testInfo.project.name === MOBILE_PROJECT);
    await expectNoViewportOverflow(page);
    await expectNoBlockingAxeViolations(page);
  });
}

test('keyboard shortcut dialog traps and restores focus', async ({ page }) => {
  await page.goto('/senders');
  await expect(page.getByRole('heading', { name: 'Your senders' })).toBeVisible({
    timeout: 60_000,
  });

  const trigger = page.getByRole('button', { name: 'Table', exact: true });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('?');

  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close shortcuts' });
  await expect(close).toBeFocused();

  // This dialog has one interactive element. Both directions must cycle
  // inside it instead of moving focus into the obscured application.
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
