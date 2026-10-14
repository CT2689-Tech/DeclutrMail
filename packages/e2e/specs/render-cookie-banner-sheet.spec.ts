import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const markup = execFileSync(
  fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url)),
  [
    fileURLToPath(
      new URL(
        '../../../apps/web/src/features/consent/cookie-banner-sheet.fixture.tsx',
        import.meta.url,
      ),
    ),
  ],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: fileURLToPath(new URL('../../shared/tsconfig.json', import.meta.url)),
    },
  },
);
const css = readFileSync(new URL('../../shared/src/styles/tokens.css', import.meta.url), 'utf8');

test.use({ storageState: { cookies: [], origins: [] } });

test('action sheet footers stay tappable above the cookie banner at 360px', async ({ page }) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);

    const dialog = page.getByRole('alertdialog', { name: 'Delete 45 emails?' });
    const deleteButton = dialog.getByRole('button', { name: 'Delete 45', exact: true });
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    const banner = page.getByTestId('cookie-consent-banner');
    const accept = banner.getByRole('button', { name: 'Accept all', exact: true });
    const essential = banner.getByRole('button', { name: 'Essential only', exact: true });

    await expect(deleteButton).toBeVisible();
    await expect(banner).toBeVisible();

    const bannerBox = (await banner.boundingBox())!;
    const deleteBox = (await deleteButton.boundingBox())!;
    // The banner sits above the mobile tab bar, which is exactly where
    // the primary footer button lands. Cancel sits in the tab-bar band
    // below the banner, so overlap is required only for Delete.
    expect(intersects(deleteBox, bannerBox), 'Delete 45 must overlap the banner').toBe(true);
    expect(
      containsPoint(bannerBox, centerOf(deleteBox)),
      'Delete 45 center must sit on the banner',
    ).toBe(true);

    await expectTopmost(page, deleteButton, 'Delete 45');
    await expectTopmost(page, cancel, 'Cancel');
    await expectTapTarget(deleteButton);
    await expectTapTarget(cancel);
    await expectTapTarget(accept);
    await expectTapTarget(essential);

    const accessibility = await new AxeBuilder({ page }).include('[role="alertdialog"]').analyze();
    expect(accessibility.violations).toEqual([]);

    await page.locator('[data-dm-preview-sheet]').evaluate((element) => element.remove());
    await expect(page.locator('[data-dm-preview-sheet]')).toHaveCount(0);
    await expect(banner).toBeVisible();
    await expectTopmost(page, accept, 'Accept all');
    await expectTopmost(page, essential, 'Essential only');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function centerOf(box: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
} {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function containsPoint(
  box: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function expectTapTarget(locator: Locator): Promise<void> {
  const box = (await locator.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
}

async function expectTopmost(page: Page, locator: Locator, name: string): Promise<void> {
  const box = (await locator.boundingBox())!;
  const hit = await page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest('button')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(hit).toBe(name);
}
