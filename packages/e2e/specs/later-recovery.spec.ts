import { expect, test } from '@playwright/test';
import { expectScreenMounted } from '../helpers/screen-ready';
import type postgres from 'postgres';
import { ApiClient, requireLiveStack } from '../helpers/api';
import { dbConnect } from '../helpers/db';
import { BILLING_SEED } from '../helpers/seed-billing';
import { applyJourneySeed } from '../helpers/seed-journeys';

const api = new ApiClient();
let sql: postgres.Sql;
let mailboxId: string;

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  mailboxId = live.mailboxId!;
  expect(mailboxId).toBe(BILLING_SEED.mailboxId);
  sql = dbConnect();
  await applyJourneySeed(sql);
  await sql`INSERT INTO sender_policies
    (mailbox_account_id, sender_key, snoozed_until, snoozed_at,
     snooze_wake_last_attempt_at, snooze_wake_last_failed_at,
     snooze_wake_failure_count, snooze_wake_failure_kind)
    VALUES (${mailboxId}, ${BILLING_SEED.archiveSenderKey}, now() + interval '2 days', now(),
      now() - interval '5 minutes', now() - interval '5 minutes', 1, 'temporary')`;
});

test.afterAll(async () => {
  if (sql) {
    await sql`DELETE FROM sender_policies
      WHERE mailbox_account_id = ${mailboxId} AND sender_key = ${BILLING_SEED.archiveSenderKey}`;
    await sql.end();
  }
  await api.dispose();
});

/** Real API + rendered browser; worker failure is a synthetic durable fixture, not Gmail evidence. */
test('Later failed return restores recovery controls after queue acceptance and survives reload', async ({
  page,
}) => {
  await page.goto('/later');
  await expectScreenMounted(page);
  await page.getByRole('button', { name: 'Essential only', exact: true }).click();
  await expect(page.getByTestId('cookie-consent-banner')).toBeHidden();
  const sender = page.getByText(BILLING_SEED.archiveSenderName, { exact: true });
  const row = page.getByRole('listitem').filter({ has: sender });
  // Streamed SSR can briefly retain a hidden name. Persistent duplicate rows
  // or names must fail rather than selecting one occurrence.
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await expect(sender).toHaveCount(1, { timeout: 30_000 });
  await expect(sender).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Return retrying', { exact: true })).toBeVisible();
  // Cancel first: no queue request may be sent by merely inspecting the confirm.
  let wakeRequests = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith(`/${BILLING_SEED.archiveSenderId}/wake`)
    )
      wakeRequests++;
  });
  await page.getByRole('button', { name: 'Bring back now', exact: true }).click();
  await expect(page.getByText(/return time clears/i)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(wakeRequests).toBe(0);

  await page.getByRole('button', { name: 'Bring back now', exact: true }).click();
  const queued = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/${BILLING_SEED.archiveSenderId}/wake`) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Bring back now', exact: true }).last().click();
  expect((await queued).status()).toBe(201);
  await expect(page.getByText('Bringing back…', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Change return time', exact: true }),
  ).toBeDisabled();

  // No provider is called. Persist the worker's failure shape to exercise the actual polling read.
  await sql`UPDATE sender_policies SET snooze_wake_last_attempt_at = now(),
    snooze_wake_last_failed_at = now(), snooze_wake_failure_count = 2,
    snooze_wake_failure_kind = 'temporary'
    WHERE mailbox_account_id = ${mailboxId} AND sender_key = ${BILLING_SEED.archiveSenderKey}`;
  await expect(page.getByText('Bringing back…', { exact: true })).toBeHidden();
  await expect(page.getByText('Return retrying', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bring back now', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Change return time', exact: true })).toBeEnabled();
  expect(wakeRequests).toBe(1);
  await page.reload();
  await expectScreenMounted(page);
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await expect(sender).toHaveCount(1, { timeout: 30_000 });
  await expect(sender).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Return retrying', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bring back now', exact: true })).toBeEnabled();
});
