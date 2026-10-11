import { expect, test } from '@playwright/test';
import { dbConnect } from '../helpers/db';
import { applyJourneySeed } from '../helpers/seed-journeys';
import { BILLING_SEED } from '../helpers/seed-billing';
import { E2E_ENV } from '../helpers/env';

// Only fixed synthetic rows in the isolated database. No provider calls.
const fixture = BILLING_SEED;
const expiredRecoveryTitle =
  'expired account-recovery link opens returning sign-in with its full destination';
const homeVisitTitle = 'returning Home freezes its per-inbox counts across navigation and reload';
// Logout revokes its server session, so never inherit the suite’s shared session.
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }, testInfo) => {
  const sql = dbConnect();
  try {
    await applyJourneySeed(sql);
    if (testInfo.title === homeVisitTitle) {
      // Seed before sign-in: entry tracking must never race a fixture rewrite.
      const history = JSON.stringify({
        [fixture.mailboxId]: [
          {
            visitId: '10000000-0000-4000-8000-000000000001',
            since: null,
            until: new Date(Date.now() - 86_400_000).toISOString(),
            indexedEmails: null,
            indexedSenders: null,
          },
        ],
      });
      // postgres.js encodes a string parameter inferred as jsonb again. Bind
      // this serialized fixture as text so the stored value is an object.
      await sql`UPDATE users SET preferences = jsonb_set(preferences, '{mailboxVisits}', ${history}::text::jsonb) WHERE id = ${fixture.userId}`;
      const [stored] =
        await sql`SELECT jsonb_typeof(preferences->'mailboxVisits') AS kind FROM users WHERE id = ${fixture.userId}`;
      expect(stored?.kind).toBe('object');
      await sql`UPDATE mail_messages SET created_at = now() - interval '1 minute' WHERE mailbox_account_id = ${fixture.mailboxId}`;
      await sql`UPDATE senders SET first_indexed_at = now() - interval '1 minute' WHERE mailbox_account_id = ${fixture.mailboxId}`;
    }
  } finally {
    await sql.end();
  }
  // This anonymous journey starts on a blank page. Signing in and immediately
  // removing its cookies races the previous page's 401 redirect with the link under test.
  if (testInfo.title === expiredRecoveryTitle) return;
  await page.goto(
    `${E2E_ENV.apiUrl}/api/auth/dev/login?${new URLSearchParams({ email: fixture.email })}`,
  );
  await expect(page).toHaveURL(`${E2E_ENV.webUrl}/home`);
});
test.afterEach(async () => {
  const sql = dbConnect();
  try {
    await applyJourneySeed(sql);
  } finally {
    await sql.end();
  }
});

