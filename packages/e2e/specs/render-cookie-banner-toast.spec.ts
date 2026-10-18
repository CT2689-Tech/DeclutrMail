import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  COOKIE_BANNER_CLEARANCE_PX,
  COOKIE_BANNER_INSET_EVENT,
  COOKIE_BANNER_LIFT_VAR,
  UNDO_TRAY_INSET_VAR,
  undoTrayOccupiedPx,
} from '@declutrmail/shared';
import { expect, test, type Locator, type Page } from '@playwright/test';

const requireFromShared = createRequire(new URL('../../shared/package.json', import.meta.url));
const esbuild = createRequire(requireFromShared.resolve('vite/package.json'))('esbuild') as {
  buildSync: (options: {
    absWorkingDir: string;
    bundle: true;
    define: Record<string, string>;
    entryPoints: string[];
    format: 'iife';
    jsx: 'automatic';
    platform: 'browser';
    write: false;
  }) => { outputFiles: Array<{ text: string }> };
};
const clientBundle = esbuild.buildSync({
  absWorkingDir: fileURLToPath(new URL('../../../apps/web', import.meta.url)),
  bundle: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  entryPoints: ['src/features/consent/cookie-banner-toast.client.tsx'],
  format: 'iife',
  jsx: 'automatic',
  platform: 'browser',
  write: false,
}).outputFiles[0]!.text;

