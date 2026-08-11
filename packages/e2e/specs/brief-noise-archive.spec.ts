import { expect, test } from '@playwright/test';
import type postgres from 'postgres';

import { ApiClient, requireLiveStack, type CompositePreview } from '../helpers/api';
import { dbConnect, senderKeyById } from '../helpers/db';

/**
 * Brief Noise bulk archive — D65 / D226 / D69 / D35.
 *
 * The second Gmail-mutating spec, and the regression test for the worst
 * defect the D65 review found: the `Archived ✓` mark and the receipt
 * used to be plain component state, so a real tray undo left the Brief
 * asserting an archive whose mail was already back in the inbox. The
 * final assertion here is that the mark is GONE after the undo — it
 * fails against any implementation that stores that state instead of
 * deriving it from the server.
 *
 * Full lifecycle exercised for real:
 *
 *   checkbox selection → Archive N senders → mandatory preview modal
 *   → confirm → worker Gmail mutation → persistent receipt + Archived ✓
 *   → tray Undo → reverse job → mark and receipt both disappear
 *
 * Restore: the undo IS the restore. A teardown safety net re-fires the
 * token via the api if the spec dies between the archive and the undo,
 * so a red run never leaves the founder's mailbox mutated. The token is
 * captured from the DB BEFORE any visual assertion, for exactly that
 * reason (the pattern undo.spec.ts arrived at the hard way).
 *
 * Blast radius: exactly ONE Noise sender, chosen for having 1–5 messages
 * in the inbox right now. Every other sender is unchecked first.
 */

interface BriefNoiseSenderWire {
  senderKey: string;
  senderId: string | null;
  isProtected: boolean;
}

