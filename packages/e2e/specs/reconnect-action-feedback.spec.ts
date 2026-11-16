import { expect, test } from '@playwright/test';
import type postgres from 'postgres';

import { BILLING_SEED } from '../helpers/seed-billing';
import { applyJourneySeed } from '../helpers/seed-journeys';
import { dbConnect } from '../helpers/db';
import { E2E_ENV } from '../helpers/env';
import { expectScreenMounted } from '../helpers/screen-ready';

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 900 } });

let sql: postgres.Sql;
let previousState:
  | {
      last_incremental_error_at: Date | null;
      last_incremental_error_code: string | null;
    }
  | undefined;

test.beforeAll(async () => {
  sql = dbConnect();
  await applyJourneySeed(sql);
  const [state] = await sql<
    { last_incremental_error_at: Date | null; last_incremental_error_code: string | null }[]
  >`SELECT last_incremental_error_at, last_incremental_error_code
      FROM provider_sync_state WHERE mailbox_account_id = ${BILLING_SEED.mailboxId}`;
  expect(state).toBeDefined();
  previousState = state;
  await sql`UPDATE provider_sync_state
      SET last_incremental_error_at = now() + interval '1 minute',
          last_incremental_error_code = 'InvalidGrantError'
      WHERE mailbox_account_id = ${BILLING_SEED.mailboxId}`;
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    if (previousState) {
      await sql`UPDATE provider_sync_state
          SET last_incremental_error_at = ${previousState.last_incremental_error_at},
              last_incremental_error_code = ${previousState.last_incremental_error_code}
          WHERE mailbox_account_id = ${BILLING_SEED.mailboxId}`;
    }
  } finally {
    await sql.end();
  }
});

test('lost Gmail access explains the blocked Archive and offers reconnect', async ({ page }) => {
  const actionRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/actions') {
      actionRequests.push(request.url());
    }
  });

  await page.goto(`${E2E_ENV.apiUrl}/api/auth/dev/login?email=${BILLING_SEED.email}`);
  await page.goto('/senders');
  await expectScreenMounted(page);
  await expect(page.getByTestId('sync-error-banner')).toContainText('Reconnect Gmail');

  const consent = page.getByTestId('cookie-consent-banner');
  if (await consent.isVisible()) {
    await consent.getByRole('button', { name: 'Essential only', exact: true }).click();
  }
  await page
    .getByRole('checkbox', { name: `Select ${BILLING_SEED.archiveSenderName}`, exact: true })
    .check();
  await page.getByRole('button', { name: 'Archive 1 sender', exact: true }).click();

  const dialog = page.getByRole('dialog').or(page.getByRole('alertdialog'));
  await expect(dialog).toContainText('Reconnect before changing email.');
  await expect(dialog.getByRole('button', { name: 'Reconnect Gmail' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Archive', exact: true })).toBeDisabled();
  expect(actionRequests).toEqual([]);
});
