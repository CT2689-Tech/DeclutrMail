import { expect, test } from '@playwright/test';
import type postgres from 'postgres';

import { applyJourneySeed } from '../helpers/seed-journeys';

import { ApiClient, requireLiveStack, type TriageQueueRow } from '../helpers/api';
import { dbConnect, getSenderPolicy, senderKeyById } from '../helpers/db';

/** Isolated synthetic API/UI journey. No Gmail credentials or worker. */

const api = new ApiClient();
let sql: postgres.Sql;
let mailboxId: string;
let target: { senderKey: string; senderName: string } | null = null;
let testStart: Date;

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  expect(live.mailboxId).not.toBeNull();
  mailboxId = live.mailboxId!;
  sql = dbConnect();
  await applyJourneySeed(sql);
});

test.afterAll(async () => {
  // Restore the isolated fixture DB: remove the keep decision row (the
  // sender returns to the queue) and the outbox-projected policy row.
  // Only this synthetic sender and this run's timestamps are removed.
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
  expect(rows.length, 'synthetic triage fixture must be queued').toBeGreaterThan(0);
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
  expect(target, 'synthetic policy-free sender must be queued').not.toBeNull();
  const { senderName, senderKey } = target!;

  // ---- Open /triage. Focus mode is the default (one sender on stage);
  // the target can sit anywhere in the queue, so switch to the list —
  // "See all" — and find its row. The header's accessible name flips
  // expand ↔ collapse with state, so match both.
  await page.goto('/triage');
  await expect(page.getByRole('region', { name: 'Current decision' })).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).click();
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
  // The region wraps a fixed-position sheet, so its own box has no visible
  // area even while the dialog is on screen.
  await expect(page.getByRole('region', { name: `Preview · Archive ${senderName}` })).toHaveCount(
    1,
  );
  // The count + verb is the title ("Archive 12 emails?"); whose email and
  // where it goes is the subtitle.
  await expect(sheet.getByRole('heading', { level: 2 })).toHaveText(/^Archive .*\?$/);
  await expect(sheet).toContainText(`From ${senderName}.`);
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

  // The synchronous API contract commits the projection event atomically.
  // Worker consumption is separately covered by worker tests, not this no-worker lane.
  const events = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM outbox_events
    WHERE topic = 'triage.verdict_applied'
      AND aggregate_id = ${activityRows[0]!.id}
      AND payload->>'mailboxAccountId' = ${mailboxId}
      AND payload->>'senderKey' = ${senderKey}
      AND payload->>'verdict' = 'keep'
  `;
  expect(Number(events[0]?.count)).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Triage' })).toBeVisible();
  expect(
    (await api.get<TriageQueueRow[]>('/api/triage/queue')).some(
      (row) => row.senderName === senderName,
    ),
  ).toBe(false);
});