const markup = execFileSync(
  fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url)),
  [
    fileURLToPath(
      new URL(
        '../../../apps/web/src/features/consent/cookie-banner-toast.fixture.tsx',
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

test('undo toast and tray stay tappable above the cookie banner at 360px', async ({ page }) => {
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

    const banner = page.getByTestId('cookie-consent-banner');
    const trayUndo = page.getByRole('region', { name: 'Recent actions' }).getByRole('button', {
      name: 'Undo Archive',
    });
    const toastUndo = page.getByTestId('undo-toast').getByRole('button', { name: 'Undo' });
    const accept = banner.getByRole('button', { name: 'Accept all', exact: true });
    const essential = banner.getByRole('button', { name: 'Essential only', exact: true });

    await expect(trayUndo).toBeVisible();
    await expect(toastUndo).toBeVisible();
    await expect(banner).toBeVisible();
    await expect(page.getByText('Archived 12 emails').first()).toBeVisible();

    const bannerBox = (await banner.boundingBox())!;
    const coveredTray = (await trayUndo.boundingBox())!;
    expect(intersects(coveredTray, bannerBox), 'Undo starts under the banner').toBe(true);
    expect(await hitButton(page, coveredTray)).not.toBe('Undo');
    await page.screenshot({ path: '/opt/cursor/artifacts/cookie-banner-undo-covered-360.png' });

    await publishClearance(page);

    const liftedBanner = (await banner.boundingBox())!;
    const liftedTray = (await trayUndo.boundingBox())!;
    const liftedToast = (await toastUndo.boundingBox())!;
    expect(intersects(liftedTray, liftedBanner), 'tray Undo clears the banner').toBe(false);
    expect(intersects(liftedToast, liftedBanner), 'toast Undo clears the banner').toBe(false);
    expect(
      liftedToast.y + liftedToast.height,
      'toast Undo sits above the tray',
    ).toBeLessThanOrEqual(liftedTray.y);
    expect(await hitButton(page, liftedTray)).toBe('Undo');
    expect(await hitButton(page, liftedToast)).toBe('Undo');
    await expectTopmost(page, accept, 'Accept all');
    await expectTopmost(page, essential, 'Essential only');
    await page.screenshot({ path: '/opt/cursor/artifacts/cookie-banner-undo-clear-360.png' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('mounted banner and tray publish a clearance that keeps both Undo buttons and the banner buttons tappable', async ({
  page,
}) => {
  const server = createServer((req, res) => {
    if (req.url === '/client.js') {
      send(res, 'text/javascript; charset=utf-8', clientBundle);
      return;
    }
    send(
      res,
      'text/html; charset=utf-8',
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><script>window.__cookieBannerInsetEvents=0;window.addEventListener(${JSON.stringify(COOKIE_BANNER_INSET_EVENT)},function(){window.__cookieBannerInsetEvents++})</script></head><body><div id="root"></div><script src="/client.js"></script></body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);

    const banner = page.getByTestId('cookie-consent-banner');
    const trayUndo = page.getByRole('region', { name: 'Recent actions' }).getByRole('button', {
      name: 'Undo Archive',
    });
    const toastUndo = page.getByRole('button', { name: 'Undo', exact: true });
    const accept = banner.getByRole('button', { name: 'Accept all', exact: true });
    const essential = banner.getByRole('button', { name: 'Essential only', exact: true });

    await expect(trayUndo).toBeVisible();
    await expect(toastUndo).toBeVisible();
    await expect(banner).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await nextFrame(page);

    const published = await page.evaluate(
      ({ eventCountKey, liftName, insetName }) => {
        const root = document.documentElement;
        return {
          events: (window as unknown as Record<string, number>)[eventCountKey] ?? 0,
          lift: root.style.getPropertyValue(liftName),
          inset: root.style.getPropertyValue(insetName),
        };
      },
      {
        eventCountKey: '__cookieBannerInsetEvents',
        liftName: COOKIE_BANNER_LIFT_VAR,
        insetName: UNDO_TRAY_INSET_VAR,
      },
    );
    expect(published.events, COOKIE_BANNER_INSET_EVENT).toBeGreaterThan(0);
    expect(published.lift).toMatch(/^\d+px$/);
    expect(published.inset).toMatch(/^\d+px$/);

    const bannerBox = (await banner.boundingBox())!;
    const trayBox = (await trayUndo.boundingBox())!;
    const toastBox = (await toastUndo.boundingBox())!;
    expect(intersects(trayBox, bannerBox), 'tray Undo clears the banner').toBe(false);
    expect(intersects(toastBox, bannerBox), 'toast Undo clears the banner').toBe(false);
    expect(toastBox.y + toastBox.height, 'toast Undo sits above the tray').toBeLessThanOrEqual(
      trayBox.y,
    );
    expect(await hitButton(page, trayBox)).toBe('Undo');
    expect(await hitButton(page, toastBox)).toBe('Undo');
    await expectTopmost(page, accept, 'Accept all');
    await expectTopmost(page, essential, 'Essential only');
    await page.screenshot({ path: '/opt/cursor/artifacts/cookie-banner-undo-live-360.png' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function send(res: ServerResponse, contentType: string, body: string): void {
  res.writeHead(200, { 'content-type': contentType });
  res.end(body);
}

async function publishClearance(page: Page): Promise<void> {
  // The tray's used bottom stays on the previous frame in the same turn
  // the lift variable is set. Wait until after paint, then measure.
  await page.evaluate(
    ({ liftName, clearance }) => {
      const banner = document.querySelector('[data-testid="cookie-consent-banner"]');
      if (!(banner instanceof HTMLElement)) throw new Error('cookie banner missing');
      const lift = Math.ceil(banner.getBoundingClientRect().height) + clearance;
      document.documentElement.style.setProperty(liftName, `${lift}px`);
    },
    { liftName: COOKIE_BANNER_LIFT_VAR, clearance: COOKIE_BANNER_CLEARANCE_PX },
  );
  await nextFrame(page);
  const measured = await page.evaluate(() => {
    const tray = document.querySelector('[data-dm-undo-tray]');
    if (!(tray instanceof HTMLElement)) throw new Error('undo tray missing');
    return { top: tray.getBoundingClientRect().top, innerHeight: window.innerHeight };
  });
  await page.evaluate(
    ({ name, value }) => {
      document.documentElement.style.setProperty(name, value);
    },
    {
      name: UNDO_TRAY_INSET_VAR,
      value: `${undoTrayOccupiedPx(measured.top, measured.innerHeight)}px`,
    },
  );
  await nextFrame(page);
}

function nextFrame(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function hitButton(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
): Promise<string | null> {
  return page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest('button')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
}

async function expectTopmost(page: Page, locator: Locator, name: string): Promise<void> {
  const box = (await locator.boundingBox())!;
  expect(await hitButton(page, box)).toBe(name);
}
