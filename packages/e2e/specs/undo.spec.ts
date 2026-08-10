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
  protectionFlags: { isProtected: boolean };
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
    if (row.protectionFlags.isProtected) continue;
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
  // The confirm button is the verb alone ("📥 Archive"); the D226 real
  // count lives in the preview BODY. Asserting the count on the button
  // pinned copy that no longer exists, so this checks it where the user
  // actually reads it.
  // The confirm CTA is the only button carrying the ⌘⏎ chip, and that
  // chip is part of its accessible name — matching on the verb alone
  // finds nothing, and matching a count finds nothing either.
  const confirm = modal.getByRole('button', { name: /Archive.*⌘⏎/ });
  await expect(confirm).toBeEnabled();
  await expect(modal).toContainText(`${inboxCount.toLocaleString()}`);
  await expect(modal).toContainText(/emails? currently match/);
  await confirm.click();

  // ---- Arm the teardown safety net FIRST, from the DB, not the UI.
  // The old order captured the token only after the receipt assertion —
  // so a failure inside that assertion died with `undoToken` still
  // null, the afterAll skipped the revert, and the run left the
  // founder's mail archived (exactly what the 2026-08-10 diagnosis
  // found: two Jockey emails stranded by a red run). The worker writes
  // the activity row within ~a second of the mutation; poll for it
  // before asserting anything visual.
  await expect
    .poll(
      async () => {
        const tokenRows = await sql<{ undo_token: string }[]>`
          SELECT undo_token FROM activity_log
          WHERE mailbox_account_id = ${mailboxId}
            AND sender_key = ${senderKey}
            AND action = 'archive'
            AND occurred_at >= ${testStart.toISOString()}
            AND undo_token IS NOT NULL
          ORDER BY occurred_at DESC
        `;
        undoToken = tokenRows[0]?.undo_token ?? null;
        return tokenRows.length;
      },
      { timeout: 90_000, message: 'worker wrote the archive activity row + undo token' },
    )
    .toBe(1);

  // ---- Receipt strip appears ONLY on worker confirmation (no
  // optimistic receipt) and carries the real undo token.
  // Filtered on the deadline copy, which ONLY the receipt renders. The
  // old filter ({ hasText: 'Archived' }) also matched the 3.6s success
  // TOAST ("Archived 2 emails from Jockey", also role=status) — and a
  // strict-mode violation is TERMINAL, not retried, so every run died
  // ~2s after confirm, at the exact moment the receipt appeared next to
  // the still-alive toast. The 90s timeout in the error made it read as
  // "the strip never appeared"; the trace shows it failing at +2s with
  // the receipt PRESENT as element 1 of 2.
  const receipt = page.getByRole('status').filter({ hasText: 'Activity Undo until' });
  await expect(receipt).toBeVisible({ timeout: 90_000 });
  await expect(receipt).toContainText('Archived');
  await expect(receipt).toContainText('1 sender');

  // ---- Tray leg (D35): the app-shell tray on THIS screen lists the
  // token. The old leg navigated to /triage first — but the tray now
  // BASELINES: tokens already live when a screen is entered are
  // history, not feedback, and stay hidden there (the scoping change
  // in `triage-undo-tray.tsx` — "the tray shows the decisions YOU took
  // on the screen you are on"). A /senders-born archive is therefore
  // visible in the tray on /senders and never on a freshly-entered
  // /triage; the 2026-08-10 diagnosis watched the leg time out on
  // exactly that. Z stays a Triage-only affordance
  // (`enableShortcut={active === 'triage'}`), so undo here rides the
  // row's real Undo button.
  const tray = page.getByRole('region', { name: 'Recent actions — undo available' });
  await expect(tray).toBeVisible({ timeout: 30_000 });
  const entries = await api.get<{ token: string }[]>('/api/undo');
  expect(entries.some((e) => e.token === undoToken)).toBe(true);
  await tray.getByRole('button', { name: 'Undo Archive' }).first().click();

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
