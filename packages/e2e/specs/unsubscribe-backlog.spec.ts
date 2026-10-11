import { expect, test } from '@playwright/test';
import type postgres from 'postgres';

import { expectScreenMounted } from '../helpers/screen-ready';
import { ApiClient, requireLiveStack } from '../helpers/api';
import { dbConnect } from '../helpers/db';
import { applyJourneySeed } from '../helpers/seed-journeys';
import { BILLING_SEED } from '../helpers/seed-billing';

/**
 * Signed-in Unsubscribe + backlog through the real screens.
 * The synthetic fixture has no Gmail token and this lane has no worker,
 * so the spec asserts the preview, the request, and the toast, then
 * deletes the rows it enqueued.
 */

const MAILTO_SENDER = {
  id: 'e2eb1111-0000-4000-8000-00000000000c',
  key: 'c3ee'.repeat(16),
  name: 'Letter Only Weekly',
} as const;
const NO_LINK_SENDER = {
  id: 'e2eb1111-0000-4000-8000-00000000000d',
  key: 'd4ee'.repeat(16),
  name: 'No Link Digest',
} as const;

const api = new ApiClient();
let sql: postgres.Sql;
let mailboxId: string;
let testStart = new Date();

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  expect(live.mailboxId).not.toBeNull();
  mailboxId = live.mailboxId!;
  sql = dbConnect();
  await applyJourneySeed(sql);
  testStart = new Date();
  await sql`
    INSERT INTO senders (id, mailbox_account_id, sender_key, display_name, email, domain,
                         gmail_category, total_received, first_seen_at, last_seen_at,
                         unsubscribe_method, unsubscribe_url)
    VALUES
      (${MAILTO_SENDER.id}, ${mailboxId}, ${MAILTO_SENDER.key}, ${MAILTO_SENDER.name},
       'news@letter.example', 'letter.example', 'updates', 3,
       now() - interval '10 days', now(), 'mailto', 'mailto:news@letter.example'),
      (${NO_LINK_SENDER.id}, ${mailboxId}, ${NO_LINK_SENDER.key}, ${NO_LINK_SENDER.name},
       'hello@nolink.example', 'nolink.example', 'updates', 2,
       now() - interval '10 days', now(), 'none', NULL)
    ON CONFLICT (mailbox_account_id, sender_key) DO UPDATE SET
      unsubscribe_method = EXCLUDED.unsubscribe_method,
      unsubscribe_url = EXCLUDED.unsubscribe_url,
      display_name = EXCLUDED.display_name
  `;
  await sql`
    INSERT INTO mail_messages (mailbox_account_id, provider_message_id, provider_thread_id,
                               sender_key, internal_date, is_unread, label_ids)
    VALUES
      (${mailboxId}, 'e2e-mailto-m1', 'e2e-mailto-t1', ${MAILTO_SENDER.key},
       now() - interval '1 day', true, ARRAY['INBOX']),
      (${mailboxId}, 'e2e-nolink-m1', 'e2e-nolink-t1', ${NO_LINK_SENDER.key},
       now() - interval '1 day', true, ARRAY['INBOX'])
    ON CONFLICT (mailbox_account_id, provider_message_id) DO NOTHING
  `;
  // The shared billing sender has no unsubscribe channel. This journey
  // needs one so Archive and Delete can confirm. Restored in afterAll.
  await sql`
    UPDATE senders
    SET unsubscribe_method = 'one_click',
        unsubscribe_url = 'https://freshfinds.example/unsub'
    WHERE id = ${BILLING_SEED.archiveSenderId}
  `;
});

test.afterAll(async () => {
  if (sql) {
    const since = testStart.toISOString();
    await sql`
      DELETE FROM action_jobs
      WHERE mailbox_account_id = ${mailboxId}
        AND created_at >= ${since}
    `;
    await sql`
      DELETE FROM activity_log
      WHERE mailbox_account_id = ${mailboxId}
        AND occurred_at >= ${since}
        AND action IN ('unsubscribe', 'archive', 'delete')
    `;
    await sql`
      DELETE FROM undo_journal
      WHERE mailbox_account_id = ${mailboxId}
        AND created_at >= ${since}
    `;
    await sql`
      DELETE FROM sender_policies
      WHERE mailbox_account_id = ${mailboxId}
        AND sender_key IN (${BILLING_SEED.archiveSenderKey}, ${MAILTO_SENDER.key}, ${NO_LINK_SENDER.key})
        AND created_at >= ${since}
    `;
    await sql`
      DELETE FROM mail_messages
      WHERE mailbox_account_id = ${mailboxId}
        AND provider_message_id IN ('e2e-mailto-m1', 'e2e-nolink-m1')
    `;
    await sql`
      UPDATE senders
      SET unsubscribe_method = NULL, unsubscribe_url = NULL
      WHERE id = ${BILLING_SEED.archiveSenderId}
    `;
    await sql`
      DELETE FROM senders
      WHERE mailbox_account_id = ${mailboxId}
        AND id IN (${MAILTO_SENDER.id}, ${NO_LINK_SENDER.id})
    `;
    await sql`UPDATE workspaces SET tier = 'pro' WHERE id = ${BILLING_SEED.workspaceId}`;
    await sql.end();
  }
  await api.dispose();
});

