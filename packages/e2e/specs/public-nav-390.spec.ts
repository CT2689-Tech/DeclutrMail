import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

function painted(
  box: { x: number; y: number; width: number; height: number } | null,
  viewport: { width: number; height: number },
): boolean {
  if (!box || box.width <= 1 || box.height <= 1) return false;
  return (
    box.x + box.width > 0 &&
    box.y + box.height > 0 &&
    box.x < viewport.width &&
    box.y < viewport.height
  );
}

async function inViewport(locator: Locator, page: Page): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
}

test('mobile menu links open inside a 390px viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  const pricing = nav.getByRole('link', { name: 'Pricing' });
  await expect(pricing).toBeVisible();
  await inViewport(pricing, page);
  await inViewport(nav.getByRole('link', { name: 'Security' }), page);
});

test('skip link stays visually hidden until it is focused', async ({ page }) => {
  await page.goto('/');
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const skip = page.getByRole('link', { name: 'Skip to content' });
  expect(painted(await skip.boundingBox(), viewport!)).toBe(false);
  await skip.focus();
  const focused = await skip.boundingBox();
  expect(focused).not.toBeNull();
  expect(focused!.y).toBeGreaterThanOrEqual(0);
  expect(focused!.y).toBeLessThan(80);
  expect(focused!.height).toBeGreaterThan(8);
});
