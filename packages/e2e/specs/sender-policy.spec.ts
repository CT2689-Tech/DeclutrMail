import { expect, test } from '@playwright/test';
import type postgres from 'postgres';

import { ApiClient, requireLiveStack } from '../helpers/api';
import { dbConnect, getSenderPolicy, senderKeyById, type SenderPolicyRow } from '../helpers/db';

/**
 * Golden spec 2 — Sender standing policy: the Protect toggle (D183 / D42 / D43).
 *
 * Walks senders list → sender detail → Protect chip:
 *
 *   1. /senders renders the live grid; the first card supplies the
 *      target sender id (list → detail walk).
 *   2. On /senders/:id the Protect chip flips ('Protect' ↔ '◆ Protect') and writes
 *      `sender_policies.is_protected` via `PATCH /api/senders/:id/policy`
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
        SET is_protected = ${prePolicy.is_protected},
            protection_reason = ${prePolicy.protection_reason}::protection_reason,
            protection_set_at = ${prePolicy.protection_set_at},
            policy_type = ${prePolicy.policy_type}::sender_policy_type
        WHERE mailbox_account_id = ${mailboxId} AND sender_key = ${senderKey}
      `;
    }
    await sql`
      DELETE FROM activity_log
      WHERE mailbox_account_id = ${mailboxId}
        AND sender_key = ${senderKey}
        AND action IN ('marked_protected', 'unmarked_protected')
        AND occurred_at >= ${testStart.toISOString()}
    `;
  }
  if (sql) await sql.end();
  await api.dispose();
});

test('Protect toggle persists across reload and restores on toggle-back', async ({ page }) => {
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

  // ---- Detail page — the Protect toggle. Button forwards
  // `ariaPressed` to the DOM (D43 fix), so state reads from the
  // toggle semantics; the visible label ('Protect' ↔ '◆ Protect') is kept as
  // a secondary assertion.
  await page.goto(`/senders/${senderId}`);
  const protectChip = page.getByRole('button', { name: /^(◆ )?Protect$/ });
  await expect(protectChip).toBeVisible({ timeout: 30_000 });
  await expect(protectChip).toHaveAttribute('aria-pressed', /true|false/);
  const initialPressed = (await protectChip.getAttribute('aria-pressed')) === 'true';
  const labelFor = (pressed: boolean) => (pressed ? '◆ Protect' : 'Protect');

  // ---- Toggle ON (or off, if the sender is already protected).
  await protectChip.click();
  await expect(protectChip).toHaveText(labelFor(!initialPressed));
  await expect(page.getByText(initialPressed ? 'Unprotected' : 'Protected')).toBeVisible();

  // Server durability — the SET-STATE patch landed in sender_policies.
  await expect
    .poll(async () => (await getSenderPolicy(sql, mailboxId, senderKey))?.is_protected ?? false)
    .toBe(!initialPressed);

  // ---- Reload: the flipped state must come back from the server.
  await page.reload();
  await expect(protectChip).toBeVisible({ timeout: 30_000 });
  await expect(protectChip).toHaveText(labelFor(!initialPressed));

  // ---- Toggle back (self-restoring). Server durability is asserted
  // via the DB poll below rather than a second reload — one reload
  // already proved server-side persistence, and each detail load
  // costs ~6 reads from the shared 30/min `triage-load` budget when
  // a stack runs with the limiter on (bucket tuning flagged
  // separately; the documented e2e stack disables the limiter).
  await protectChip.click();
  await expect(protectChip).toHaveText(labelFor(initialPressed));

  await expect
    .poll(async () => (await getSenderPolicy(sql, mailboxId, senderKey))?.is_protected ?? null)
    // A pre-existing row keeps its original is_protected; a row the PATCH
    // created on first toggle survives with is_protected back to false
    // (teardown deletes it for the exact restore).
    .toBe(prePolicy === null ? false : prePolicy.is_protected);
});
