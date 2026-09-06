import { expect, test, type Page } from '@playwright/test';

// Exercise connected acquisition paths without a Gmail account or provider writes.
async function follow(page: Page, path: string) {
  await page.locator(`a[href="${path}"]:visible`).first().click();
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function consent(page: Page) {
  await page.getByRole('button', { name: 'Essential only', exact: true }).click();
}

async function assertSignupRef(page: Page, ref: string) {
  // Observe the real click destination, stopping before OAuth or any account creation.
  await page.route('**/api/auth/google/start**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>OAuth boundary</h1>' }),
  );
  const request = page.waitForRequest(
    (r) => new URL(r.url()).pathname === '/api/auth/google/start',
  );
  await page.locator('a[href*="/api/auth/google/start"]:visible').last().click();
  const url = new URL((await request).url());
  expect(url.searchParams.get('ref')).toBe(ref);
}

test('guide visitor evaluates privacy and pricing, tries cleanup and undo, then signs up', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/how-to/clean-gmail-by-sender?ref=reddit');
  await consent(page);
  await follow(page, '/methodology');
  await follow(page, '/pricing');
  const monthly = page.getByRole('button', { name: 'Monthly', exact: true });
  await monthly.click();
  await expect(monthly).toHaveAttribute('aria-pressed', 'true');
  const annual = page.getByRole('button', { name: 'Annual — 2 months free', exact: true });
  await annual.click();
  await expect(annual).toHaveAttribute('aria-pressed', 'true');
  await follow(page, '/inbox-simulator');
  await page.getByRole('button', { name: /^Archive all \d+ senders/ }).click();
  const preview = page.getByRole('dialog');
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: /^Archive all/ }).click();
  await expect(preview).toHaveCount(0);
  const undoButtons = page.getByRole('button', { name: 'Undo demo action', exact: true });
  const undo = undoButtons.first();
  await expect(undo).toBeVisible();
  const undoableBefore = await undoButtons.count();
  await undo.click();
  await expect(undoButtons).toHaveCount(undoableBefore - 1);
  expect(errors).toEqual([]);
  await assertSignupRef(page, 'reddit');
});

test('comparison visitor checks sources and refund terms before permission-aware signup', async ({
  page,
}) => {
  await page.goto('/vs/unroll-me?ref=hn');
  await consent(page);
  await page.locator('a[href="#sources"]').click();
  await expect(page.locator('#sources')).toBeInViewport();
  await follow(page, '/refunds');
  await follow(page, '/pricing');
  await follow(page, '/sign-in');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('main')).toContainText('Gmail');
  await assertSignupRef(page, 'hn');
});
