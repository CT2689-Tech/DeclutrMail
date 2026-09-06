/**
 * Real Next.js UI smoke with synthetic HTTP responses; no Gmail or DB writes.
 * SMOKE_WEB_URL=http://localhost:3117 node docs/eval/initial-sync-flow-smoke.cjs
 * Covers first-scan retry, throttling, reconnect targeting, and early exit.
 * Destination pages and Google OAuth are outside this harness's scope.
 */
const { createRequire } = require('node:module');
const { mkdirSync } = require('node:fs');
const requireE2e = createRequire(process.cwd() + '/packages/e2e/package.json');
const { chromium, expect } = requireE2e('@playwright/test');
const base = process.env.SMOKE_WEB_URL || 'http://localhost:3117';
const output = '/tmp/declutrmail-initial-sync-smoke';
mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1280]) {
      for (const scenario of ['retry', 'rate-limit', 'reconnect', 'early-exit', 'switch-error']) {
        const context = await browser.newContext({ viewport: { width, height: 844 } });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(15000);
          page.setDefaultNavigationTimeout(30000);
          const errors = [];
          page.on('pageerror', (err) => errors.push(err.message));
          const secondary = scenario === 'early-exit' || scenario === 'switch-error';
          const target = secondary ? 'mb2' : 'mb1';
          let retryCount = 0;
          let ready = false;
          const retryHeaders = [];
          await page.route('**/api/**', async (route) => {
            const req = route.request();
            const path = new URL(req.url()).pathname;
            let status = 200;
            let data = {};
            if (path === '/api/auth/me') {
              data = {
                user: {
                  id: 'smoke-user',
                  email: 'smoke@example.test',
                  workspaceId: 'smoke-workspace',
                  timezone: 'America/Los_Angeles',
                },
                mailboxes: [
                  {
                    id: 'mb1',
                    email: 'primary@example.test',
                    status: 'active',
                    connectedAt: null,
                    readiness: secondary
                      ? 'ready'
                      : ready
                        ? 'ready'
                        : retryCount
                          ? 'syncing'
                          : 'failed',
                  },
                  ...(secondary
                    ? [
                        {
                          id: 'mb2',
                          email: 'secondary@example.test',
                          status: 'active',
                          connectedAt: null,
                          readiness: 'syncing',
                        },
                      ]
                    : []),
                ],
                activeMailboxId: 'mb1',
                tier: 'free',
                cleanupRemaining: 5,
              };
            } else if (path === '/api/onboarding/state') {
              data = {
                onboardedAt: null,
                skipped: false,
                goal: null,
                presetPicks: null,
                presets: [],
              };
            } else if (path === '/api/v1/sync/status') {
              const running = secondary || (retryCount > 0 && scenario !== 'rate-limit');
              data = {
                readiness_status: ready ? 'ready' : running ? 'syncing' : 'failed',
                current_stage: ready ? 'ready' : running ? 'fetching_metadata' : 'failed',
                progress_pct: ready ? 100 : running ? 35 : 5,
                is_ready_for_triage: ready,
                ...(!running && !ready
                  ? { error_code: scenario === 'reconnect' ? 'InvalidGrantError' : 'Error' }
                  : {}),
              };
            } else if (path === '/api/v1/sync/initial/retry') {
              retryCount++;
              retryHeaders.push(req.headers()['x-active-mailbox-id']);
              status = scenario === 'rate-limit' ? 429 : 200;
              data = { outcome: 'requeued' };
            } else if (path === '/api/mailboxes/mb1/active') {
              status = scenario === 'switch-error' ? 503 : 200;
              data = { activeMailboxId: 'mb1' };
            } else if (path === '/api/auth/google/connect-mailbox/start') {
              await route.fulfill({
                contentType: 'text/html',
                body: '<h1>OAuth handoff captured</h1>',
              });
              return;
            }
            await route.fulfill({
              status,
              contentType: 'application/json',
              body: JSON.stringify(
                status < 400
                  ? { data }
                  : {
                      error: {
                        code: status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR',
                        message: 'Synthetic failure',
                      },
                    },
              ),
            });
          });
          await page.goto(base + '/onboarding' + (secondary ? '?mailbox=mb2&reconnect=1' : ''));
          const consent = page.getByRole('button', { name: 'Essential only', exact: true });
          await expect(consent).toBeVisible();
          await consent.click();
          if (scenario === 'retry' || scenario === 'rate-limit') {
            const retry = page.getByRole('button', { name: 'Try again', exact: true });
            await expect(retry).toBeVisible();
            await retry.click();
            if (scenario === 'rate-limit') {
              await expect(
                page.getByText(
                  "Couldn't start the scan. Wait a minute and try again — nothing in Gmail changed.",
                ),
              ).toBeVisible();
              await expect(retry).toBeEnabled();
              await expect(page.getByRole('progressbar')).toHaveCount(0);
            } else {
              await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '35');
              await page.screenshot({ path: `${output}/${width}-retry-progress.png` });
              ready = true;
              await expect(
                page.getByRole('heading', { name: 'Choose your starting point.' }),
              ).toBeVisible({ timeout: 15000 });
            }
            expect(retryHeaders).toEqual([target]);
          } else if (scenario === 'reconnect') {
            await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(
              0,
            );
            await page.getByRole('button', { name: 'Reconnect Gmail', exact: true }).click();
            await page.waitForURL(
              '**/api/auth/google/connect-mailbox/start?reconnectMailboxId=mb1',
            );
            expect(retryCount).toBe(0);
          } else if (scenario === 'switch-error') {
            await page.getByRole('button', { name: 'Go back to primary@example.test' }).click();
            await expect(
              page.getByText("Couldn't switch accounts. Please try again."),
            ).toBeVisible();
            expect(new URL(page.url()).pathname).toBe('/onboarding');
            await expect(
              page.getByRole('button', { name: 'Go back to primary@example.test' }),
            ).toBeEnabled();
          } else {
            // Assert the destination requested by the actual button. The
            // settings page itself is deliberately not simulated here.
            const destination = page.waitForRequest(
              (req) => new URL(req.url()).pathname === '/settings',
            );
            await page.getByRole('button', { name: 'Go back to primary@example.test' }).click();
            await page.screenshot({ path: `${output}/${width}-early-exit-click.png` });
            const request = await destination;
            expect(new URL(request.url()).searchParams.has('reconnect_result')).toBe(false);
          }
          expect(errors).toEqual([]);
          if (scenario !== 'early-exit')
            await page.screenshot({ path: `${output}/${width}-${scenario}.png` });
          console.log(JSON.stringify({ width, scenario, result: 'PASS', retryCount }));
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
