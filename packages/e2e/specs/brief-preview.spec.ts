import { expect, test } from '@playwright/test';

import { ApiClient, requireLiveStack } from '../helpers/api';
import { dbConnect } from '../helpers/db';
import { applyJourneySeed } from '../helpers/seed-journeys';
import { BILLING_SEED } from '../helpers/seed-billing';

const api = new ApiClient();
test.beforeAll(async () => {
  await requireLiveStack(api);
  const sql = dbConnect();
  try {
    await applyJourneySeed(sql);
  } finally {
    await sql.end();
  }
});
test.afterAll(async () => {
  await api.dispose();
});

test('Brief separates yesterday from current-inbox preview and cancel never enqueues', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/actions/'))
      writes.push(request.url());
  });
  await page.goto('/brief');
  const banner = page.getByTestId('cookie-consent-banner');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Essential only', exact: true }).click();
  await expect(
    page.getByRole('checkbox', {
      name: `Include ${BILLING_SEED.archiveSenderName} in the archive`,
    }),
  ).toBeChecked();
  await expect(page.getByText('1 message yesterday', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive 1 sender', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(BILLING_SEED.archiveSenderName);
  await expect(dialog.getByRole('button', { name: 'Archive 2', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(writes).toEqual([]);
  const preview = await api.get<{ counts: { all: number } }>(
    `/api/actions/preview?senderId=${BILLING_SEED.archiveSenderId}`,
  );
  expect(preview.counts.all).toBe(2);
});
