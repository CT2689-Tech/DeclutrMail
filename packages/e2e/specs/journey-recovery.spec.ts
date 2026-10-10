import { expect, test } from '@playwright/test';
import { dbConnect } from '../helpers/db';
import { applyJourneySeed } from '../helpers/seed-journeys';
import { BILLING_SEED } from '../helpers/seed-billing';
import { E2E_ENV } from '../helpers/env';

// Only fixed synthetic rows in the isolated database. No provider calls.
const fixture = BILLING_SEED;
const expiredRecoveryTitle =
  'expired account-recovery link opens returning sign-in with its full destination';
// Logout revokes its server session, so never inherit the suite’s shared session.
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }, testInfo) => {
  const sql = dbConnect();
  try {
    await applyJourneySeed(sql);
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
  await expect(
    page.getByRole('button', { name: 'Continue to checkout', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('$19 billed monthly, starting today. Renews automatically — cancel anytime.', {
      exact: true,
    }),
  ).toBeVisible();
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
  await page.context().clearCookies();
  await page.goto('/settings?cancelDeletion=1#account');
  await expect(page).toHaveURL(
    /\/sign-in\?returning=1&returnTo=%2Fsettings%3FcancelDeletion%3D1%23account$/,
  );
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Continue with Google', exact: true }),
  ).toHaveAttribute('href', /returnTo=%2Fsettings%3FcancelDeletion%3D1%23account$/);
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
