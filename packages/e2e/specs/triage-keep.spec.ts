import { expect, test } from '@playwright/test';
import type postgres from 'postgres';

import { ApiClient, requireLiveStack, type TriageQueueRow } from '../helpers/api';
import { dbConnect, getSenderPolicy, senderKeyById } from '../helpers/db';

/**
 * Golden spec 1 — Triage Keep (D183 / D29 / D40 / D226).
 *
 * Walks the REAL daily ritual on /triage:
 *
 *   1. D226 preview leg: open the Archive action sheet via the `A`
 *      shortcut, assert the mandatory preview renders, cancel — and
 *      assert NOTHING mutated (the row stays queued).
 *   2. Keep leg: `K` fires the keep-intent POST (D40 — policy-only,
 *      no preview by design, no Gmail mutation). The row leaves the
 *      queue ONLY on server confirmation (refetch excludes the
 *      decided sender), then the keep policy projects into
 *      `sender_policies` via the outbox consumer (worker process).
 *
 * Restore: Keep writes an `activity_log` row + (via outbox) a
 * `sender_policies` row. The target sender is chosen to have NO
 * pre-existing policy row, so teardown is a clean delete of both —
 * the sender returns to the triage queue for the next run (idempotent).
 */

const api = new ApiClient();
let sql: postgres.Sql;
let mailboxId: string;
let target: { senderKey: string; senderName: string } | null = null;
let testStart: Date;

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  test.skip(live.mailboxId === null, 'reason' in live ? live.reason : undefined);
  mailboxId = live.mailboxId!;
  sql = dbConnect();
});

test.afterAll(async () => {
  // Restore the shared dev DB: remove the keep decision row (the
  // sender returns to the queue) and the outbox-projected policy row.
  // The projection is worker-async — it may land after the assertion
  // window, so the delete runs unconditionally on the (mailbox,
  // sender_key) pair scoped to rows created during this test.
  if (sql && target) {
    await sql`
      DELETE FROM activity_log
      WHERE mailbox_account_id = ${mailboxId}
        AND sender_key = ${target.senderKey}
        AND action = 'keep'
        AND occurred_at >= ${testStart.toISOString()}
    `;
    await sql`
      DELETE FROM sender_policies
      WHERE mailbox_account_id = ${mailboxId}
        AND sender_key = ${target.senderKey}
        AND created_at >= ${testStart.toISOString()}
    `;
  }
  if (sql) await sql.end();
  await api.dispose();
});

test('Keep via K: preview-on-cancel leaves queue intact; Keep removes the row server-confirmed', async ({
  page,
}) => {
  testStart = new Date();

  // ---- Setup: pick a queue row whose sender has NO sender_policies
  // row (clean-delete restore) and whose name is unique in the queue
  // (unambiguous aria-label selector).
  const rows = await api.get<TriageQueueRow[]>('/api/triage/queue');
  test.skip(rows.length === 0, 'triage queue is empty for the active mailbox');
  for (const row of rows) {
    const nameCount = rows.filter((r) => r.senderName === row.senderName).length;
    if (nameCount !== 1) continue;
    const senderKey = await senderKeyById(sql, mailboxId, row.senderId);
    const policy = await getSenderPolicy(sql, mailboxId, senderKey);
    if (policy === null) {
      target = { senderKey, senderName: row.senderName };
      break;
    }
  }
  test.skip(target === null, 'no policy-free, uniquely-named sender in the triage queue');
  const { senderName, senderKey } = target!;

  // ---- Open /triage and find the target row. The header's
  // accessible name flips expand ↔ collapse with state, so match both.
  await page.goto('/triage');
  const queue = page.getByRole('list', { name: 'Triage queue' });
  await expect(queue).toBeVisible();
  const escaped = senderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowHeader = page.getByRole('button', {
    name: new RegExp(`^${escaped} — (expand|collapse) triage detail$`),
  });
  await expect(rowHeader).toBeVisible();

  // ---- Expand the row — the K/A/U/L toolbar mounts (D29/D227).
  await rowHeader.click();
  const toolbar = page.getByRole('toolbar', { name: `Decide on ${senderName}` });
  await expect(toolbar).toBeVisible();

  // ---- D226 leg: `A` opens the action sheet with the MANDATORY
  // preview; Escape cancels; nothing mutates.
  await page.keyboard.press('a');
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Action sheet · Archive');
  await expect(sheet).toContainText(`Archive all inbox mail from ${senderName}`);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  // Cancel must leave the queue untouched (no optimistic anything).
  await expect(rowHeader).toBeVisible();

  // ---- Keep leg: `K` dispatches immediately (D40 — Keep is
  // non-destructive; no preview, no undo token). The row leaves the
  // queue only after the server confirms and the refetch drops it.
  await page.keyboard.press('k');
  await expect(rowHeader).toHaveCount(0, { timeout: 30_000 });

  // ---- Durability: the keep decision row exists…
  const activityRows = await sql<{ id: string }[]>`
    SELECT id FROM activity_log
    WHERE mailbox_account_id = ${mailboxId}
      AND sender_key = ${senderKey}
      AND action = 'keep'
      AND occurred_at >= ${testStart.toISOString()}
  `;
  expect(activityRows.length).toBe(1);

  // …and the outbox consumer (worker) projects policy_type='keep'
  // into sender_policies (D40 / D204). Worker-async — poll.
  await expect
    .poll(
      async () => {
        const policy = await getSenderPolicy(sql, mailboxId, senderKey);
        return policy?.policy_type ?? null;
      },
      { timeout: 30_000, message: 'outbox → sender_policies keep projection (worker running?)' },
    )
    .toBe('keep');
});
