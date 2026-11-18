import { expect, test } from '@playwright/test';
import type postgres from 'postgres';

import { callTool, connectApp, signIn, startApp, type TestApp } from '../helpers/connector';
import { dbConnect } from '../helpers/db';
import { E2E_ENV } from '../helpers/env';
import { BILLING_SEED } from '../helpers/seed-billing';
import { applyJourneySeed } from '../helpers/seed-journeys';

/**
 * Confirming what an assistant prepared (ADR-0048 rule 1,
 * docs/spec/mcp-connector.md §3) — the real API, the real `/mcp`
 * endpoint, the real confirm page and a real browser. The "assistant"
 * is this test, holding a token it got through the real consent page.
 * No Google, no Gmail, no worker: a confirmed Archive stays queued.
 *
 * Journeys:
 *   1. The assistant previews an Archive → it cannot apply it → the
 *      signed-out person opens the link, signs in and is brought back →
 *      another person sees nothing → the person presses Archive → one
 *      queued action → the assistant is told it was applied.
 *   2. A request nobody confirmed in time says it expired and has
 *      nothing to press.
 *   3. A request for more senders than the page lists up front: the
 *      person can open the whole list and find every one before Keep.
 */

const SENDER = {
  id: 'e2ec2222-0000-4000-8000-00000000000a',
  key: 'c0f1'.repeat(16),
  name: 'Parcel Post Weekly',
} as const;

/** Six senders, one more than the confirm page lists before it is asked for the rest. */
const MANY = Array.from({ length: 6 }, (_, index) => ({
  id: `e2ec2222-0000-4000-8000-0000000000b${index + 1}`,
  key: `c0f${index + 2}`.repeat(16),
  name: `Aster Mail ${index + 1}`,
  email: `news@aster${index + 1}.example`,
}));

/** A second person in the same database, with no Gmail account of their own. */
const OTHER = {
  workspaceId: 'e2ec2222-0000-4000-8000-000000000001',
  userId: 'e2ec2222-0000-4000-8000-000000000002',
  email: 'chintan.e2e.confirm-other@synthetic.test',
} as const;

let sql: postgres.Sql;
let app: TestApp;

async function removeConnections() {
  // Cascades to the previews each connection asked for.
  await sql`DELETE FROM oauth_grants WHERE user_id IN (${BILLING_SEED.userId}, ${OTHER.userId})`;
}

async function removeQueuedWork() {
  await sql`
    DELETE FROM action_jobs
    WHERE mailbox_account_id = ${BILLING_SEED.mailboxId}
      AND selector->>'senderId' = ${SENDER.id}
  `;
}

const jobsForSender = async () =>
  (
    await sql<Array<{ verb: string; status: string; reach: string }>>`
      SELECT verb, status, reach FROM action_jobs
      WHERE mailbox_account_id = ${BILLING_SEED.mailboxId}
        AND selector->>'senderId' = ${SENDER.id}
    `
  ).map((row) => ({ ...row }));

// Every journey starts signed out: the link is opened from another app.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeAll(async () => {
  const metadata = await fetch(`${E2E_ENV.apiUrl}/.well-known/oauth-authorization-server`);
  // The isolated stack switches the connector on; a 404 here is a broken stack.
  expect(metadata.status, 'MCP_ENABLED must be on in the isolated stack').toBe(200);

  sql = dbConnect();
  await applyJourneySeed(sql);
  await sql`
    INSERT INTO senders (id, mailbox_account_id, sender_key, display_name, email, domain,
                         gmail_category, total_received, first_seen_at, last_seen_at)
    VALUES (${SENDER.id}, ${BILLING_SEED.mailboxId}, ${SENDER.key}, ${SENDER.name},
            'news@parcelpost.example', 'parcelpost.example', 'promotions', 2,
            now() - interval '40 days', now())
    ON CONFLICT (mailbox_account_id, sender_key) DO NOTHING
  `;
  await sql`
    INSERT INTO mail_messages (mailbox_account_id, provider_message_id, provider_thread_id,
                               sender_key, subject, internal_date, is_unread, label_ids)
    VALUES
      (${BILLING_SEED.mailboxId}, 'e2e-confirm-m1', 'e2e-confirm-t1', ${SENDER.key},
       'Your weekly parcel round-up', now() - interval '2 days', true, ARRAY['INBOX']),
      (${BILLING_SEED.mailboxId}, 'e2e-confirm-m2', 'e2e-confirm-t2', ${SENDER.key},
       'Tracking tips for the season', now() - interval '1 day', true, ARRAY['INBOX'])
    ON CONFLICT (mailbox_account_id, provider_message_id) DO NOTHING
  `;
  for (const sender of MANY) {
    await sql`
      INSERT INTO senders (id, mailbox_account_id, sender_key, display_name, email, domain,
                           gmail_category, total_received, first_seen_at, last_seen_at)
      VALUES (${sender.id}, ${BILLING_SEED.mailboxId}, ${sender.key}, ${sender.name},
              ${sender.email}, ${sender.email.split('@')[1]!}, 'promotions', 1,
              now() - interval '40 days', now())
      ON CONFLICT (mailbox_account_id, sender_key) DO NOTHING
    `;
  }
  await sql`
    INSERT INTO workspaces (id, name, tier)
    VALUES (${OTHER.workspaceId}, 'E2E Confirm other (synthetic)', 'free')
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO users (id, workspace_id, email, onboarded_at)
    VALUES (${OTHER.userId}, ${OTHER.workspaceId}, ${OTHER.email}, now())
    ON CONFLICT (id) DO NOTHING
  `;
  await removeConnections();
  await removeQueuedWork();
  app = await startApp('Journey Assistant');
});

