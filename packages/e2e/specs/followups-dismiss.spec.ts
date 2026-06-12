import { expect, test } from '@playwright/test';
import type postgres from 'postgres';

import { ApiClient, requireLiveStack } from '../helpers/api';
import { dbConnect } from '../helpers/db';

/**
 * Followups dismiss spec — D88 "Mark resolved".
 *
 * The FollowupCheckWorker isn't registered yet (integration-owned), so
 * the spec seeds its own `followup_tracker` row via SQL — the same way
 * the feature was smoked — then drives the REAL UI:
 *
 *   1. /followups renders the seeded row in its D85 age bucket.
 *   2. The per-row trash button ("Mark resolved — <name>") removes the
 *      row optimistically; the screen refetches server truth.
 *   3. Durability is asserted in the DB: `status='dismissed'` +
 *      `dismissed_at` set, plus the D88 `followup-dismiss` activity row.
 *   4. Reload — the row must NOT come back (dismissed rows are excluded
 *      from the awaiting list per D86).
 *
 * Teardown deletes the seeded tracker row and the activity rows the
 * dismissal appended (shared dev DB — leave no trace).
 */

const RECIPIENT_NAME = 'E2E Dismiss Target';
const THREAD_ID = `e2e-followups-dismiss-${Date.now()}`;

const api = new ApiClient();
let sql: postgres.Sql;
let mailboxId: string;
let seeded = false;
let testStart: Date;

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  test.skip(live.mailboxId === null, 'reason' in live ? live.reason : undefined);
  mailboxId = live.mailboxId!;
  sql = dbConnect();
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

  // ---- Dismiss via the D88 trash affordance.
  await page.getByRole('button', { name: `Mark resolved — ${RECIPIENT_NAME}` }).click();
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
  await expect(
    page.getByText(/threads? awaiting reply|No follow-ups waiting\./).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(RECIPIENT_NAME)).toBeHidden();
});
