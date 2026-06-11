import { expect, test } from '@playwright/test';
import type postgres from 'postgres';

import { ApiClient, requireLiveStack, type CompositePreview } from '../helpers/api';
import { dbConnect, senderKeyById } from '../helpers/db';

/**
 * Golden spec 3 — Archive → receipt → Undo via the tray (D183 / D226 / D35).
 *
 * THE Gmail-mutating spec: it archives ONE small sender's inbox mail
 * for real (worker executes the Gmail label mutation), then restores
 * it through the REAL undo pipeline — the full D226 lifecycle:
 *
 *   intent (card ⋯ → Archive) → mandatory preview modal → confirm
 *   → worker mutation → receipt (real undo token) → tray on /triage
 *   → Z / row-Undo → reverse job → server-confirmed restore.
 *
 * Restore: the undo IS the restore (Gmail labels + DB rows + triage
 * queue exclusion all reverse). A teardown safety net re-fires the
 * undo token via the api if the test died between archive and undo.
 * The activity/undo-journal audit rows are left in place — they are
 * the true record of a real, reversed mutation (never falsify audit).
 *
 * Target choice keeps blast radius tiny: an unprotected sender with
 * 1–5 messages currently in the inbox (live composite preview count).
 */

interface SenderRow {
  id: string;
  displayName: string;
  domain: string;
  protectionFlags: { isVip: boolean; isProtected: boolean };
}

const api = new ApiClient();
let sql: postgres.Sql;
let mailboxId: string;
let undoToken: string | null = null;
let undone = false;

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  test.skip(live.mailboxId === null, 'reason' in live ? live.reason : undefined);
  mailboxId = live.mailboxId!;
  sql = dbConnect();
});

test.afterAll(async () => {
  // Safety net — if the spec failed after the archive landed but
  // before the tray undo confirmed, reverse it now so the founder's
  // mailbox is never left mutated by a red test run.
  if (undoToken && !undone) {
    try {
      const active = await api.get<{ token: string }[]>('/api/undo');
      if (active.some((e) => e.token === undoToken)) {
        await api.post(`/api/undo/${undoToken}`);
        // The reverse is async (worker) — give it a moment to land.
        await new Promise((r) => setTimeout(r, 10_000));
      }
    } catch (err) {
      console.error(
        `TEARDOWN: could not auto-undo token ${undoToken} — ` +
          `restore manually via POST /api/undo/${undoToken}. ${String(err)}`,
      );
    }
  }
  if (sql) await sql.end();
  await api.dispose();
});

test('Archive one sender via preview, then restore it through the undo tray', async ({ page }) => {
  const testStart = new Date();

  // ---- Pick the target: first-page (default Total↓ sort — same page
  // the UI grid renders), unprotected, 1–5 messages in the inbox NOW
  // per the live composite preview.
  const rows = await api.get<SenderRow[]>('/api/senders?limit=50');
  let target: { id: string; name: string; domain: string; inboxCount: number } | null = null;
  let probes = 0;
  for (const row of rows) {
    // Bound the probe burst — each candidate costs one preview GET.
    if (probes >= 15) break;
    if (row.protectionFlags.isVip || row.protectionFlags.isProtected) continue;
    // Unique display name keeps the receipt/toast assertions unambiguous.
    if (rows.filter((r) => r.displayName === row.displayName).length !== 1) continue;
    probes += 1;
    const preview = await api.get<CompositePreview>(`/api/actions/preview?senderId=${row.id}`);
    if (preview.protected) continue;
    if (preview.counts.all >= 1 && preview.counts.all <= 5) {
      target = {
        id: row.id,
        name: row.displayName,
        domain: row.domain,
        inboxCount: preview.counts.all,
      };
      break;
    }
  }
  test.skip(target === null, 'no unprotected sender with 1–5 inbox messages on the first page');
  const { id: senderId, domain: senderDomain, inboxCount } = target!;
  const senderKey = await senderKeyById(sql, mailboxId, senderId);

  // ---- Senders grid → the target card's ⋯ popover → Archive.
  await page.goto('/senders');
  const card = page.getByTestId(`sender-card-${senderId}`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button', { name: 'More actions' }).click();
  await card.getByRole('menuitem', { name: /Archive/ }).click();

  // ---- D226 mandatory preview modal — real count, then confirm.
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Preview · before anything changes');
  // The modal's sender-context strip names the domain (the title is
  // count-based: "Archive all mail from 1 sender").
  await expect(modal).toContainText(senderDomain);
  const confirm = modal.getByRole('button', { name: /Archive \d/ });
  await expect(confirm).toBeEnabled();
  await expect(confirm).toContainText(`Archive ${inboxCount.toLocaleString()}`);
  await confirm.click();

  // ---- Receipt strip appears ONLY on worker confirmation (no
  // optimistic receipt) and carries the real undo token.
  const receipt = page.getByRole('status').filter({ hasText: 'Archived 1 sender' });
  await expect(receipt).toBeVisible({ timeout: 90_000 });
  await expect(receipt).toContainText('reversible');

  // Capture the token for the tray leg + the teardown safety net.
  const tokenRows = await sql<{ undo_token: string }[]>`
    SELECT undo_token FROM activity_log
    WHERE mailbox_account_id = ${mailboxId}
      AND sender_key = ${senderKey}
      AND action = 'archive'
      AND occurred_at >= ${testStart.toISOString()}
      AND undo_token IS NOT NULL
    ORDER BY occurred_at DESC
  `;
  expect(tokenRows.length).toBe(1);
  undoToken = tokenRows[0]!.undo_token;

  // ---- Tray leg (D35): the persistent tray on /triage lists the
  // token; Z undoes the NEWEST entry, a row click undoes a specific
  // one. Use Z when ours is newest (the common case), otherwise the
  // matching row's Undo button — both are real tray affordances.
  await page.goto('/triage');
  const tray = page.getByRole('region', { name: 'Recent actions — undo available' });
  await expect(tray).toBeVisible({ timeout: 30_000 });
  const entries = await api.get<{ token: string }[]>('/api/undo');
  const ourIndex = entries.findIndex((e) => e.token === undoToken);
  expect(ourIndex).toBeGreaterThanOrEqual(0);
  if (ourIndex === 0) {
    await page.keyboard.press('z');
  } else {
    await tray.getByRole('button', { name: 'Undo Archive' }).nth(ourIndex).click();
  }

  // ---- Server-confirmed restore: completion toast, token consumed,
  // and the sender's live inbox count is back (the worker reversed
  // the Gmail mutation; the composite preview reads the same live
  // count the D226 preview used).
  await expect(page.getByText('Restored to your inbox')).toBeVisible({ timeout: 90_000 });
  undone = true;
  await expect
    .poll(async () => (await api.get<{ token: string }[]>('/api/undo')).map((e) => e.token), {
      timeout: 30_000,
    })
    .not.toContain(undoToken);
  await expect
    .poll(
      async () =>
        (await api.get<CompositePreview>(`/api/actions/preview?senderId=${senderId}`)).counts.all,
      { timeout: 90_000, message: 'inbox count restored after undo' },
    )
    // ≥ not = : a genuinely new email arriving mid-test would push the
    // count past the snapshot; the restore signal is the count coming
    // back from 0 to (at least) what the preview promised to move.
    .toBeGreaterThanOrEqual(inboxCount);
});
