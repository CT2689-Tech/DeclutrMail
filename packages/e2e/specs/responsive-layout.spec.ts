/// <reference lib="dom" />

import { expect, test, type Page } from '@playwright/test';

import { expectNoUncontainedViewportEscape, expectNoViewportOverflow } from '../helpers/a11y';
import { BILLING_SEED } from '../helpers/seed-billing';

/**
 * Compact-phone release gate.
 *
 * The accessibility projects exercise representative templates at 375px.
 * This suite adds the smaller 320px layout boundary and, crucially, every
 * authenticated product destination. AppShell clips its content column, so
 * the second assertion detects children that are cut off even when the
 * document itself has no horizontal scrollbar.
 */

const APP_ROUTES = [
  '/senders',
  '/triage',
  '/screener',
  '/autopilot',
  '/quiet',
  '/brief',
  '/followups',
  '/later',
  '/activity',
  '/billing',
  '/settings',
  '/settings/privacy',
  '/settings/help',
  '/settings/senders',
  `/senders/${BILLING_SEED.archiveSenderId}`,
  '/admin/security',
] as const;

// One route per public renderer; the 375px a11y lane owns the deeper WCAG
// scan while this list guards the lower-width layout boundary.
const PUBLIC_ROUTES = [
  '/',
  '/pricing',
  '/inbox-simulator',
  '/compare',
  '/vs/unroll-me',
  '/alternatives/clean-email',
  '/how-to/clean-gmail-by-sender',
  '/privacy',
  '/how-it-works',
  '/faq',
] as const;

async function openSettled(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByTestId('auth-skeleton')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

async function expectResponsiveLayout(page: Page): Promise<void> {
  await expectNoViewportOverflow(page);
  await expectNoUncontainedViewportEscape(page);
  await expect(
    page.locator('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay'),
  ).toHaveCount(0);
}

for (const path of APP_ROUTES) {
  test(`${path} stays inside the compact authenticated viewport`, async ({ page }) => {
    await openSettled(page, path);
    await expectResponsiveLayout(page);
  });
}

for (const path of PUBLIC_ROUTES) {
  test(`${path} stays inside the compact public viewport`, async ({ page }) => {
    await openSettled(page, path);
    await expectResponsiveLayout(page);
  });
}

test('the compact navigation drawer remains fully reachable', async ({ page }) => {
  await openSettled(page, '/senders');
  await page.getByRole('button', { name: 'Open navigation menu' }).click();

  const drawer = page.getByRole('dialog', { name: 'Navigation menu' });
  await expect(drawer).toBeVisible();
  await expectResponsiveLayout(page);

  const bounds = await drawer.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);

  await drawer.getByRole('button', { name: 'Close navigation menu' }).click();
  await expect(drawer).toBeHidden();
});