test.afterAll(async () => {
  await app?.close();
  if (!sql) return;
  await removeConnections();
  await removeQueuedWork();
  await sql`
    DELETE FROM mail_messages
    WHERE mailbox_account_id = ${BILLING_SEED.mailboxId}
      AND provider_message_id IN ('e2e-confirm-m1', 'e2e-confirm-m2')
  `;
  const manyKeys = MANY.map((sender) => sender.key);
  // Keep writes a decision row and, through the outbox, a policy row.
  await sql`
    DELETE FROM activity_log
    WHERE mailbox_account_id = ${BILLING_SEED.mailboxId} AND sender_key IN ${sql(manyKeys)}
  `;
  await sql`
    DELETE FROM sender_policies
    WHERE mailbox_account_id = ${BILLING_SEED.mailboxId} AND sender_key IN ${sql(manyKeys)}
  `;
  await sql`
    DELETE FROM senders
    WHERE id IN ${sql([SENDER.id, ...MANY.map((sender) => sender.id)])}
  `;
  await sql`DELETE FROM workspaces WHERE id = ${OTHER.workspaceId}`;
  await sql.end();
});

test('an assistant prepares an Archive, only the person can confirm it, and it is applied once', async ({
  page,
  browser,
}) => {
  // The assistant gets its token the way any app does: the person approves it.
  await signIn(page);
  const token = await connectApp(page, app, 'confirm-journey');

  // 1. The assistant asks. Nothing is queued.
  const preview = await callTool(token, 'preview_cleanup', {
    verb: 'archive',
    sender_ids: [SENDER.id],
  });
  expect(preview.isError, preview.text).toBe(false);
  expect(preview.data).toMatchObject({
    mailbox: BILLING_SEED.email,
    status: 'needs_confirmation',
    verb: 'archive',
    sender_count: 1,
    email_count: 2,
  });
  const previewId = preview.data.preview_id as string;
  const confirmUrl = `${E2E_ENV.webUrl}/confirm/${previewId}`;
  expect(preview.data.confirm_url).toBe(confirmUrl);

  // 2. The assistant cannot apply what nobody confirmed, however often it asks.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const early = await callTool(token, 'apply_cleanup', { preview_id: previewId });
    expect(early.data).toMatchObject({ status: 'needs_confirmation', action_id: null });
  }
  expect(await jobsForSender()).toEqual([]);

  // 3. The link is opened signed out → sign-in, carrying the way back.
  await page.context().clearCookies();
  await page.goto(confirmUrl);
  await page.waitForURL(/\/sign-in\?/);
  const returnTo = new URL(page.url()).searchParams.get('returnTo');
  expect(returnTo).toBe(`/confirm/${previewId}`);

  // 4. Another signed-in person sees nothing to confirm.
  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const theirs = await stranger.newPage();
    await signIn(theirs, OTHER.email);
    await theirs.goto(confirmUrl);
    // Scoped to the page's own content: Next adds an alert-role route announcer.
    const main = theirs.getByRole('main');
    await expect(main.getByRole('alert')).toContainText('This request is not available');
    await expect(main.getByRole('button')).toHaveCount(0);
    await expect(main).not.toContainText(SENDER.name);
  } finally {
    await stranger.close();
  }
  expect(await jobsForSender()).toEqual([]);

  // 5. Signed in → back on the same request, which says what it will do.
  await signIn(page);
  await page.goto(`${E2E_ENV.webUrl}${returnTo}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Archive 1 sender?');
  await expect(main).toContainText(`Journey Assistant asked for this in ${BILLING_SEED.email}.`);
  await expect(main.getByRole('listitem')).toHaveText([
    SENDER.name,
    '2 emails in your inbox',
    'Moves out of your inbox, stays in Gmail.',
    'Undo from Activity for 30 days.',
  ]);
  await expect(main.getByRole('link', { name: 'Not now' })).toHaveAttribute('href', '/home');

  // It fits a phone.
  await page.setViewportSize({ width: 320, height: 568 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  // 6. The person presses the verb.
  await main.getByRole('button', { name: 'Archive' }).click();
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Confirmed');
  await expect(main.getByRole('status')).toHaveText(
    'Archive started for 1 sender. It covers 2 emails.',
  );
  await expect(main.getByRole('link', { name: 'Open Activity' })).toHaveAttribute(
    'href',
    '/activity',
  );
  await expect(main.getByRole('button')).toHaveCount(0);

  // 7. One queued Archive, inbox only — and the assistant is told so.
  expect(await jobsForSender()).toEqual([
    { verb: 'archive', status: 'queued', reach: 'inbox_only' },
  ]);
  const applied = await callTool(token, 'apply_cleanup', { preview_id: previewId });
  expect(applied.data).toMatchObject({
    status: 'applied',
    confirm_url: null,
    applied_senders: 1,
    requested_emails: 2,
    skipped: [],
  });
  expect(applied.data.action_id).toEqual(expect.any(String));

  // 8. Opening the link again shows the receipt; there is nothing left to press.
  await page.reload();
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Confirmed');
  await expect(main.getByRole('button')).toHaveCount(0);
  expect(await jobsForSender()).toHaveLength(1);
});

test('a request nobody confirmed in time says it expired and has nothing to press', async ({
  page,
}) => {
  await signIn(page);
  await removeQueuedWork();
  const token = await connectApp(page, app, 'expired-journey');
  const preview = await callTool(token, 'preview_cleanup', {
    verb: 'delete',
    sender_ids: [SENDER.id],
  });
  expect(preview.isError, preview.text).toBe(false);
  const previewId = preview.data.preview_id as string;
  // The 15 minutes, passed.
  await sql`
    UPDATE action_previews
    SET created_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes'
    WHERE id = ${previewId}
  `;

  await page.goto(`${E2E_ENV.webUrl}/confirm/${previewId}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('alert')).toContainText('This request expired');
  await expect(main.getByRole('alert')).toContainText('Ask your assistant to prepare it again.');
  await expect(main.getByRole('button')).toHaveCount(0);

  const late = await callTool(token, 'apply_cleanup', { preview_id: previewId });
  expect(late.error.code).toBe('PREVIEW_EXPIRED');
  expect(await jobsForSender()).toEqual([]);
});

