import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

const webRoot = fileURLToPath(new URL('../../../apps/web', import.meta.url));
const mocks = readFileSync(
  new URL(
    '../../../apps/web/src/features/consent/cookie-banner-overlays.mocks.tsx',
    import.meta.url,
  ),
  'utf8',
);
const requireFromShared = createRequire(new URL('../../shared/package.json', import.meta.url));
const esbuild = createRequire(requireFromShared.resolve('vite/package.json'))('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{
    outputFiles: Array<{ path: string; text: string }>;
  }>;
};
interface FixtureBuild {
  onResolve(
    options: { filter: RegExp },
    callback: (args: { path: string }) => { path: string; namespace: string },
  ): void;
  onLoad(
    options: { filter: RegExp; namespace: string },
    callback: () => { contents: string; loader: string; resolveDir: string },
  ): void;
}

// Render production overlay markup, internal wrappers and CSS, replacing only account/router
// boundaries. The fixture recreates the header/anchor; it does not verify the full signed-in shell.
const { outputFiles: files } = await esbuild.build({
  absWorkingDir: webRoot,
  bundle: true,
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  entryPoints: ['src/features/consent/cookie-banner-overlays.client.tsx'],
  outfile: 'overlay-fixture.js',
  format: 'iife',
  jsx: 'automatic',
  platform: 'browser',
  write: false,
  plugins: [
    {
      name: 'isolated-account-boundaries',
      setup(build: FixtureBuild) {
        build.onResolve(
          {
            filter:
              /(?:auth-provider|use-upgrade-return-to|use-mailbox-health|use-set-active-mailbox|use-disconnect-mailbox|use-delete-mailbox-indexed-data|use-logout|load-mailbox-data-controls|lib\/posthog|entitlements\/upgrade-gate|next\/link)$/,
          },
          () => ({ path: 'account-fixture', namespace: 'overlay-fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'overlay-fixture' }, () => ({
          contents: mocks,
          loader: 'tsx',
          resolveDir: webRoot,
        }));
      },
    },
  ],
});
const client = files.find((file) => file.path.endsWith('.js'))!.text;
const css =
  readFileSync(new URL('../../shared/src/styles/tokens.css', import.meta.url), 'utf8') +
  files.find((file) => file.path.endsWith('.css'))!.text;

test.use({ storageState: { cookies: [], origins: [] } });

for (const viewport of [
  { width: 1024, height: 520 },
  { width: 320, height: 568 },
]) {
  test(`Activity View results receives clicks over the cookie banner at ${viewport.width}px`, async ({
    page,
  }) => {
    await serve(page, async (url) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(url);
      await page.getByRole('button', { name: 'Filter', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Activity filters' });
      await dialog.getByRole('button', { name: 'Manual', exact: true }).click();
      const results = dialog.getByRole('button', { name: 'View results', exact: true });
      await expectHitTarget(results, dialog, page.getByTestId('cookie-consent-banner'), {
        // The mobile footer sits below the tabbar-offset cookie card, while
        // the sheet body overlaps it. The desktop footer overlaps directly.
        targetOverlaps: viewport.width > 760,
      });
      await results.click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('status')).toHaveText('Applied source: manual');
      await page.getByRole('button', { name: 'Essential only', exact: true }).click();
      await expect(page.getByTestId('cookie-consent-banner')).toBeHidden();
    });
  });

  test(`Account menu Settings receives clicks over the cookie banner at ${viewport.width}px`, async ({
    page,
  }) => {
    await serve(page, async (url) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`${url}?surface=account`);
      const trigger = page.getByRole('button', { name: /owner@example\.invalid/ });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Gmail accounts' });
      const settings = dialog.getByRole('link', { name: 'Settings', exact: true });
      const banner = page.getByTestId('cookie-consent-banner');
      await expectHitTarget(settings, dialog, banner, { targetOverlaps: true });
      await dialog.getByRole('button', { name: 'Close account menu' }).click();
      await expect(dialog).toBeHidden();
      await banner
        .getByRole('button', { name: 'Essential only', exact: true })
        .click({ trial: true });
      await trigger.click();
      await settings.click();
      await expect(page.getByRole('heading', { name: 'Settings destination' })).toBeVisible();
      await expect(page).toHaveURL(`${url}settings`);
    });
  });
}

async function serve(page: Page, run: (url: string) => Promise<void>): Promise<void> {
  const clientErrors: string[] = [];
  const onError = (error: Error) => clientErrors.push(error.message);
  page.on('pageerror', onError);
  const server = createServer((req, res) => {
    if (req.url === '/client.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(client);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      req.url === '/settings'
        ? '<!doctype html><h1>Settings destination</h1>'
        : `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/client.js"></script></body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    expect(clientErrors, 'rendered components have no uncaught browser errors').toEqual([]);
  } finally {
    page.removeListener('pageerror', onError);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function expectHitTarget(
  target: Locator,
  dialog: Locator,
  banner: Locator,
  { targetOverlaps }: { targetOverlaps: boolean },
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await expect(banner).toBeVisible();
  const box = (await target.boundingBox())!;
  const cover = (await banner.boundingBox())!;
  const panel = (await dialog.boundingBox())!;
  expect(panel.y < cover.y + cover.height && panel.y + panel.height > cover.y).toBe(true);
  if (targetOverlaps) {
    const x = box.x + box.width / 2;
    expect(x, 'hit-tested point is inside the cookie banner horizontally').toBeGreaterThan(cover.x);
    expect(x).toBeLessThan(cover.x + cover.width);
    const y = box.y + box.height / 2;
    expect(y, 'target center is inside the cookie banner vertically').toBeGreaterThan(cover.y);
    expect(y).toBeLessThan(cover.y + cover.height);
  }
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        );
      }),
    )
    .toBe(true);
}
