import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectScreenMounted } from '../helpers/screen-ready';
import type postgres from 'postgres';

import { ApiClient, requireLiveStack } from '../helpers/api';
import { dbConnect } from '../helpers/db';
import { applyJourneySeed } from '../helpers/seed-journeys';

/** Owned synthetic review records only: no worker, Gmail or approval intents. */
const api = new ApiClient();
const ruleId = randomUUID();
const senderKeys = Array.from({ length: 61 }, (_, i) =>
  createHash('sha256').update(`autopilot-pages-${ruleId}-${i}`).digest('hex'),
);
let sql: postgres.Sql;
let mailboxId: string;

interface PendingPage {
  data: { id: string; matchedAt: string }[];
  meta: { total: number; pagination: { hasMore: boolean; nextCursor: string | null } };
}

async function pending(cursor?: string): Promise<PendingPage> {
  const response = await api.getRaw(
    `/api/autopilot/pending-suggestions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
  expect(response.status).toBe(200);
  return response.body as PendingPage;
}

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  expect(live.mailboxId).not.toBeNull();
  mailboxId = live.mailboxId!;
  sql = dbConnect();
  await applyJourneySeed(sql);
});

test.afterAll(async () => {
  if (sql) {
    // Rule cascade deletes only this test's matches; names/keys are unique.
    await sql`DELETE FROM automation_rules WHERE id = ${ruleId} AND mailbox_account_id = ${mailboxId}`;
    await sql`DELETE FROM senders WHERE mailbox_account_id = ${mailboxId} AND sender_key IN ${sql(senderKeys)}`;
    await sql.end();
  }
  await api.dispose();
});

test('review pages cover the backlog and recover when the older page is exhausted', async ({
  page,
}) => {
  expect((await pending()).meta.total).toBe(0);
  await sql`
    INSERT INTO automation_rules
      (id, mailbox_account_id, preset_key, is_preset, name, enabled, mode, action_kind)
    VALUES (${ruleId}, ${mailboxId}, 'newsletter_graveyard', true, 'E2E backlog review', false, 'observe', 'archive')
  `;
  // Tie all matches at PostgreSQL microsecond precision: pagination must not lose rows.
  const matchedAt = `${new Date(Date.now() - 60_000).toISOString().slice(0, -1)}123Z`;
  for (const [i, senderKey] of senderKeys.entries()) {
    await sql`
      INSERT INTO senders
        (mailbox_account_id, sender_key, display_name, email, domain, gmail_category,
         first_seen_at, last_seen_at, created_at)
      VALUES (${mailboxId}, ${senderKey}, ${`E2E Backlog ${i}`}, ${`backlog-${i}@example.com`},
        'example.com', 'promotions', '2024-01-01T00:00:00Z', ${matchedAt}, '2024-01-01T00:00:00Z')
    `;
    await sql`
      INSERT INTO rule_match_log
        (rule_id, mailbox_account_id, sender_key, matched_at, mode_at_match, confidence, reason)
      VALUES (${ruleId}, ${mailboxId}, ${senderKey}, ${matchedAt}, 'observe', 0.90, 'Synthetic backlog review')
    `;
  }
  const first = await pending();
  expect(first.data).toHaveLength(50);
  expect(first.meta.total).toBe(61);
  expect(first.meta.pagination.hasMore).toBe(true);
  expect(first.meta.pagination.nextCursor).toBeTruthy();
  const token = encodeURIComponent(first.meta.pagination.nextCursor!);
  expect(
    (await api.getRaw(`/api/autopilot/pending-suggestions?cursor=${token}&cursor=${token}`)).status,
  ).toBe(400);
  const older = await pending(first.meta.pagination.nextCursor!);
  expect(older.data).toHaveLength(11);
  expect(older.meta.total).toBe(61);
  expect(older.meta.pagination.hasMore).toBe(false);
  expect(new Set([...first.data, ...older.data].map((row) => row.id)).size).toBe(61);

  await page.goto('/autopilot');
  await expectScreenMounted(page);
  // Dismiss any consent overlay before interacting with the lower review section.
  const essential = page.getByRole('button', { name: 'Essential only', exact: true });
  if (await essential.isVisible()) await essential.click();
  await expect(page.getByText('50 on this page · 61 waiting at last check')).toBeVisible();
  await page.getByRole('button', { name: 'Older suggestions', exact: true }).click();
  await expect(page.getByText('11 on this page · 61 waiting at last check')).toBeVisible();
  await expect(page.getByText(`Matched ${matchedAt.slice(0, 10)} UTC`).first()).toBeVisible();

  // Dismiss each older suggestion through the real UI/API; Gmail is unchanged.
  for (let remaining = 11; remaining > 0; remaining--) {
    await page
      .getByRole('button', { name: /^Skip suggestion for E2E Backlog/ })
      .first()
      .click();
    await expect(
      page.getByText(`${remaining - 1} on this page · ${50 + remaining - 1} waiting at last check`),
    ).toBeVisible();
  }
  await expect(page.getByText('No suggestions on this page', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Newest suggestions', exact: true }).click();
  await expect(page.getByText('50 on this page · 50 waiting at last check')).toBeVisible();
  await page.reload();
  await expectScreenMounted(page);
  await expect(page.getByText('50 on this page · 50 waiting at last check')).toBeVisible();
  const dismissed = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM rule_match_log
    WHERE rule_id = ${ruleId} AND resolution = 'dismissed' AND dismiss_reason = 'user'
  `;
  expect(Number(dismissed[0]?.count)).toBe(11);
});
