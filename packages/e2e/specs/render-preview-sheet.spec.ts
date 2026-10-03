import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const markup = execFileSync(
  fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url)),
  [
    fileURLToPath(
      new URL(
        '../../../apps/web/src/features/autopilot/ssr-preview-sheet.fixture.tsx',
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
const css = [
  '../../shared/src/styles/tokens.css',
  '../../../apps/web/src/features/autopilot/autopilot-dialog.css',
]
  .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
  .join('\n');

test.use({ storageState: { cookies: [], origins: [] } });

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
  { width: 320, height: 568 },
]) {
  test(`expanded reviews keep actions visible at ${viewport.width}px`, async ({ page }) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      const primary = page.getByRole('button', { name: 'Watch first', exact: true });
      await expect(primary).toBeInViewport({ ratio: 1 });
      const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
      expect(accessibility.violations).toEqual([]);
      await page.getByText('Details', { exact: true }).click();
      await expect(primary).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeInViewport({ ratio: 1 });
      await primary.click();
      await expect(page.getByText('Sender 25', { exact: true })).not.toBeInViewport();
      const body = page.locator('.dm-sheet-body');
      const geometry = await body.evaluate((element) => ({
        height: element.clientHeight,
        contentHeight: element.scrollHeight,
        width: element.clientWidth,
        contentWidth: element.scrollWidth,
      }));
      expect(geometry.contentHeight).toBeGreaterThan(geometry.height);
      expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.width);
      // A mid-list scroll must not expose sender text through or above
      // the pinned heading. Its pixels stay identical as rows pass behind it.
      await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight * 0.55;
      });
      const heading = page.locator('.dm-autopilot-paged-heading');
      const headingBox = (await heading.boundingBox())!;
      const bodyBox = (await body.boundingBox())!;
      expect(headingBox.y).toBeCloseTo(bodyBox.y, 0);
      const firstPaint = await heading.screenshot();
      await body.evaluate((element) => {
        element.scrollTop += 31;
      });
      expect(await heading.screenshot()).toEqual(firstPaint);
      await expect(primary).toBeInViewport({ ratio: 1 });
      await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(page.getByText('Sender 25', { exact: true })).toBeInViewport({ ratio: 1 });
      await expect(primary).toBeInViewport({ ratio: 1 });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