test('a request for six senders lists five and opens the rest before Keep', async ({ page }) => {
  await signIn(page);
  const token = await connectApp(page, app, 'many-journey');
  // Asked for in reverse: the page orders the names itself.
  const preview = await callTool(token, 'preview_cleanup', {
    verb: 'keep',
    sender_ids: MANY.map((sender) => sender.id).reverse(),
  });
  expect(preview.isError, preview.text).toBe(false);
  expect(preview.data).toMatchObject({ sender_count: 6, email_count: 0 });

  await page.goto(`${E2E_ENV.webUrl}/confirm/${preview.data.preview_id as string}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Keep 6 senders?');
  // Keep moves no email: no count is printed.
  await expect(main).not.toContainText('in your inbox');
  // The full list is in the page but closed: what can be SEEN is five names.
  const seen = (name: string) => main.getByText(name, { exact: true }).filter({ visible: true });
  for (const sender of MANY.slice(0, 5)) await expect(seen(sender.name)).toHaveCount(1);
  await expect(seen(MANY[5]!.name)).toHaveCount(0);

  // Opened from the keyboard: the whole list, each sender once.
  const summary = main.locator('summary', { hasText: 'Show all 6 senders' });
  await summary.focus();
  await page.keyboard.press('Enter');
  const all = main.getByRole('region', { name: 'All senders' });
  await expect(all.getByRole('listitem')).toHaveText(MANY.map((sender) => sender.name));
  for (const sender of MANY) await expect(seen(sender.name)).toHaveCount(1);
  await all.focus();
  await expect(all).toBeFocused();

  await main.getByRole('button', { name: 'Keep' }).click();
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Confirmed');
  await expect(main.getByRole('status')).toHaveText('Keep recorded for 6 senders.');
  const decisions = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM activity_log
    WHERE mailbox_account_id = ${BILLING_SEED.mailboxId}
      AND action = 'keep' AND sender_key IN ${sql(MANY.map((sender) => sender.key))}
  `;
  expect(decisions[0]!.n).toBe(6);
});