test('Triage and Senders confirm unsubscribe with archive and delete', async ({ page }) => {
  test.setTimeout(180_000);
  const senderName = BILLING_SEED.archiveSenderName;
  const me = await api.get<{ meterV2?: boolean; cleanupRemaining?: number | null }>('/api/auth/me');

  await page.goto('/triage');
  await expectScreenMounted(page);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  const escaped = senderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowHeader = page.getByRole('button', {
    name: new RegExp(`^${escaped} — (expand|collapse) triage detail$`),
  });
  await expect(rowHeader).toBeVisible();
  await rowHeader.click();
  await page
    .getByRole('toolbar', { name: `Decide on ${senderName}` })
    .getByRole('button', { name: 'Unsubscribe (U)' })
    .click();

  const triageSheet = page.getByRole('dialog');
  await expect(triageSheet).toBeVisible();
  await expect(triageSheet).toContainText('Whether their email stops is up to the sender.');
  await expect(triageSheet).toContainText(/Future emails:/);
  if (me.meterV2 === true) {
    await expect(triageSheet).toContainText('Unsubscribing is free and doesn’t count.');
  } else if (typeof me.cleanupRemaining === 'number') {
    await expect(triageSheet).toContainText(
      `Uses 1 of your ${me.cleanupRemaining} cleanup actions`,
    );
    await expect(triageSheet).not.toContainText('Uses 2 ');
  } else {
    await expect(triageSheet).not.toContainText('Unsubscribing is free and doesn’t count.');
    await expect(triageSheet).not.toContainText('cleanup action');
  }
  await expect(triageSheet.getByRole('button', { name: 'Unsubscribe + Archive' })).toBeEnabled();
  const triagePost = page.waitForResponse(
    (response) =>
      response.url().includes('/api/actions/unsubscribe-backlog') &&
      response.request().method() === 'POST',
  );
  await triageSheet.getByRole('button', { name: 'Unsubscribe + Archive' }).click();
  const triageResponse = await triagePost;
  expect(triageResponse.ok()).toBe(true);
  const triageBody = (await triageResponse.json()) as {
    data?: { mode?: string; backlog?: { verb?: string } | null };
  };
  expect(triageBody.data?.mode).toBe('archive');
  await expect(page.getByText(/Unsubscribe requested · Archived \d+ emails?/)).toBeVisible();

  // The default lane has no Gmail worker, so the archive job stays queued
  // and no undo token is issued. Stamp the journal the worker would write,
  // then click Activity's Undo. The reverse job is queued; inbox labels stay.
  const [job] = await sql<{ id: string }[]>`
    SELECT id FROM action_jobs
    WHERE mailbox_account_id = ${mailboxId}
      AND verb = 'archive'
      AND direction = 'forward'
      AND created_at >= ${testStart.toISOString()}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  expect(job?.id).toBeTruthy();
  const payload = JSON.stringify({
    kind: 'archive',
    messageIds: ['e2e-bill-m1', 'e2e-bill-m2'],
    priorLabels: ['INBOX'],
  });
  const [issued] = await sql<{ token: string }[]>`
    INSERT INTO undo_journal (mailbox_account_id, action_kind, payload, expires_at)
    VALUES (${mailboxId}, 'archive', ${payload}::jsonb, now() + interval '30 days')
    RETURNING token
  `;
  const token = issued!.token;
  await sql`
    UPDATE action_jobs SET undo_token = ${token}, status = 'done' WHERE id = ${job!.id}
  `;
  await sql`
    INSERT INTO activity_log (
      mailbox_account_id, sender_key, source, action, affected_count, undo_token, action_job_id
    )
    VALUES (
      ${mailboxId}, ${BILLING_SEED.archiveSenderKey}, 'triage', 'archive', 2, ${token}, ${job!.id}
    )
  `;
  await page.goto('/activity');
  await expectScreenMounted(page);
  const undoPost = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/undo/${token}`) && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const undoResponse = await undoPost;
  expect(undoResponse.ok()).toBe(true);
  const [reverse] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM action_jobs
    WHERE mailbox_account_id = ${mailboxId}
      AND direction = 'reverse'
      AND undo_token = ${token}
  `;
  expect(reverse!.n).toBeGreaterThan(0);
  const [stillInbox] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM mail_messages
    WHERE mailbox_account_id = ${mailboxId}
      AND provider_message_id IN ('e2e-bill-m1', 'e2e-bill-m2')
      AND 'INBOX' = ANY(label_ids)
  `;
  expect(stillInbox!.n).toBe(2);

  await page.goto('/senders');
  await expectScreenMounted(page);
  const card = page.getByTestId(`sender-row-${BILLING_SEED.archiveSenderId}`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'More actions' }).click();
  await card.getByRole('menuitem', { name: 'Unsubscribe', exact: true }).click();
  const sendersSheet = page.getByRole('dialog');
  await expect(sendersSheet).toBeVisible();
  await expect(sendersSheet).toContainText('Whether their email stops is up to the sender.');
  await sendersSheet.getByRole('radio', { name: /Unsubscribe and delete/ }).click();
  await expect(sendersSheet).toContainText(
    'Gmail keeps Trash for up to 30 days unless you empty it.',
  );
  await expect(sendersSheet).toContainText('Unsubscribing is free and doesn’t count.');
  const sendersPost = page.waitForResponse(
    (response) =>
      response.url().includes('/api/actions/unsubscribe-backlog') &&
      response.request().method() === 'POST',
  );
  await sendersSheet.getByRole('button', { name: 'Unsubscribe + Delete' }).click();
  const sendersResponse = await sendersPost;
  expect(sendersResponse.ok()).toBe(true);
  const sendersBody = (await sendersResponse.json()) as { data?: { mode?: string } };
  expect(sendersBody.data?.mode).toBe('delete');
  await expect(page.getByText(/Unsubscribe requested · Deleted \d+ emails?/)).toBeVisible();
});

