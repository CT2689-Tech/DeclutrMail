import { expect, test } from '@playwright/test';
import type postgres from 'postgres';

import { applyJourneySeed } from '../helpers/seed-journeys';

import { ApiClient, requireLiveStack } from '../helpers/api';
import { dbConnect } from '../helpers/db';

/** Isolated synthetic API/UI journey. No Gmail credentials or worker. */

const RECIPIENT_NAME = 'E2E Dismiss Target';
const THREAD_ID = `e2e-followups-dismiss-${Date.now()}`;

const api = new ApiClient();
let sql: postgres.Sql;
let mailboxId: string;
let seeded = false;
let testStart: Date;

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  expect(live.mailboxId).not.toBeNull();
  mailboxId = live.mailboxId!;
  sql = dbConnect();
  await applyJourneySeed(sql);
});

test.afterAll(async () => {
  if (sql && seeded) {
    await sql`
      DELETE FROM followup_tracker
      WHERE mailbox_account_id = ${mailboxId} AND provider_thread_id = ${THREAD_ID}
    `;
    await sql`
      DELETE FROM activity_log
      WHERE mailbox_account_id = ${mailboxId}
        AND action = 'followup-dismiss'
        AND occurred_at >= ${testStart.toISOString()}
    `;
  }
  if (sql) await sql.end();
  await api.dispose();
});

test('Mark resolved dismisses the row, audits it, and survives reload', async ({ page }) => {
  testStart = new Date();

  // ---- Seed: one awaiting followup in the 3-7d bucket.
  const workspaceRows = await sql<{ workspace_id: string }[]>`
    SELECT workspace_id FROM mailbox_accounts WHERE id = ${mailboxId}
  `;
  const workspaceId = workspaceRows[0]?.workspace_id;
  expect(workspaceId).toBeTruthy();
  await sql`
    INSERT INTO followup_tracker
      (workspace_id, mailbox_account_id, provider_thread_id, recipient_email,
       recipient_display_name, subject, sent_at, status)
    VALUES
      (${workspaceId!}, ${mailboxId}, ${THREAD_ID}, ${'e2e-dismiss@example.com'},
       ${RECIPIENT_NAME}, ${'E2E dismissal spec thread'}, ${new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()}, 'awaiting')
  `;
  seeded = true;

  // ---- The seeded row renders in the awaiting list.
  await page.goto('/followups');
  await expect(page.getByText(RECIPIENT_NAME)).toBeVisible({ timeout: 30_000 });

  // ---- Dismiss via the D88 affordance. The label says WHERE it is
  // resolved (D88 / D245) — a dismissal here is not an observed reply.
  await page
    .getByRole('button', { name: `Mark resolved in DeclutrMail — ${RECIPIENT_NAME}` })
    .click();
  await expect(page.getByText(RECIPIENT_NAME)).toBeHidden({ timeout: 15_000 });

  // ---- Durable write: tracker row flipped + activity audit row.
  await expect
    .poll(
      async () => {
        const rows = await sql<{ status: string; dismissed_at: Date | null }[]>`
          SELECT status, dismissed_at FROM followup_tracker
          WHERE mailbox_account_id = ${mailboxId} AND provider_thread_id = ${THREAD_ID}
        `;
        return rows[0]?.status === 'dismissed' && rows[0]?.dismissed_at !== null;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  const audit = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM activity_log
    WHERE mailbox_account_id = ${mailboxId}
      AND action = 'followup-dismiss'
      AND occurred_at >= ${testStart.toISOString()}
  `;
  expect(Number(audit[0]?.count)).toBe(1);

  // ---- D86: dismissed rows stay gone after a full reload.
  await page.reload();
  // The screen has settled (header rendered) before asserting absence —
  // a bare toBeHidden would pass against a still-loading page.
  await expect(page.getByRole('heading', { level: 1, name: 'Follow-ups' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(RECIPIENT_NAME)).toBeHidden();
});
