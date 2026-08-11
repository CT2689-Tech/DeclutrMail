import { expect, test, type Page } from '@playwright/test';
import type postgres from 'postgres';

import { ApiClient, requireLiveStack, type CompositePreview } from '../helpers/api';
import { dbConnect, senderKeyById } from '../helpers/db';
import { E2E_ENV } from '../helpers/env';

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
 * Blast radius: exactly ONE Noise sender — the one with the SMALLEST live
 * inbox count that still fits the window. Every other sender is unchecked
 * before the archive runs.
 *
 * On skipping: only three states skip, and each is a genuinely degenerate
 * environment (not Pro, no snapshot, every Noise sender Protected).
 * "A Brief with actionable Noise senders, none of which fits the window"
 * FAILS, loudly, with the observed counts — a spec that can silently skip
 * on the path it exists to cover is the blind-guard failure: green
 * forever, verifying nothing.
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

/**
 * Answer the D147 cookie banner BEFORE the first navigation, choosing
 * **essential only** — declining non-essential is the privacy-preserving
 * default, and a test must never manufacture analytics consent.
 *
 * Needed because this is the only spec whose primary control sits at the
 * BOTTOM of the page. The banner is `position: fixed; bottom; right;
 * zIndex: 150` while `NoiseArchiveBar` is in normal document flow, so
 * Playwright's scroll-into-view centres the Archive CTA directly beneath
 * it and every click is intercepted.
 *
 * Seeded, not clicked. Clicking through chrome to reach the control under
 * test makes the spec break again the next time the chrome moves — and it
 * would mean the archive assertions ride on the banner's markup.
 *
 * Mirrors `storeConsent` in `apps/web/src/lib/cookie-consent.ts`: it
 * writes BOTH stores, and `readStoredConsent` reads either (restrictive
 * value wins when they disagree). The cookie alone would suffice; both
 * are written so the browser state matches production exactly.
 *
 * Local to this spec on purpose — move it to `helpers/` when a second
 * spec needs it.
 */