test('an email-only sender opens the mailto handoff and does not claim a draft', async ({
  page,
}) => {
  await page.goto('/senders');
  await expectScreenMounted(page);
  const card = page.getByTestId(`sender-row-${MAILTO_SENDER.id}`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'More actions' }).click();
  await card.getByRole('menuitem', { name: 'Unsubscribe', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('prefilled email');
  await expect(sheet).not.toContainText(/Gmail draft/i);
  await sheet.getByRole('radio', { name: 'Unsubscribe only' }).click();
  const post = page.waitForResponse(
    (response) =>
      response.url().includes('/api/actions/unsubscribe-backlog') &&
      response.request().method() === 'POST',
  );
  await sheet.getByRole('button', { name: 'Unsubscribe', exact: true }).click();
  const response = await post;
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    data?: { mode?: string; senders?: Array<{ unsubStatus?: string; method?: string | null }> };
  };
  expect(body.data?.mode).toBe('unsub_only');
  expect(body.data?.senders?.[0]?.method).toBe('mailto');
  expect(body.data?.senders?.[0]?.unsubStatus).toBe('manual');
  await expect(
    page.getByText('The email is ready in Gmail. Press Send there to finish.'),
  ).toBeVisible();
});

test('a sender with no unsubscribe link reports the failure', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/actions/unsubscribe-backlog')) {
      posts.push(request.url());
    }
  });
  await page.goto('/senders');
  await expectScreenMounted(page);
  const card = page.getByTestId(`sender-row-${NO_LINK_SENDER.id}`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'More actions' }).click();
  const item = card.getByRole('menuitem', { name: /Unsubscribe/ });
  await expect(item).toBeVisible();
  await expect(item).toContainText('No unsubscribe channel found');
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(posts).toEqual([]);
});

test('a spent monthly allowance refuses the mail move before any unsubscribe', async ({ page }) => {
  await sql`UPDATE workspaces SET tier = 'free' WHERE id = ${BILLING_SEED.workspaceId}`;
  try {
    const [before] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM action_jobs
      WHERE mailbox_account_id = ${mailboxId}
        AND created_at >= ${testStart.toISOString()}
        AND idempotency_key NOT LIKE ${BILLING_SEED.quotaKeyPrefix + '%'}
    `;
    await page.goto('/senders');
    await expectScreenMounted(page);
    const card = page.getByTestId(`sender-row-${BILLING_SEED.archiveSenderId}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole('button', { name: 'More actions' }).click();
    await card.getByRole('menuitem', { name: 'Unsubscribe', exact: true }).click();
    const sheet = page.getByRole('dialog');
    const post = page.waitForResponse(
      (response) =>
        response.url().includes('/api/actions/unsubscribe-backlog') &&
        response.request().method() === 'POST',
    );
    await sheet.getByRole('button', { name: 'Unsubscribe + Archive' }).click();
    const response = await post;
    expect(response.status()).toBe(402);
    await expect(page.getByTestId('upgrade-modal')).toBeVisible();
    await expect(page.getByText(/Unsubscribe requested/)).toHaveCount(0);
    const [after] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM action_jobs
      WHERE mailbox_account_id = ${mailboxId}
        AND created_at >= ${testStart.toISOString()}
        AND idempotency_key NOT LIKE ${BILLING_SEED.quotaKeyPrefix + '%'}
    `;
    expect(after!.n).toBe(before!.n);
  } finally {
    await sql`UPDATE workspaces SET tier = 'pro' WHERE id = ${BILLING_SEED.workspaceId}`;
  }
});
