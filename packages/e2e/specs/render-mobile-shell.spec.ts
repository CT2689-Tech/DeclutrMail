import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const markup = execFileSync(
  fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url)),
  [fileURLToPath(new URL('./render-mobile-shell.fixture.tsx', import.meta.url))],
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

let server: Server;
let origin: string;

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css}</style></head><body>${markup}</body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function saveShot(name: string, body: Buffer): void {
  const dir = '/opt/cursor/artifacts';
  if (!existsSync(dir)) return;
  writeFileSync(`${dir}/${name}.png`, body);
}

const PHONE_LINKS = [
  'Compare plans',
  'Billing help',
  'Refund policy',
  'Manage inboxes',
  'Newsletter',
] as const;

async function linkHeight(page: Page, name: string): Promise<number> {
  const box = await page.getByRole('link', { name, exact: true }).boundingBox();
  expect(box, name).not.toBeNull();
  return box!.height;
}

test('phone shell keeps the last content above a flush tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);

  for (const name of PHONE_LINKS) {
    expect(await linkHeight(page, name), name).toBeGreaterThanOrEqual(44);
  }
  saveShot('mobile-links-390', await page.screenshot());

  await page.locator('.dm-main-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const geometry = await page.evaluate(() => {
    const end = document.getElementById('shell-end')!.getBoundingClientRect();
    const tab = document.querySelector('.dm-tabbar')!.getBoundingClientRect();
    const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1);
    return {
      endBottom: end.bottom,
      tabTop: tab.top,
      tabBottom: tab.bottom,
      innerHeight: window.innerHeight,
      bottomIsTabbar: hit?.closest('.dm-tabbar') != null,
    };
  });
  expect(geometry.endBottom).toBeLessThanOrEqual(geometry.tabTop + 1);
  expect(geometry.tabBottom).toBeGreaterThanOrEqual(geometry.innerHeight - 1);
  expect(geometry.bottomIsTabbar).toBe(true);
  saveShot('mobile-nav-390', await page.screenshot());
});

test('desktop keeps the sidebar and the original link metrics', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await expect(page.locator('.dm-tabbar')).toBeHidden();
  await expect(page.locator('.dm-sidebar-desktop')).toBeVisible();

  const compare = await linkHeight(page, 'Compare plans');
  expect(compare).toBeGreaterThanOrEqual(36);
  expect(compare).toBeLessThan(40);

  const sender = await linkHeight(page, 'Newsletter');
  expect(sender).toBeLessThan(30);

  saveShot('mobile-nav-1440', await page.screenshot());
});
