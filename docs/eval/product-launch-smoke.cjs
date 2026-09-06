/**
 * Read-only product route smoke against an isolated, seeded local API.
 * Requires seed-billing.ts applied to a disposable DB and dev auth enabled.
 * Never runs against a remote origin. No Gmail mutation is performed.
 * SMOKE_WEB_URL=http://127.0.0.1:3117 SMOKE_API_URL=http://127.0.0.1:4199 node docs/eval/product-launch-smoke.cjs
 */
const { createRequire } = require('node:module');
const { mkdirSync, writeFileSync } = require('node:fs');
const req = createRequire(process.cwd() + '/packages/e2e/package.json');
const { chromium, request, expect } = req('@playwright/test');
const web = process.env.SMOKE_WEB_URL || 'http://127.0.0.1:3117';
const api = process.env.SMOKE_API_URL || 'http://127.0.0.1:4199';
for (const url of [web, api]) {
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname))
    throw new Error('Local smoke only');
}
const output = '/tmp/declutr-product-smoke';
mkdirSync(output, { recursive: true });
const routes = [
  '/senders',
  '/triage',
  '/screener',
  '/autopilot',
  '/quiet',
  '/brief',
  '/followups',
  '/later',
  '/activity',
  '/billing',
  '/settings',
  '/settings/privacy',
  '/settings/help',
  '/settings/senders',
  '/senders/e2eb1111-0000-4000-8000-00000000000a',
];
(async () => {
  const auth = await request.newContext();
  const login = await auth.get(
    api + '/api/auth/dev/login?email=chintan.e2e.billing%40synthetic.test',
    { maxRedirects: 0 },
  );
  expect(login.status()).toBe(302);
  const state = await auth.storageState();
  await auth.dispose();
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({
        storageState: state,
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.setDefaultNavigationTimeout(60000);
      let errors = [],
        failedReads = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('response', async (r) => {
        if (r.url().startsWith(api) && r.status() >= 500) {
          const body = await r.json().catch(() => ({}));
          failedReads.push({
            path: new URL(r.url()).pathname,
            status: r.status(),
            code: body.error?.code,
          });
        }
      });
      for (const path of routes) {
        errors = [];
        failedReads = [];
        try {
          const res = await page.goto(web + path);
          expect(res.status()).toBe(200);
          await expect(page.getByTestId('auth-skeleton')).toHaveCount(0);
          await expect(page.locator('main').first()).toBeVisible();
          await page.waitForLoadState('networkidle');
          const consent = page.getByRole('button', { name: 'Essential only', exact: true });
          if (await consent.isVisible()) await consent.click();
          expect(new URL(page.url()).pathname).toBe(path);
          expect(errors).toEqual([]);
          expect(await page.locator('[data-nextjs-dialog]').count()).toBe(0);
          const text = await page.locator('body').innerText();
          expect(text).not.toMatch(/Something went wrong|Application error|Auth check failed/);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          expect(overflow).toBeLessThanOrEqual(1);
          await page.screenshot({ path: `${output}/${width}-${path.replaceAll('/', '_')}.png` });
          // Billing is deliberately disabled in this isolated stack. A
          // bounded BILLING_DISABLED response is expected; a retry storm is not.
          const expectedDisabled =
            failedReads.length <= 5 && failedReads.every((r) => r.code === 'BILLING_DISABLED');
          const row = {
            width,
            path,
            result: failedReads.length && !expectedDisabled ? 'CHECK' : 'PASS',
            failedReadCount: failedReads.length,
            failedReads: failedReads.slice(0, 10),
          };
          results.push(row);
          console.log(JSON.stringify(row));
        } catch (e) {
          const row = {
            width,
            path,
            result: 'FAIL',
            error: e.message.slice(0, 1800),
            failedReadCount: failedReads.length,
            failedReads: failedReads.slice(0, 10),
          };
          results.push(row);
          console.log(JSON.stringify(row));
          await page
            .screenshot({ path: `${output}/${width}-${path.replaceAll('/', '_')}-failure.png` })
            .catch(() => {});
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
    writeFileSync(output + '/results.json', JSON.stringify(results, null, 2));
  }
  if (results.some((r) => r.result !== 'PASS')) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
