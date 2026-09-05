/**
 * Local-only consent smoke with the real SDK and delayed dynamic import.
 * Start this checkout with:
 * NEXT_PUBLIC_POSTHOG_KEY=phc_local_smoke_only NEXT_PUBLIC_POSTHOG_HOST=http://localhost:3198 pnpm --filter @declutrmail/web dev --port 3109
 * Then: node docs/eval/consent-browser-smoke.cjs
 * Intercepts all fake-host traffic. Removes CSP on this local test page only
 * to permit the fake endpoint. Overrides headless UA/client hints solely so
 * PostHog's bot filter cannot turn the positive control into a vacuous pass.
 */
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/packages/e2e/package.json');
const { chromium, expect } = req('@playwright/test');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-features=LocalNetworkAccessChecks'],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'userAgentData', {
      get: () => ({
        brands: [{ brand: 'Chromium', version: '132' }],
        mobile: false,
        platform: 'macOS',
      }),
    });
  });
  await context.route('http://localhost:3109/cookies', async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['content-security-policy'];
    await route.fulfill({ response, headers });
  });
  const page = await context.newPage();
  let release;
  const gate = new Promise((r) => (release = r));
  let delayed = false;
  const sent = [];
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('http://localhost:3198/**', async (route) => {
    sent.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
  });
  await page.route('**/_next/static/chunks/**', async (route) => {
    if (route.request().url().includes('posthog')) {
      delayed = true;
      console.log('DELAYED SDK CHUNK');
      await gate;
    }
    await route.continue();
  });
  await page.goto('http://localhost:3109/cookies');
  await page.getByRole('button', { name: 'Accept all', exact: true }).click();
  await expect.poll(() => delayed, { timeout: 15000 }).toBe(true);
  await page.getByRole('radio', { name: /Essential only/ }).check();
  release();
  await page.waitForTimeout(2000);
  if (sent.length) throw Error('Analytics sent after in-flight withdrawal: ' + sent.length);
  console.log('PASS: in-flight withdrawal sends no analytics');
  await page.getByRole('radio', { name: /Accept all/ }).check();
  await page.reload();
  await expect.poll(() => sent.length, { timeout: 15000 }).toBeGreaterThan(0);
  console.log('PASS: later opt-in initializes real SDK and sends to local interceptor');
  await page.getByRole('radio', { name: /Essential only/ }).check();
  await page.waitForTimeout(500);
  const baseline = sent.length;
  await page.reload();
  await page.waitForTimeout(2500);
  if (sent.length !== baseline) throw Error('Analytics continued after withdrawal/reload');
  console.log('PASS: persisted withdrawal stops analytics after reload');
  console.log('Browser errors:', JSON.stringify(errors));
  if (errors.length) throw Error('Browser errors');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
