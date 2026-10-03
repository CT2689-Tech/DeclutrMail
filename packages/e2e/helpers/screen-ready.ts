import { expect, type Page } from '@playwright/test';

/**
 * ScreenIntro registers help from useEffect after the screen commits on the
 * client. Use after full navigation or reload on screens that register it.
 * This is mounted readiness, not query freshness: keep data/action assertions.
 */
export async function expectScreenMounted(page: Page): Promise<void> {
  const help = page.getByRole('button', { name: 'About this screen', exact: true });
  await expect(help).toHaveCount(1, { timeout: 30_000 });
  await expect(help).toBeVisible({ timeout: 30_000 });
}
