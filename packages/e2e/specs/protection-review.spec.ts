import { expect, test } from '@playwright/test';
import type postgres from 'postgres';

import { ApiClient, requireLiveStack } from '../helpers/api';
import { dbConnect, getSenderPolicy, type SenderPolicyRow } from '../helpers/db';

/**
 * The STANDING protection review — Settings → Protected senders (D245).
 *
 * Onboarding's step 5 reviews at most five weak protections once and is
 * then gone forever; a real mailbox carries dozens (460 strong / 55 weak
 * on the founder's account). This page is where the rest stay
 * reachable, so what it must do is:
 *
 *   1. Say WHY each sender is protected. Three of the four
 *      `protection_reason` values are AUTOMATIC, so a list that only
 *      shows names implies the user chose every row — the 2026-08-07
 *      finding, and what CLAUDE.md §2.6 / D245 forbid.
 *   2. Remove protection IN PLACE. It used to require a trip to
 *      /senders/:id per sender; 55 wrong protections meant 55 round
 *      trips, which is why nobody corrected them.
 *
 * The Unprotect is a SET-STATE policy write — non-destructive, no D226
 * preview, no undo token, nothing moves in Gmail. That is what makes it
 * safe to exercise against the live dev mailbox here. The spec restores
 * the exact `sender_policies` snapshot and drops the D43 audit row it
 * appends, so the shared dev DB is left as found.
 */

const api = new ApiClient();
let sql: postgres.Sql;
let mailboxId: string;
let restore: { senderKey: string; prePolicy: SenderPolicyRow } | null = null;
let testStart: Date;

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  test.skip(live.mailboxId === null, 'reason' in live ? live.reason : undefined);
  mailboxId = live.mailboxId!;
  sql = dbConnect();
  testStart = new Date();
});

test.afterAll(async () => {
  if (sql && restore) {
    const { senderKey, prePolicy } = restore;
    await sql`
      UPDATE sender_policies
      SET is_protected = ${prePolicy.is_protected},
          protection_reason = ${prePolicy.protection_reason},
          protection_set_at = ${prePolicy.protection_set_at}
      WHERE mailbox_account_id = ${mailboxId} AND sender_key = ${senderKey}
    `;
    // The PATCH appends an `unmarked_protected` audit row (D43). Drop
    // the ones this run created — the state it recorded is undone, and
    // an audit row whose effect no longer exists is worse than none.
    await sql`
      DELETE FROM activity_log
      WHERE mailbox_account_id = ${mailboxId}
        AND sender_key = ${senderKey}
        AND action = 'unmarked_protected'
        AND occurred_at >= ${testStart}
    `;
  }
  await sql?.end({ timeout: 5 });
});

test('protected senders show the exact reason, and Unprotect works in place', async ({ page }) => {
  await page.goto('/settings/senders');

  await expect(page.getByRole('heading', { name: 'Protected senders' })).toBeVisible();

  const rows = page.getByRole('listitem');
  const rowCount = await rows.count();
  test.skip(rowCount === 0, 'no protected senders on the dev mailbox');

  // (1) EVERY row names its evidence. Not "some row somewhere shows a
  // reason" — a list that says why for only the rows we happened to
  // look at is the same defect wearing a smaller hat.
  const REASON =
    /you marked it Protected|you replied at least 3 times|you starred a message|Gmail marks it important/;
  for (let i = 0; i < rowCount; i += 1) {
    await expect(rows.nth(i)).toHaveText(REASON);
  }

  // (2) Unprotect in place — no navigation to the detail page.
  const first = rows.first();
  const unprotect = first.getByRole('button', { name: /^Unprotect / });
  const senderName = (await unprotect.getAttribute('aria-label'))!.replace(/^Unprotect /, '');

  // Snapshot BEFORE, keyed by the row the UI is about to act on, so the
  // restore targets exactly what changed.
  const senderKeyRows = await sql<{ sender_key: string }[]>`
    SELECT s.sender_key
    FROM senders s
    JOIN sender_policies sp
      ON sp.sender_key = s.sender_key AND sp.mailbox_account_id = s.mailbox_account_id
    WHERE s.mailbox_account_id = ${mailboxId}
      AND s.display_name = ${senderName}
      AND sp.is_protected = true
    LIMIT 1
  `;
  const senderKey = senderKeyRows[0]?.sender_key;
  test.skip(!senderKey, `could not resolve sender_key for ${senderName}`);
  const prePolicy = await getSenderPolicy(sql, mailboxId, senderKey!);
  expect(prePolicy?.is_protected).toBe(true);
  restore = { senderKey: senderKey!, prePolicy: prePolicy! };

  await unprotect.click();

  // The row leaves the list — the server confirmed, the cache was
  // invalidated, and nothing still says "Protected" about it.
  await expect(page.getByRole('button', { name: `Unprotect ${senderName}` })).toBeHidden();
  await expect(page).toHaveURL(/\/settings\/senders$/);

  // D245 sticky override: the flag drops, the REASON is kept as the
  // record of what it was. A restore keyed on the reason being cleared
  // would be restoring the wrong thing.
  const postPolicy = await getSenderPolicy(sql, mailboxId, senderKey!);
  expect(postPolicy?.is_protected).toBe(false);
  expect(postPolicy?.protection_reason).toBe(prePolicy!.protection_reason);
});
