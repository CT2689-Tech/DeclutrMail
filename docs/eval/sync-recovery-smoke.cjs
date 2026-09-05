/**
 * Isolated browser smoke for sync recovery. Run from the repository root:
 *   pnpm --filter @declutrmail/web dev --port 3109
 *   node docs/eval/sync-recovery-smoke.cjs
 *
 * Uses the real Next.js UI with synthetic API responses. No production
 * credentials, Gmail requests, or emails. Screenshots go to /tmp.
 */
const { createRequire } = require('node:module');
require('node:fs').mkdirSync('/tmp/declutrmail-sync-smoke', { recursive: true });
const requireE2e = createRequire(process.cwd() + '/packages/e2e/package.json');
const { chromium, expect } = requireE2e('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  for (const scenario of [
    'first-run-retry',
    'secondary-auto-recover',
    'permission-reconnect',
    'secondary-escape',
  ]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => failures.push(e.message));
    let healthy = false,
      requests = 0;
    const secondary = scenario !== 'first-run-retry';
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let status = 200,
        data = {};
      if (path === '/api/auth/me')
        data = {
          user: { id: 'smoke-user', email: 'smoke@example.test', workspaceId: 'smoke-workspace' },
          mailboxes: [
            {
              id: 'mb1',
              email: 'primary@example.test',
              status: 'active',
              readiness: secondary ? 'ready' : 'syncing',
            },
            ...(secondary
              ? [
                  {
                    id: 'mb2',
                    email: 'secondary@example.test',
                    status: 'active',
                    readiness: 'syncing',
                  },
                ]
              : []),
          ],
          activeMailboxId: 'mb1',
          tier: 'pro',
          cleanupRemaining: null,
        };
      else if (path === '/api/onboarding/state')
        data = { onboardedAt: null, skipped: false, goal: null, presetPicks: null, presets: [] };
      else if (path === '/api/v1/sync/status') {
        requests++;
        if (scenario === 'permission-reconnect')
          data = {
            readiness_status: 'failed',
            current_stage: 'failed',
            progress_pct: 5,
            is_ready_for_triage: false,
            error_code: 'InvalidGrantError',
          };
        else if (!healthy) status = 503;
        else
          data = {
            readiness_status: 'syncing',
            current_stage: 'fetching_metadata',
            progress_pct: 35,
            is_ready_for_triage: false,
          };
      }
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(
          status === 200 ? { data } : { error: { code: 'internal_error', message: 'unavailable' } },
        ),
      });
    });
    await page.goto('http://localhost:3109/onboarding' + (secondary ? '?mailbox=mb2' : ''));
    if (await page.getByRole('button', { name: 'Essential only' }).isVisible())
      await page.getByRole('button', { name: 'Essential only' }).click();
    if (scenario === 'permission-reconnect') {
      await expect(page.getByRole('button', { name: 'Reconnect Gmail' })).toBeVisible({
        timeout: 30000,
      });
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
      await expect(
        page.getByText(
          'Google is not granting the access needed to scan this inbox. Reconnect the account and allow Gmail access.',
        ),
      ).toBeVisible();
    } else {
      await expect(
        page.getByText("We couldn't check your inbox scan. Try checking again."),
      ).toBeVisible({ timeout: 30000 });
      await expect(page.getByRole('progressbar')).toHaveCount(0);
      await page.screenshot({ path: '/tmp/declutrmail-sync-smoke/' + scenario + '-error.png' });
      if (scenario === 'secondary-escape')
        await expect(
          page.getByRole('button', { name: 'Return to primary@example.test' }),
        ).toBeInViewport();
      healthy = true;
      if (scenario !== 'secondary-auto-recover')
        await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '35', {
        timeout: 16000,
      });
    }
    await page.screenshot({ path: '/tmp/declutrmail-sync-smoke/' + scenario + '.png' });
    console.log(JSON.stringify({ scenario, result: 'PASS', statusRequests: requests }));
    await context.close();
  }
  await browser.close();
  if (failures.length) throw new Error(JSON.stringify(failures));
  console.log('PASS: no browser page errors');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
