import { expect, test, type Page } from '@playwright/test';
import type postgres from 'postgres';

import { BILLING_SEED } from '../helpers/seed-billing';
import { applyJourneySeed } from '../helpers/seed-journeys';
import { dbConnect } from '../helpers/db';
import { expectScreenMounted } from '../helpers/screen-ready';

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 900 } });
let sql: postgres.Sql;

test.beforeAll(async () => {
  sql = dbConnect();
  await applyJourneySeed(sql);
  await sql`UPDATE senders SET unsubscribe_method = 'one_click', unsubscribe_url = 'https://newsletter.synthetic.test/unsubscribe' WHERE id IN (${BILLING_SEED.archiveSenderId}, ${BILLING_SEED.screenerSenderId})`;
  await sql`DELETE FROM sender_policies WHERE mailbox_account_id = ${BILLING_SEED.mailboxId} AND sender_key = ${BILLING_SEED.screenerSenderKey}`;
  await sql`INSERT INTO mail_messages (mailbox_account_id, provider_message_id, provider_thread_id, sender_key, internal_date, is_unread, label_ids)
    VALUES (${BILLING_SEED.mailboxId}, 'e2e-manual-preview-archived', 'e2e-manual-preview-thread', ${BILLING_SEED.archiveSenderKey}, now(), false, ARRAY['Label_synthetic'])
    ON CONFLICT (mailbox_account_id, provider_message_id) DO NOTHING`;
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM mail_messages WHERE mailbox_account_id = ${BILLING_SEED.mailboxId} AND provider_message_id = 'e2e-manual-preview-archived'`;
    await sql`UPDATE senders SET unsubscribe_method = NULL, unsubscribe_url = NULL WHERE id IN (${BILLING_SEED.archiveSenderId}, ${BILLING_SEED.screenerSenderId})`;
    await sql`INSERT INTO sender_policies (mailbox_account_id, sender_key, is_protected, protection_reason, protection_set_at)
      VALUES (${BILLING_SEED.mailboxId}, ${BILLING_SEED.screenerSenderKey}, true, 'starred', now())
      ON CONFLICT (mailbox_account_id, sender_key) DO UPDATE SET is_protected = true, protection_reason = 'starred', protection_set_at = now()`;
  } finally {
    await sql.end();
  }
});

async function inspectAndCancel(page: Page, unsubscribe: boolean, inbox: number, allMail: number) {
  const dialog = page.getByRole('dialog').or(page.getByRole('alertdialog'));
  if (unsubscribe) await dialog.getByRole('radio', { name: '+ Delete', exact: true }).click();
  const age = dialog.getByRole('combobox', { name: 'Email age' });
  const archived = dialog.getByRole('checkbox', { name: 'Include archived email' });
  const impact = dialog.getByRole('region', { name: 'What Delete will do' });
  await expect(age).toHaveValue('all');
  await expect(archived).not.toBeChecked();
  await expect(impact).toContainText(`${inbox} emails will move to Gmail Trash.`);
  await expect(impact).toContainText('Inbox only · Any age');
  await archived.check();
  await expect(impact).toContainText(`${allMail} emails will move to Gmail Trash.`);
  await expect(impact).toContainText('Inbox and archived email · Any age');
  await age.selectOption('180');
  await expect(archived).toBeChecked();
  await expect(
    dialog.getByRole('button', {
      name: unsubscribe ? 'Unsubscribe + Delete' : 'Delete',
      exact: true,
    }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('bulk and sender detail page/pane keep manual Delete defaults and scope without moving mail', async ({
  page,
}) => {
  const { E2E_ENV } = await import('../helpers/env');
  const writes: string[] = [];
  const mutationPaths = new Set([
    '/api/actions',
    '/api/actions/unsubscribe-backlog',
    '/api/actions/keep-intent',
    '/api/screener/decide',
  ]);
  page.on('request', (request) => {
    if (request.method() === 'POST' && mutationPaths.has(new URL(request.url()).pathname))
      writes.push(request.url());
  });
  await page.goto(
    `${E2E_ENV.apiUrl}/api/auth/dev/login?${new URLSearchParams({ email: BILLING_SEED.email })}`,
  );
  await page.goto('/senders');
  await expectScreenMounted(page);
  const consent = page.getByTestId('cookie-consent-banner');
  await expect(consent).toBeVisible();
  await consent.getByRole('button', { name: 'Essential only', exact: true }).click();
  await expect(consent).toHaveCount(0);
  await page
    .getByRole('checkbox', { name: `Select ${BILLING_SEED.archiveSenderName}`, exact: true })
    .check();
  await page
    .getByRole('checkbox', { name: `Select ${BILLING_SEED.screenerSenderName}`, exact: true })
    .check();
  for (const unsubscribe of [false, false, true]) {
    await page
      .getByRole('button', {
        name: `${unsubscribe ? 'Unsubscribe' : 'Delete'} 2 senders`,
        exact: true,
      })
      .click();
    await inspectAndCancel(page, unsubscribe, 3, 4);
  }
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('link', { name: BILLING_SEED.archiveSenderName, exact: true }).click();
  await expect(page).toHaveURL(/\/senders\?sender=/);
  const paneToolbar = page.getByRole('toolbar', { name: 'Sender actions', exact: true });
  for (const unsubscribe of [false, true]) {
    await paneToolbar
      .getByRole('button', { name: unsubscribe ? 'Unsubscribe' : 'Delete', exact: true })
      .click();
    await inspectAndCancel(page, unsubscribe, 2, 3);
  }
  await page.getByRole('link', { name: 'Open full page', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/senders/${BILLING_SEED.archiveSenderId}`));
  for (const unsubscribe of [false, true]) {
    await page
      .getByRole('button', { name: unsubscribe ? 'Unsubscribe (U)' : 'Delete (D)', exact: true })
      .click();
    await inspectAndCancel(page, unsubscribe, 2, 3);
  }
  expect(writes).toEqual([]);
  const [labels] =
    await sql`SELECT count(*) FILTER (WHERE 'INBOX' = ANY(label_ids))::int AS inbox, count(*) FILTER (WHERE 'TRASH' = ANY(label_ids))::int AS trash
    FROM mail_messages WHERE mailbox_account_id = ${BILLING_SEED.mailboxId} AND sender_key IN (${BILLING_SEED.archiveSenderKey}, ${BILLING_SEED.screenerSenderKey})`;
  expect(labels).toMatchObject({ inbox: 3, trash: 0 });
});
