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

// `readyRole: 'help'` waits for the top bar's "About this screen" button,
// which exists only once the route's `<ScreenIntro>` has mounted and
// registered its help (it used to be a visible "About …" region).
const ROUTES = [
  { path: '/senders', readyRole: 'help' },
  // A3 (D19) granted Free the real Triage screen, not the TierGate
  // placeholder. The h1 is NOT a valid ready signal — it reads "Triage"
  // in every state, loading included, so the gate would pass on a page
  // permanently stuck on the skeleton. Anchor on the regions that only
  // mount once `composeTriageState` has left 'loading' for a real
  // outcome: the focus card ('ready') or the resting/completion state
  // ('empty'). A genuine load failure ('error') renders neither, so it
  // still times out and fails the gate rather than being waved through.
  {
    path: '/triage',
    readyRole: 'region',
    readyName: /^(Current decision|Nothing to decide)$/,
  },
  { path: '/activity', readyRole: 'heading', readyName: 'Activity' },
  { path: '/settings/privacy', readyRole: 'help' },
  { path: '/billing', readyRole: 'help' },
] as const;

const MOBILE_PROJECT = 'a11y-mobile-reduced-motion';

async function expectCriticalControlsHaveNames(page: Page, isMobile: boolean): Promise<void> {
  // The top bar's trust strip ("Undo windows" / "Stored Gmail data") was
  // removed at every width; both facts live on Settings → Privacy & data
  // and in the action previews.
  await expect(page.getByRole('button', { name: 'Undo windows' })).toHaveCount(0);

  // The mobile tab bar and the desktop sidebar are mirror images: exactly
  // one primary nav is visible per viewport. Asserted both ways, because
  // jsdom never loads tokens.css and cannot see either rule.
  const tabBar = page.getByRole('navigation', { name: 'Primary' });
  const sidebar = page.getByRole('navigation', { name: 'Product navigation' });
  if (isMobile) {
    await expect(tabBar.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
    await expect(sidebar).toHaveCount(0);
  } else {
    await expect(tabBar).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  }

  // The hamburger is present ONLY at phone widths. It needs the same
  // both-directions assertion, and it has the receipts — an inline `display: inline-flex`
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
      route.readyRole === 'help'
        ? page.getByRole('button', { name: 'About this screen' })
        : route.readyRole === 'region'
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
  await expect(page.getByRole('heading', { name: /^Senders\b/, level: 1 })).toBeVisible({
    timeout: 60_000,
  });

  // The shortcut mechanism under test is global and independent of WHICH
  // non-input element holds focus; the header's Filter button renders on
  // every viewport. Never `test.skip()` here: this repo's
  // `assert-e2e-ran.mjs` CI gate fails loudly on any skip.
  const trigger = page.getByRole('button', { name: 'Filter', exact: true });
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
