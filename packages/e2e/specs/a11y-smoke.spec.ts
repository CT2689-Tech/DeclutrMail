/// <reference lib="dom" />

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
  // placeholder — the synthetic Free workspace now exercises the same
  // "About <feature>" ScreenIntro landmark every other route asserts on.
  { path: '/triage', readyRole: 'region', readyName: 'About How Triage works' },
  { path: '/activity', readyRole: 'region', readyName: 'About Activity' },
  { path: '/settings/privacy', readyRole: 'region', readyName: 'About Privacy & Data' },
  { path: '/billing', readyRole: 'region', readyName: 'About Plan & billing' },
] as const;

async function expectNoBlockingAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  const report = blocking
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n` +
        violation.nodes
          .map((node) => `  ${node.target.join(' ')}: ${node.failureSummary}`)
          .join('\n'),
    )
    .join('\n\n');

  expect(blocking, report || 'no serious or critical axe violations').toEqual([]);
}

const MOBILE_PROJECT = 'a11y-mobile-reduced-motion';

/**
 * The trust strip ("Full bodies fetched: 0" / "Undo windows") is
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
  await expect(
    page.getByRole('button', { name: 'chintan.e2e.billing@synthetic.test', exact: true }),
  ).toHaveAccessibleName('chintan.e2e.billing@synthetic.test');
}

async function expectNoViewportOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(
    overflow.documentWidth,
    `document width ${overflow.documentWidth}px exceeds viewport ${overflow.viewportWidth}px`,
  ).toBeLessThanOrEqual(overflow.viewportWidth + 1);
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
        : page.getByRole('heading', { name: route.readyName, exact: true });
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