async function declineNonEssentialCookies(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'dm_cookie_consent',
      value: 'essential',
      url: E2E_ENV.webUrl,
      sameSite: 'Lax',
    },
  ]);
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('dm-cookie-consent', 'essential');
    } catch {
      // Storage disabled — the mirror cookie above already carries the
      // choice, exactly as `storeConsent` tolerates.
    }
  });
}

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

  // ---- The remaining degenerate environments — and only these — skip.
  const noiseGroups = brief.briefPayload.noise;
  test.skip(noiseGroups.length === 0, "today's Brief has no Noise section — nothing to archive");

  // A Brief WITH Noise whose senders all failed to resolve is the D65
  // read-time join breaking, which is precisely what this spec exists to
  // catch. Skipping there would hide the regression behind a green run.
  const unresolved = brief.noiseSenders.filter((s) => s.senderId === null);
  if (brief.noiseSenders.length === 0 || unresolved.length === brief.noiseSenders.length) {
    throw new Error(
      `GET /api/briefs/today returned ${noiseGroups.length} Noise groups but resolved ` +
        `${brief.noiseSenders.length - unresolved.length} sender ids. The D65 read-time ` +
        `resolution is not joining senders for this mailbox — this is a product defect, ` +
        `not an empty environment.`,
    );
  }

  const actionable = brief.noiseSenders.filter((s) => s.senderId !== null && !s.isProtected);
  test.skip(
    actionable.length === 0,
    'every Noise sender in today’s Brief is Protected — no bulk archive is possible (D245)',
  );

  // ---- Probe the live inbox count for each actionable sender, then take
  // the SMALLEST that fits the window. Smallest-first (rather than
  // first-in-range) keeps the blast radius minimal by construction.
  //
  // The ceiling is 60, not a handful: a sender lands in Noise BECAUSE it
  // sends a lot, so "a Noise sender with 1-5 messages in the inbox" is
  // close to a contradiction. A window that no candidate can satisfy is a
  // permanently-skipped spec — green forever, verifying nothing — which is
  // the blind-guard failure this repo has a standing rule about. Measured
  // 2026-08-10 against the founder's mailbox: the fourteen actionable
  // Noise senders ranged 24..497, so a ceiling of 5 could never match.
  const MAX_INBOX_COUNT = 60;
  const PROBE_LIMIT = 30;

  const probed: { senderId: string; senderName: string; inboxCount: number }[] = [];
  const rejected: string[] = [];
  for (const candidate of actionable.slice(0, PROBE_LIMIT)) {
    const preview = await api.get<CompositePreview>(
      `/api/actions/preview?senderId=${candidate.senderId}`,
    );
    const group = noiseGroups.find((g) => g.senderKey === candidate.senderKey);
    if (!group) continue;
    if (preview.protected) {
      rejected.push(`${group.senderName}=protected`);
      continue;
    }
    // A duplicate display name would make the row locators ambiguous.
    if (noiseGroups.filter((g) => g.senderName === group.senderName).length !== 1) {
      rejected.push(`${group.senderName}=duplicate-name`);
      continue;
    }
    probed.push({
      senderId: candidate.senderId!,
      senderName: group.senderName,
      inboxCount: preview.counts.all,
    });
  }

  probed.sort((a, b) => a.inboxCount - b.inboxCount);
  const target = probed.find((c) => c.inboxCount >= 1 && c.inboxCount <= MAX_INBOX_COUNT) ?? null;

  // NOT a skip. The environment HAS actionable Noise senders; if none fits
  // the window then the window is wrong, and that must be visible.
  if (target === null) {
    const observed = probed.map((c) => `${c.senderName}=${c.inboxCount}`).join(', ') || '(none)';
    throw new Error(
      `No actionable Noise sender has between 1 and ${MAX_INBOX_COUNT} messages in the inbox, ` +
        `so the archive could not be exercised. Observed live counts: ${observed}. ` +
        `${rejected.length > 0 ? `Rejected candidates: ${rejected.join(', ')}. ` : ''}` +
        `This is a broken fixture assumption, not an empty environment — raise ` +
        `MAX_INBOX_COUNT (weighing the blast radius, since the archive is real) or ` +
        `investigate why every sender's inbox count is 0.`,
    );
  }
  const { senderId, senderName, inboxCount } = target;
  const senderKey = await senderKeyById(sql, mailboxId, senderId);

  // MUST precede the first navigation — see the helper for why.
  await declineNonEssentialCookies(page);
  await page.goto('/brief');

  // ---- D65: every actionable sender arrives CHECKED. Uncheck all but
  // the target so the mutation touches exactly one sender.
  const targetBox = page.getByRole('checkbox', {
    name: `Include ${senderName} in the archive`,
  });
  await expect(targetBox).toBeVisible({ timeout: 30_000 });
  await expect(targetBox).toBeChecked();

  // Only NOW is a zero-count meaningful. The banner renders nothing
  // until its post-mount effect reads storage, so asserting this right
  // after `goto` would pass vacuously against an unhydrated page —
  // the same starved-input failure that made the first version of this
  // spec skip forever. The visible checkbox above proves the client has
  // hydrated and the Brief has loaded, so an unanswered banner would be
  // on screen by here.
  await expect(page.getByTestId('cookie-consent-banner')).toHaveCount(0);

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
  // A NON-ZERO count, not the exact probed one: a genuinely new email
  // arriving between the probe above and this render would move the
  // figure and fail the run for no defect. Zero is the case worth
  // catching — it would mean the preview and the enqueue disagree, and
  // the sheet's own guard should already have disarmed confirm.
  //
  // `\s*` because the count is a `NumericDisplay`, so the number and the
  // words are separate elements and `toContainText` concatenates them
  // with no separator ("14emails currently match in Inbox"). A literal
  // space here matches the DOM the sheet had BEFORE it adopted the
  // shared numeric primitive, not the one it renders now.
  await expect(modal).toContainText(/[1-9][\d,]*\s*emails? currently match in Inbox/);
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
  // A NON-ZERO archived count. Without this a zero-op archive — enqueued,
  // completed, moved nothing — satisfies every other assertion here, and
  // the undo leg would then be reversing nothing.
  await expect(receipt).toContainText(/Archived [1-9][\d,]* emails? from/, { timeout: 90_000 });
  await expect(receipt).toContainText('1 sender');

  // ---- D69: the acted row is marked Done, and its frozen yesterday
  // count is still beside it — an archive today does not restate what
  // yesterday held.
  const archivedRow = noiseSection.getByRole('listitem').filter({ hasText: senderName });
  await expect(archivedRow).toContainText('Archived ✓');
  // `messages?` — the row pluralises, and the candidate search deliberately
  // prefers the SMALLEST sender, which is routinely a one-message row
  // ("1 message yesterday"). A hard plural fails on exactly the senders
  // this spec is most likely to pick.
  await expect(archivedRow).toContainText(/messages? yesterday/);

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
