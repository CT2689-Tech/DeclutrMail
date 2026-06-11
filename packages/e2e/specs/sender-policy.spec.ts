import { expect, test } from '@playwright/test';
import type postgres from 'postgres';

import { ApiClient, requireLiveStack } from '../helpers/api';
import { dbConnect, getSenderPolicy, senderKeyById, type SenderPolicyRow } from '../helpers/db';

/**
 * Golden spec 2 — Sender standing policy: the VIP toggle (D183 / D42 / D43).
 *
 * Walks senders list → sender detail → VIP chip:
 *
 *   1. /senders renders the live grid; the first card supplies the
 *      target sender id (list → detail walk).
 *   2. On /senders/:id the VIP chip flips ('VIP' ↔ '★ VIP') and writes
 *      `sender_policies.is_vip` via `PATCH /api/senders/:id/policy`
 *      (SET-STATE — non-destructive, no D226 preview by design).
 *   3. Persistence is asserted by RELOADING the page between toggles —
 *      the chip state must come back from the server, not local state.
 *   4. The toggle is flipped back, so the flow is self-restoring at
 *      the UI level; teardown additionally restores the policy row to
 *      its exact pre-test snapshot and removes the D43 audit rows the
 *      toggles appended (shared dev DB — leave no trace).
 */

const api = new ApiClient();
let sql: postgres.Sql;
let mailboxId: string;
let target: { senderKey: string; prePolicy: SenderPolicyRow | null } | null = null;
let testStart: Date;

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  test.skip(live.mailboxId === null, 'reason' in live ? live.reason : undefined);
  mailboxId = live.mailboxId!;
  sql = dbConnect();
});

test.afterAll(async () => {
  if (sql && target) {
    // Exact restore: the PATCH upserts a policy row; if none existed
    // before the test, delete it — otherwise reset the toggled fields
    // to the snapshot. Then drop the D43 audit rows from the toggles.
    const { senderKey, prePolicy } = target;
    if (prePolicy === null) {
      await sql`
        DELETE FROM sender_policies
        WHERE mailbox_account_id = ${mailboxId} AND sender_key = ${senderKey}
      `;
    } else {
      await sql`
        UPDATE sender_policies
        SET is_vip = ${prePolicy.is_vip},
            is_protected = ${prePolicy.is_protected},
            policy_type = ${prePolicy.policy_type}::sender_policy_type
        WHERE mailbox_account_id = ${mailboxId} AND sender_key = ${senderKey}
      `;
    }
    await sql`
      DELETE FROM activity_log
      WHERE mailbox_account_id = ${mailboxId}
        AND sender_key = ${senderKey}
        AND action IN ('marked_vip', 'unmarked_vip')
        AND occurred_at >= ${testStart.toISOString()}
    `;
  }
  if (sql) await sql.end();
  await api.dispose();
});

test('VIP toggle persists across reload and restores on toggle-back', async ({ page }) => {
  testStart = new Date();

  // ---- Senders list — the entry point of the walk.
  await page.goto('/senders');
  const firstCard = page.locator('article[data-testid^="sender-card-"]').first();
  await expect(firstCard).toBeVisible({ timeout: 30_000 });
  const cardTestId = await firstCard.getAttribute('data-testid');
  const senderId = cardTestId!.replace('sender-card-', '');

  // Snapshot the policy row for exact teardown restore.
  const senderKey = await senderKeyById(sql, mailboxId, senderId);
  const prePolicy = await getSenderPolicy(sql, mailboxId, senderKey);
  target = { senderKey, prePolicy };

  // ---- Detail page — the VIP toggle. State reads from the visible
  // label ('VIP' off ↔ '★ VIP' on): the page passes aria-pressed to
  // the shared <Button>, but Button drops non-destructured props so
  // the attribute never reaches the DOM (bug flagged separately —
  // switch this selector to button[aria-pressed] once fixed).
  await page.goto(`/senders/${senderId}`);
  const vipChip = page.getByRole('button', { name: /^(★ )?VIP$/ });
  await expect(vipChip).toBeVisible({ timeout: 30_000 });
  const initialPressed = (await vipChip.innerText()).includes('★');
  const labelFor = (pressed: boolean) => (pressed ? '★ VIP' : 'VIP');

  // ---- Toggle ON (or off, if the sender is already VIP).
  await vipChip.click();
  await expect(vipChip).toHaveText(labelFor(!initialPressed));
  await expect(page.getByText(initialPressed ? 'Removed VIP mark' : 'Marked VIP')).toBeVisible();

  // Server durability — the SET-STATE patch landed in sender_policies.
  await expect
    .poll(async () => (await getSenderPolicy(sql, mailboxId, senderKey))?.is_vip ?? false)
    .toBe(!initialPressed);

  // ---- Reload: the flipped state must come back from the server.
  await page.reload();
  await expect(vipChip).toBeVisible({ timeout: 30_000 });
  await expect(vipChip).toHaveText(labelFor(!initialPressed));

  // ---- Toggle back (self-restoring). Server durability is asserted
  // via the DB poll below rather than a second reload — one reload
  // already proved server-side persistence, and each detail load
  // costs ~6 reads from the shared 30/min `triage-load` budget when
  // a stack runs with the limiter on (bucket tuning flagged
  // separately; the documented e2e stack disables the limiter).
  await vipChip.click();
  await expect(vipChip).toHaveText(labelFor(initialPressed));

  await expect
    .poll(async () => (await getSenderPolicy(sql, mailboxId, senderKey))?.is_vip ?? null)
    // A pre-existing row keeps its original is_vip; a row the PATCH
    // created on first toggle survives with is_vip back to false
    // (teardown deletes it for the exact restore).
    .toBe(prePolicy === null ? false : prePolicy.is_vip);
});