interface BriefWire {
  id: string;
  briefPayload: {
    noise: { senderKey: string; senderName: string; messageCount: number }[];
  };
  noiseSenders: BriefNoiseSenderWire[];
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
  if (undoToken && !undone) {
    try {
      const active = await api.get<{ token: string }[]>('/api/undo');
      if (active.some((e) => e.token === undoToken)) {
        await api.post(`/api/undo/${undoToken}`);
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

test('Archive one Noise sender from the Brief, then undo it from the tray', async ({ page }) => {
  const testStart = new Date();

  // ---- The Brief must exist AND be granted. Both are designed states
  // with distinct causes, so each gets its own skip reason rather than a
  // silent pass: 402 = the workspace is under Pro (D19), 404 = the
  // snapshot worker has not fired for today yet (D69).
  const briefRes = await api.getRaw('/api/briefs/today');
  test.skip(
    briefRes.status === 402,
    'Brief is a Pro capability (D19) — this workspace is not on Pro',
  );
  test.skip(briefRes.status === 404, "today's Brief snapshot has not been generated yet (D69)");
  expect(briefRes.status).toBe(200);
  const brief = (briefRes.body as { data: BriefWire }).data;

  // ---- Pick exactly one target: actionable (resolved + unprotected)
  // with 1–5 messages in the inbox right now.
  const actionable = brief.noiseSenders.filter((s) => s.senderId !== null && !s.isProtected);
  test.skip(actionable.length === 0, 'no actionable Noise senders in today’s Brief');

  let target: { senderId: string; senderName: string; inboxCount: number } | null = null;
  let probes = 0;
  for (const candidate of actionable) {
    if (probes >= 15) break;
    probes += 1;
    const preview = await api.get<CompositePreview>(
      `/api/actions/preview?senderId=${candidate.senderId}`,
    );
    if (preview.protected) continue;
    if (preview.counts.all >= 1 && preview.counts.all <= 5) {
      const group = brief.briefPayload.noise.find((g) => g.senderKey === candidate.senderKey);
      // A duplicate display name would make the row locators ambiguous.
      if (!group) continue;
      if (brief.briefPayload.noise.filter((g) => g.senderName === group.senderName).length !== 1) {
        continue;
      }
      target = {
        senderId: candidate.senderId!,
        senderName: group.senderName,
        inboxCount: preview.counts.all,
      };
      break;
    }
  }
  test.skip(target === null, 'no Noise sender with 1–5 inbox messages');
  const { senderId, senderName, inboxCount } = target!;
  const senderKey = await senderKeyById(sql, mailboxId, senderId);

  await page.goto('/brief');

  // ---- D65: every actionable sender arrives CHECKED. Uncheck all but
  // the target so the mutation touches exactly one sender.
  const targetBox = page.getByRole('checkbox', {
    name: `Include ${senderName} in the archive`,
  });
  await expect(targetBox).toBeVisible({ timeout: 30_000 });
  await expect(targetBox).toBeChecked();

  const allBoxes = page.getByRole('checkbox', { name: /in the archive$/ });
  const boxCount = await allBoxes.count();
  for (let i = 0; i < boxCount; i += 1) {
    const box = allBoxes.nth(i);
    const label = await box.getAttribute('aria-label');
    if (label === `Include ${senderName} in the archive`) continue;
    if (await box.isChecked()) await box.uncheck();
  }
  const archiveCta = page.getByRole('button', { name: 'Archive 1 sender' });
  await expect(archiveCta).toBeEnabled();
  await archiveCta.click();

  // ---- D226 mandatory preview — the REAL live count, then confirm.
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Preview · before anything changes');
  await expect(modal).toContainText(senderName);
  // The scope sentence is load-bearing: the Noise heading counts
  // yesterday, the action reaches the whole inbox.
  await expect(modal).toContainText('is in your inbox now');
  const confirm = modal.getByRole('button', { name: /Archive.*⌘⏎/ });
  await expect(confirm).toBeEnabled();
  await expect(modal).toContainText(`${inboxCount.toLocaleString()}`);
  await expect(modal).toContainText(/emails? currently match in Inbox/);
  await confirm.click();

  // ---- Arm the teardown safety net FIRST, from the DB. A failure in
  // any assertion below must still be recoverable.
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

  // ---- The persistent receipt. Scoped to the Noise section's own
  // status line: a looser filter also matches the 3.6s success toast,
  // and a strict-mode violation is TERMINAL rather than retried (the
  // failure mode undo.spec.ts documents).
  const noiseSection = page.getByRole('region', { name: /^Noise \(/ });
  const receipt = noiseSection.getByRole('status');
  await expect(receipt).toContainText('Archived', { timeout: 90_000 });
  await expect(receipt).toContainText('1 sender');

  // ---- D69: the acted row is marked Done, and its frozen yesterday
  // count is still beside it — an archive today does not restate what
  // yesterday held.
  const archivedRow = noiseSection.getByRole('listitem').filter({ hasText: senderName });
  await expect(archivedRow).toContainText('Archived ✓');
  await expect(archivedRow).toContainText('messages yesterday');

  // ---- Undo through the global tray.
  const tray = page.getByRole('region', { name: 'Recent actions — undo available' });
  await expect(tray).toBeVisible({ timeout: 30_000 });
  const entries = await api.get<{ token: string }[]>('/api/undo');
  expect(entries.some((e) => e.token === undoToken)).toBe(true);
  await tray.getByRole('button', { name: 'Undo Archive' }).first().click();

  await expect(page.getByText('Restored to your inbox')).toBeVisible({ timeout: 90_000 });
  undone = true;
  await expect
    .poll(async () => (await api.get<{ token: string }[]>('/api/undo')).map((e) => e.token), {
      timeout: 30_000,
    })
    .not.toContain(undoToken);

  // ---- THE regression assertion. The mail is back in the inbox, so the
  // Brief must stop claiming it was archived. This is what fails when
  // the acted state is stored in the component instead of derived from
  // the server: no invalidation the tray fires can reach a useState.
  await expect(archivedRow).not.toContainText('Archived ✓', { timeout: 30_000 });
  await expect(receipt).toContainText('That archive was undone');
  await expect(
    page.getByRole('checkbox', { name: `Include ${senderName} in the archive` }),
  ).toBeVisible();

  // ---- And the mail really is back where it started.
  await expect
    .poll(
      async () =>
        (await api.get<CompositePreview>(`/api/actions/preview?senderId=${senderId}`)).counts.all,
      { timeout: 90_000, message: 'inbox count restored after undo' },
    )
    .toBeGreaterThanOrEqual(inboxCount);
});
