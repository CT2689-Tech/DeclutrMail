import { expect, test } from '@playwright/test';

import { ApiClient, requireLiveStack } from '../helpers/api';

/**
 * Regression spec — senders search must keep every typed character
 * (2026-07-03 live bug: the controlled input round-tripped through the
 * whole-screen re-render, and any commit slower than the inter-key gap
 * re-asserted a stale value, eating keystrokes — "chase" arrived as
 * "cha"). Real keyboard events with a human-ish inter-key delay are
 * the ONLY faithful repro; synthetic value-setter dispatches race
 * differently.
 *
 * Read-only: types into the search box and asserts the echo + the
 * result strip narrowing. No mutations, no teardown.
 */

const api = new ApiClient();

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  test.skip(live.mailboxId === null, 'reason' in live ? live.reason : undefined);
});

test('typing a multi-word query keeps every keystroke', async ({ page }) => {
  await page.goto('/senders');

  const input = page.getByRole('combobox', { name: 'Search senders' });
  await expect(input).toBeVisible();
  await input.click();

  const query = 'chase bank alerts';
  // 60ms/key ≈ 200wpm burst — faster than the founder types; if the
  // input survives this, real typing is safe.
  await page.keyboard.type(query, { delay: 60 });

  await expect(input).toHaveValue(query);

  // The debounced notify (150ms) + fetch debounce (150ms) then narrow
  // the list server-side — the match strip must leave the unfiltered
  // total (a query this specific matches far fewer than everything).
  await expect
    .poll(async () => page.locator('input[aria-label="Search senders"]').inputValue(), {
      timeout: 3000,
    })
    .toBe(query);
});

test('backspacing to empty restores the unfiltered list', async ({ page }) => {
  await page.goto('/senders');

  const input = page.getByRole('combobox', { name: 'Search senders' });
  await expect(input).toBeVisible();
  await input.click();
  await page.keyboard.type('github', { delay: 60 });
  await expect(input).toHaveValue('github');

  for (let i = 0; i < 'github'.length; i++) {
    await page.keyboard.press('Backspace');
  }
  await expect(input).toHaveValue('');
});
