# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: brief-preview.spec.ts >> Brief separates yesterday from current-inbox preview and cancel never enqueues
- Location: specs/brief-preview.spec.ts:23:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('1 message yesterday', { exact: true })
Expected: visible
Error: strict mode violation: getByText('1 message yesterday', { exact: true }) resolved to 2 elements:
    1) <div>1 message yesterday</div> aka getByRole('region', { name: 'Noise (1 senders, 1 messages' }).getByText('message yesterday')
    2) <div>1 message yesterday</div> aka getByText('message yesterday').nth(1)

Call log:
  - Expect "toBeVisible" getByText('1 message yesterday', { exact: true }) with timeout 15000ms
  - waiting for getByText('1 message yesterday', { exact: true })

```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | import { expectScreenMounted } from '../helpers/screen-ready';
  3  |
  4  | import { ApiClient, requireLiveStack } from '../helpers/api';
  5  | import { dbConnect } from '../helpers/db';
  6  | import { applyJourneySeed } from '../helpers/seed-journeys';
  7  | import { BILLING_SEED } from '../helpers/seed-billing';
  8  |
  9  | const api = new ApiClient();
  10 | test.beforeAll(async () => {
  11 |   await requireLiveStack(api);
  12 |   const sql = dbConnect();
  13 |   try {
  14 |     await applyJourneySeed(sql);
  15 |   } finally {
  16 |     await sql.end();
  17 |   }
  18 | });
  19 | test.afterAll(async () => {
  20 |   await api.dispose();
  21 | });
  22 |
  23 | test('Brief separates yesterday from current-inbox preview and cancel never enqueues', async ({
  24 |   page,
  25 | }) => {
  26 |   const writes: string[] = [];
  27 |   page.on('request', (request) => {
  28 |     if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/actions/'))
  29 |       writes.push(request.url());
  30 |   });
  31 |   await page.goto('/brief');
  32 |   await expectScreenMounted(page);
  33 |   const banner = page.getByTestId('cookie-consent-banner');
  34 |   await expect(banner).toBeVisible();
  35 |   await banner.getByRole('button', { name: 'Essential only', exact: true }).click();
  36 |   await expect(
  37 |     page.getByRole('checkbox', {
  38 |       name: `Include ${BILLING_SEED.archiveSenderName} in the archive`,
  39 |     }),
  40 |   ).toBeChecked();
> 41 |   await expect(page.getByText('1 message yesterday', { exact: true })).toBeVisible();
     |                                                                        ^ Error: expect(locator).toBeVisible() failed
  42 |   await page.getByRole('button', { name: 'Archive 1 sender', exact: true }).click();
  43 |   const dialog = page.getByRole('dialog');
  44 |   await expect(dialog).toBeVisible();
  45 |   await expect(dialog).toContainText(BILLING_SEED.archiveSenderName);
  46 |   await expect(dialog.getByRole('button', { name: 'Archive 2', exact: true })).toBeEnabled();
  47 |   await page.keyboard.press('Escape');
  48 |   await expect(dialog).toHaveCount(0);
  49 |   expect(writes).toEqual([]);
  50 |   const preview = await api.get<{ counts: { all: number } }>(
  51 |     `/api/actions/preview?senderId=${BILLING_SEED.archiveSenderId}`,
  52 |   );
  53 |   expect(preview.counts.all).toBe(2);
  54 | });
  55 |
```
