/** Local-only browser interactions on the real API's synthetic seed. No Gmail writes. */
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/packages/e2e/package.json');
const { chromium, request, expect } = req('@playwright/test');
const web = process.env.SMOKE_WEB_URL || 'http://127.0.0.1:3117';
const api = process.env.SMOKE_API_URL || 'http://127.0.0.1:4199';
for (const url of [web, api])
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname))
    throw new Error('Local smoke only');
(async () => {
  const auth = await request.newContext();
  expect(
    (
      await auth.get(api + '/api/auth/dev/login?email=chintan.e2e.billing%40synthetic.test', {
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(302);
  const state = await auth.storageState();
  await auth.dispose();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({
        storageState: state,
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.setDefaultNavigationTimeout(45000);
        const mutations = [],
          errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('request', (r) => {
          if (r.method() === 'POST' && /\/api\/actions\/(composite|bulk)/.test(r.url()))
            mutations.push(r.url());
        });
        await page.goto(web + '/senders');
        await page.waitForLoadState('networkidle');
        const consent = page.getByRole('button', { name: 'Essential only', exact: true });
        if (await consent.isVisible()) await consent.click();
        const skip = page.getByRole('button', { name: 'Skip', exact: true });
        if (await skip.isVisible()) await skip.click();
        const senderRows =
          width === 390
            ? page.locator('[data-dm-component="sender-mobile-list"] > div')
            : page.locator('article');
        const search = page.getByRole('combobox', { name: 'Search senders' });
        await expect(search).toBeVisible();
        await search.pressSequentially('Fresh Finds Weekly', { delay: 40 });
        await expect(senderRows).toHaveCount(1);
        await expect(search).toHaveValue('Fresh Finds Weekly');
        await search.fill('');
        await expect(senderRows).toHaveCount(2);
        console.log(JSON.stringify({ width, scenario: 'search-and-clear', result: 'PASS' }));

        await page.getByRole('radio', { name: 'Only quiet senders, 0', exact: true }).click();
        await expect(senderRows).toHaveCount(0);
        await expect(search).toBeVisible();
        await page.getByRole('radio', { name: 'Only active senders, 2', exact: true }).click();
        await expect(senderRows).toHaveCount(2);
        console.log(JSON.stringify({ width, scenario: 'empty-filter-recovery', result: 'PASS' }));

        if (width === 390)
          await page
            .getByRole('button', { name: 'Fresh Finds Weekly — expand detail', exact: true })
            .click();
        for (const action of ['Archive', 'Later', 'Delete']) {
          await page
            .getByRole('button', { name: 'More actions for Fresh Finds Weekly', exact: true })
            .click();
          await page.getByRole('menuitem', { name: action, exact: true }).click();
          const cancel = page.getByRole('button', { name: /Cancel/ }).last();
          await expect(cancel).toBeVisible();
          await cancel.focus();
          await page.keyboard.press('Enter');
          await expect(cancel).toHaveCount(0);
          expect(mutations).toEqual([]);
          console.log(
            JSON.stringify({ width, scenario: action + '-preview-cancel', result: 'PASS' }),
          );
        }
        if (width !== 390) {
          await page.getByRole('button', { name: 'Table', exact: true }).click();
          await expect(page.locator('table').first()).toBeVisible();
          await page.getByRole('button', { name: 'Grid', exact: true }).click();
          await expect(senderRows).toHaveCount(2);
          console.log(JSON.stringify({ width, scenario: 'table-grid-switch', result: 'PASS' }));
        }
        if (width === 390) {
          await page.getByRole('button', { name: 'Open navigation menu' }).click();
          await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toBeVisible();
          await page.getByRole('button', { name: 'Close navigation menu' }).click();
          await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toHaveCount(0);
          console.log(JSON.stringify({ width, scenario: 'mobile-navigation', result: 'PASS' }));
        }
        const exported = await context.request.get(api + '/api/account/export?format=json');
        expect(exported.status()).toBe(200);
        expect(exported.headers()['content-type']).toContain('application/json');
        expect(errors).toEqual([]);
        console.log(JSON.stringify({ width, scenario: 'data-export', result: 'PASS' }));
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