test('Free Brief upgrade retains its origin and opens the selected plan without buying', async ({
  page,
}) => {
  const sql = dbConnect();
  try {
    await sql`UPDATE workspaces SET tier = 'free' WHERE id = ${fixture.workspaceId}`;
  } finally {
    await sql.end();
  }
  await page.goto('/brief');
  const upgrade = page.getByRole('link', { name: 'Upgrade to Pro $19/mo', exact: true });
  await expect(upgrade).toHaveAttribute('href', '/billing?plan=pro&cycle=monthly&from=%2Fbrief');
  await upgrade.click({ noWaitAfter: true });
  await expect(page).toHaveURL(/\/billing\?plan=pro&cycle=monthly&from=%2Fbrief$/);
  if (process.env.PRICING_V2 === 'true') {
    await expect(
      page.getByRole('button', { name: 'Join the Pro waitlist', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Continue to checkout', exact: true }),
    ).toHaveCount(0);
  } else {
    await expect(
      page.getByRole('button', { name: 'Continue to checkout', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('$19 billed monthly, starting today. Renews automatically — cancel anytime.', {
        exact: true,
      }),
    ).toBeVisible();
  }
});

test('failed first scan exposes account controls while mailbox routes stay gated, then finish opens backlog', async ({
  page,
}) => {
  const sql = dbConnect();
  try {
    await sql`UPDATE users SET onboarded_at = NULL WHERE id = ${fixture.userId}`;
    await sql`UPDATE workspaces SET tier = 'free' WHERE id = ${fixture.workspaceId}`;
    await sql`UPDATE provider_sync_state SET readiness_status = 'failed', error_code = 'TransientError' WHERE mailbox_account_id = ${fixture.mailboxId}`;
    await page.goto('/onboarding');
    const recovery = page.getByRole('navigation', { name: 'Account and scan help' });
    await expect(recovery.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    await recovery
      .getByRole('link', { name: 'Get help', exact: true })
      .click({ noWaitAfter: true });
    await expect(page).toHaveURL(/\/settings\/help$/);
    await expect(page.getByRole('heading', { name: 'Help & glossary', exact: true })).toBeVisible();
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await page.goto('/senders');
    await expect(page).toHaveURL(/\/onboarding\?returnTo=%2Fsenders$/);
    await expect(page.getByRole('navigation', { name: 'Account and scan help' })).toBeVisible();
    await sql`UPDATE provider_sync_state SET readiness_status = 'ready', error_code = NULL WHERE mailbox_account_id = ${fixture.mailboxId}`;
    await page.reload();
    await page
      .getByRole('button', { name: 'Skip setup for now', exact: true })
      .click({ noWaitAfter: true });
    await expect(page).toHaveURL(/\/senders$/);
    await expect(page.getByRole('heading', { name: 'Senders', exact: true })).toBeVisible();
    const [user] = await sql`SELECT onboarded_at FROM users WHERE id = ${fixture.userId}`;
    expect(user).toBeDefined();
    expect(user!.onboarded_at).toBeTruthy();
  } finally {
    await sql.end();
  }
});

test(expiredRecoveryTitle, async ({ page }) => {
  // A signed-in page left open here fires its own 401 redirect (returnTo=/home)
  // that races this link, so require the untouched page instead of clearing cookies.
  expect(page.url()).toBe('about:blank');
  expect(await page.context().cookies()).toEqual([]);
  await page.goto('/settings?cancelDeletion=1#account');
  await expect(page).toHaveURL(
    /\/sign-in\?returning=1&returnTo=%2Fsettings%3FcancelDeletion%3D1%23account$/,
  );
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Continue with Google', exact: true }),
  ).toHaveAttribute('href', /returnTo=%2Fsettings%3FcancelDeletion%3D1%23account&intent=sign-in$/);
  await expect(page.getByRole('list', { name: 'After you connect' })).toHaveCount(0);
});

test('intentional sign-out keeps its confirmation instead of a stale-session redirect', async ({
  page,
}) => {
  await page.goto('/senders');
  await page.getByRole('button', { name: fixture.email, exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click({ noWaitAfter: true });
  await expect(page).toHaveURL(/\/sign-in\?signed_out=1$/);
  await expect(
    page.getByRole('heading', { name: 'You’re signed out.', exact: true }),
  ).toBeVisible();
});

test(homeVisitTitle, async ({ page }) => {
  const sql = dbConnect();
  try {
    const summary = page.getByRole('region', { name: 'Since your previous visit' });
    await expect(summary.getByRole('heading', { name: '3 emails newly indexed' })).toBeVisible();
    await expect(
      summary.getByText('2 senders added to this inbox’s index.', { exact: true }),
    ).toBeVisible();
    await sql`UPDATE mail_messages SET created_at = now() + interval '1 day' WHERE mailbox_account_id = ${fixture.mailboxId}`;
    await page.goto('/senders');
    await page.goto('/home');
    await page.reload();
    await expect(summary.getByRole('heading', { name: '3 emails newly indexed' })).toBeVisible();
  } finally {
    await sql`UPDATE mail_messages SET created_at = now() WHERE mailbox_account_id = ${fixture.mailboxId}`;
    await sql`UPDATE users SET preferences = preferences - 'mailboxVisits' WHERE id = ${fixture.userId}`;
    await sql.end();
  }
});

test('emailed owned inbox target switches scope before showing its Senders, while unknown targets recover', async ({
  page,
}) => {
  const sql = dbConnect();
  const second = 'e2eb1111-0000-4000-8000-000000000099';
  try {
    await sql`INSERT INTO mailbox_accounts (id, workspace_id, user_id, provider, provider_account_id, status) VALUES (${second}, ${fixture.workspaceId}, ${fixture.userId}, 'gmail', 'chintan.e2e.second@synthetic.test', 'active')`;
    await sql`INSERT INTO provider_sync_state (mailbox_account_id, readiness_status, current_stage, progress_pct) VALUES (${second}, 'ready', 'ready', 100)`;
    await page.goto(`/senders?mailbox=${second}`);
    await expect(page).toHaveURL(/\/senders$/);
    await expect(
      page.getByRole('button', { name: 'chintan.e2e.second@synthetic.test', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Senders', exact: true })).toBeVisible();
    await expect(page.getByText(fixture.archiveSenderName, { exact: true })).toHaveCount(0);
    await page.goto(`/senders?mailbox=${fixture.mailboxId}`);
    await expect(page.getByRole('button', { name: fixture.email, exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/senders$/);
    await page.goto('/senders?mailbox=00000000-0000-4000-8000-000000000099');
    await expect(page.getByText('This inbox link is unavailable', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Senders', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Continue with my current inbox' }).click();
    await expect(page).toHaveURL(/\/senders$/);
    await expect(page.getByRole('button', { name: fixture.email, exact: true })).toBeVisible();
  } finally {
    await sql`DELETE FROM mailbox_accounts WHERE id = ${second} AND user_id = ${fixture.userId}`;
    await sql`UPDATE users SET preferences = preferences - 'mailboxVisits' WHERE id = ${fixture.userId}`;
    await sql.end();
  }
});

test('failed scan preview is read-only and the first backlog nudge excludes Protected senders', async ({
  page,
}) => {
  const sql = dbConnect();
  try {
    await sql`UPDATE users SET onboarded_at = NULL WHERE id = ${fixture.userId}`;
    await sql`UPDATE provider_sync_state SET readiness_status = 'failed', current_stage = 'failed', error_code = 'TransientError' WHERE mailbox_account_id = ${fixture.mailboxId}`;
    await page.goto('/onboarding');
    await page.getByRole('button', { name: 'Preview indexed senders', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Scan preview' }).getByText(/Fresh Finds Weekly/),
    ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Scan preview' })
        .getByRole('button', { name: /Archive|Delete|Unsubscribe/ }),
    ).toHaveCount(0);
    await sql`UPDATE users SET onboarded_at = now() WHERE id = ${fixture.userId}`;
    await sql`UPDATE provider_sync_state SET readiness_status = 'ready', current_stage = 'ready', error_code = NULL WHERE mailbox_account_id = ${fixture.mailboxId}`;
    await sql`DELETE FROM action_jobs WHERE mailbox_account_id = ${fixture.mailboxId}`;
    await page.goto('/senders');
    const nudge = page.getByRole('region', { name: 'Finish first cleanup' });
    await expect(nudge.getByText(/Fresh Finds Weekly/)).toBeVisible();
    await expect(nudge.getByText(/2 emails/)).toBeVisible();
    await expect(nudge.getByText(fixture.screenerSenderName, { exact: false })).toHaveCount(0);
  } finally {
    await sql.end();
  }
});

test('Home retries the displayed inbox and truthfully reports queued recovery', async ({
  page,
}) => {
  const sql = dbConnect();
  try {
    await sql`UPDATE provider_sync_state SET readiness_status='failed', current_stage='failed', error_code='TransientError', initial_recovery_attempts=5, initial_retry_at=NULL, initial_attempt_id=NULL, last_history_id=987654321 WHERE mailbox_account_id=${fixture.mailboxId}`;
    await page.reload();
    const recovery = page.getByRole('region', { name: 'Mailbox needs attention' });
    const response = page.waitForResponse(
      (res) =>
        res.url().endsWith('/api/v1/sync/initial/retry') && res.request().method() === 'POST',
    );
    await recovery.getByRole('button', { name: 'Scan again', exact: true }).press('Enter');
    const result = await response;
    expect(result.ok()).toBe(true);
    expect(result.request().headers()['x-active-mailbox-id']).toBe(fixture.mailboxId);
    await expect(page.getByText('Your scan is queued.', { exact: true })).toBeVisible();
    const [state] =
      await sql`SELECT readiness_status, last_history_id::text AS cursor FROM provider_sync_state WHERE mailbox_account_id=${fixture.mailboxId}`;
    expect(state).toMatchObject({ readiness_status: 'queued', cursor: '987654321' });
    const [count] =
      await sql`SELECT count(*)::int AS n FROM mail_messages WHERE mailbox_account_id=${fixture.mailboxId}`;
    expect(count?.n).toBe(3);
  } finally {
    await sql`UPDATE provider_sync_state SET last_history_id=NULL WHERE mailbox_account_id=${fixture.mailboxId}`;
    await sql.end();
  }
});
