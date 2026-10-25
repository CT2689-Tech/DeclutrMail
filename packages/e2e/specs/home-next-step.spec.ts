import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { BILLING_SEED } from '../helpers/seed-billing';
import { dbConnect } from '../helpers/db';
import { E2E_ENV } from '../helpers/env';
import { applyJourneySeed } from '../helpers/seed-journeys';

test.use({ storageState: { cookies: [], origins: [] } });

async function seedHomeRecommendation(tier: 'free' | 'pro' = 'pro') {
  const sql = dbConnect();
  try {
    await applyJourneySeed(sql);
    await sql`UPDATE workspaces SET tier = ${tier} WHERE id = ${BILLING_SEED.workspaceId}`;
    await sql`DELETE FROM inbox_report_cache WHERE mailbox_account_id = ${BILLING_SEED.mailboxId}`;
    await sql`UPDATE senders SET unsubscribe_method = 'one_click', unsubscribe_url = 'https://newsletter.synthetic.test/unsubscribe' WHERE id = ${BILLING_SEED.archiveSenderId}`;
    await sql`
      INSERT INTO mail_messages (mailbox_account_id, provider_message_id, provider_thread_id, sender_key, internal_date, is_unread, label_ids)
      VALUES (${BILLING_SEED.mailboxId}, 'e2e-home-focus-unread', 'e2e-home-focus-thread', ${BILLING_SEED.archiveSenderKey}, now(), true, ARRAY['INBOX'])
      ON CONFLICT (mailbox_account_id, provider_message_id) DO NOTHING
    `;
  } finally {
    await sql.end();
  }
}

test.afterEach(async () => {
  const sql = dbConnect();
  try {
    await sql`DELETE FROM inbox_report_cache WHERE mailbox_account_id = ${BILLING_SEED.mailboxId}`;
    await sql`DELETE FROM mail_messages WHERE mailbox_account_id = ${BILLING_SEED.mailboxId} AND provider_message_id = 'e2e-home-focus-unread'`;
    await sql`UPDATE senders SET unsubscribe_method = NULL, unsubscribe_url = NULL WHERE id = ${BILLING_SEED.archiveSenderId}`;
    await sql`UPDATE workspaces SET tier = 'pro' WHERE id = ${BILLING_SEED.workspaceId}`;
  } finally {
    await sql.end();
  }
});

test('return visit opens Home and does not confirm a next step', async ({ page }) => {
  await seedHomeRecommendation();
  await page.goto(
    `${E2E_ENV.apiUrl}/api/auth/dev/login?${new URLSearchParams({ email: BILLING_SEED.email })}`,
  );
  await expect(page).toHaveURL(`${E2E_ENV.webUrl}/home`);
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // Exercise the real Home route and real report selection, including a
  // first cleanup before there is any recorded progress.
  const step = page.getByRole('button', { name: 'Preview cleanup', exact: true });
  const ready = page.locator('[data-home-fix-expected="true"]');
  await expect(ready).toHaveCount(1);
  await page.getByText('Details', { exact: true }).click();
  await expect(page.locator('[data-home-impact]')).toContainText('3 emails in your inbox');
  await step.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Unsubscribe from 1 sender?');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(step).toBeFocused();
});

for (const tier of ['pro', 'free'] as const) {
  for (const width of [1280, 768, 375, 320]) {
    test(`Focus Home and account menu fit ${width}px on ${tier} without changing mail`, async ({
      page,
    }) => {
      await seedHomeRecommendation(tier);
      await page.setViewportSize({ width, height: 812 });
      const actionPosts: string[] = [];
      page.on('request', (request) => {
        if (request.method() === 'POST' && /\/(actions|unsubscribe-backlog)/.test(request.url()))
          actionPosts.push(request.url());
      });
      await page.goto(
        `${E2E_ENV.apiUrl}/api/auth/dev/login?${new URLSearchParams({ email: BILLING_SEED.email })}`,
      );
      const preview = page.getByRole('button', { name: 'Preview cleanup', exact: true });
      await expect(preview).toBeVisible();
      await preview.click();
      await expect(page.getByRole('alertdialog')).toContainText('Unsubscribe from 1 sender?');
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(preview).toBeFocused();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      const trigger = page.getByRole('button', { name: BILLING_SEED.email, exact: true });
      const triggerBounds = await trigger.boundingBox();
      expect(triggerBounds).not.toBeNull();
      expect(triggerBounds!.x).toBeGreaterThanOrEqual(0);
      expect(triggerBounds!.x + triggerBounds!.width).toBeLessThanOrEqual(width);
      if (tier === 'free') {
        // Preserve the full Home allowance while keeping narrow-shell controls reachable.
        await expect(page.getByTestId('quota-chip').filter({ visible: true })).toHaveCount(
          width <= 900 ? 1 : 2,
        );
      }
      await trigger.click();
      const menu = page.getByRole('dialog', { name: 'Gmail accounts', exact: true });
      await expect(menu).toBeVisible();
      await expect(menu.getByText('Selected', { exact: true })).toHaveCount(0);
      await expect(
        menu.getByRole('link', { name: 'Manage accounts', exact: true }),
      ).toHaveAttribute('href', '/settings#mailboxes');
      const bounds = await menu.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      expect(actionPosts).toEqual([]);
    });
  }
}
