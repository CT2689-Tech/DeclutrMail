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
  const step = page.getByRole('button', { name: /Unsubscribe \+ archive/ });
  if ((await step.count()) === 0) return;
  await step.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Unsubscribe');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
