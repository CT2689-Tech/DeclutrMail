import { expect, test } from '@playwright/test';

import { BILLING_SEED } from '../helpers/seed-billing';
import { dbConnect } from '../helpers/db';
import { E2E_ENV } from '../helpers/env';
import { applyJourneySeed } from '../helpers/seed-journeys';

test.use({ storageState: { cookies: [], origins: [] } });

test('return visit opens Home and does not confirm a next step', async ({ page }) => {
  const sql = dbConnect();
  try {
    await applyJourneySeed(sql);
  } finally {
    await sql.end();
  }
  await page.goto(
    `${E2E_ENV.apiUrl}/api/auth/dev/login?${new URLSearchParams({ email: BILLING_SEED.email })}`,
  );
  await expect(page).toHaveURL(`${E2E_ENV.webUrl}/home`);
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  await page.goto(`${E2E_ENV.webUrl}/home-preview?state=full`);
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  const step = page.getByRole('button', { name: /Unsubscribe \+ archive/ });
  const ready = page.locator('[data-home-fix-expected="true"]');
  if ((await ready.count()) === 1) {
    await expect(step).toHaveCount(1);
    await step.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    return;
  }
  await expect(page.locator('[data-home-fix-expected="false"]')).toHaveCount(1);
  await expect(step).toHaveCount(0);
});
