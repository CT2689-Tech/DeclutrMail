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
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css}
.dm-report button { min-height: 32px; border: 0; background: transparent; padding: 0; }
.dm-fixed-40 { height: 40px; box-sizing: border-box; }
</style></head><body>${markup}</body></html>`,
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
  'See plans',
  'What we store and share',
  'How we use AI',
] as const;

const PHONE_BUTTONS = [
  'Mostly unread (90 days)',
  'Has unsubscribe link',
  'Mail in Inbox',
  'Filter',
  'Sort: Most received',
  'Close Inbox Report',
  'More actions for Newsletter',
] as const;

async function linkHeight(page: Page, name: string): Promise<number> {
  const box = await page.getByRole('link', { name, exact: true }).boundingBox();
  expect(box, name).not.toBeNull();
  return box!.height;
}

async function buttonBox(page: Page, name: string): Promise<{ width: number; height: number }> {
  const box = await page.getByRole('button', { name, exact: true }).boundingBox();
  expect(box, name).not.toBeNull();
  return { width: box!.width, height: box!.height };
}

test('phone shell keeps the last content above a flush tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);

  for (const name of PHONE_LINKS) {
    expect(await linkHeight(page, name), name).toBeGreaterThanOrEqual(44);
  }
  for (const name of PHONE_BUTTONS) {
    const box = await buttonBox(page, name);
    expect(box.height, name).toBeGreaterThanOrEqual(44);
    expect(box.width, name).toBeGreaterThanOrEqual(44);
  }
  saveShot('mobile-links-390', await page.screenshot());

  // Align the report action to the bottom of the scrollport, then a
  // sticky bar that has scrolled past that edge. End padding cannot
  // clear either one; the scroller has to stop at the tab bar.
  await page
    .getByRole('button', { name: 'Unsubscribe + archive', exact: true })
    .evaluate((element) => {
      element.scrollIntoView({ block: 'end', inline: 'nearest' });
    });
  const action = await page.evaluate(() => {
    const button = document.querySelector('[data-report-fix]')!.getBoundingClientRect();
    const tab = document.querySelector('.dm-tabbar')!.getBoundingClientRect();
    return { buttonBottom: button.bottom, tabTop: tab.top };
  });
  expect(action.buttonBottom).toBeLessThanOrEqual(action.tabTop + 1);
  saveShot('mobile-unsubscribe-390', await page.screenshot());

  await page.locator('#sticky-actions').evaluate((element) => {
    const scroller = element.closest('.dm-main-scroll');
    if (!(scroller instanceof HTMLElement)) return;
    element.scrollIntoView({ block: 'end', inline: 'nearest' });
    scroller.scrollTop += 400;
  });
  const sticky = await page.evaluate(() => {
    const bar = document.getElementById('sticky-actions')!.getBoundingClientRect();
    const tab = document.querySelector('.dm-tabbar')!.getBoundingClientRect();
    return { barBottom: bar.bottom, tabTop: tab.top };
  });
  expect(sticky.barBottom).toBeLessThanOrEqual(sticky.tabTop + 1);

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
  const desktopInset = await page.evaluate(() => {
    const scroller = document.querySelector('.dm-main-scroll');
    if (!(scroller instanceof HTMLElement)) return null;
    const style = getComputedStyle(scroller);
    return { marginBottom: style.marginBottom, paddingBottom: style.paddingBottom };
  });
  expect(desktopInset).toEqual({ marginBottom: '0px', paddingBottom: '0px' });

  const compare = await linkHeight(page, 'Compare plans');
  expect(compare).toBeGreaterThanOrEqual(36);
  expect(compare).toBeLessThan(40);

  const sender = await linkHeight(page, 'Newsletter');
  expect(sender).toBeLessThan(30);

  const seePlans = await linkHeight(page, 'See plans');
  expect(seePlans).toBeLessThan(30);
  const stored = await linkHeight(page, 'What we store and share');
  expect(stored).toBeLessThan(30);
  const ai = await linkHeight(page, 'How we use AI');
  expect(ai).toBeGreaterThanOrEqual(36);
  expect(ai).toBeLessThan(40);

  const filter = await buttonBox(page, 'Filter');
  expect(filter.height).toBeGreaterThanOrEqual(39);
  expect(filter.height).toBeLessThan(42);
  const menu = await buttonBox(page, 'More actions for Newsletter');
  expect(menu.width).toBeLessThan(36);
  expect(menu.height).toBeLessThan(36);
  const close = await buttonBox(page, 'Close Inbox Report');
  expect(close.height).toBeLessThan(36);
  const chip = await buttonBox(page, 'Mostly unread (90 days)');
  expect(chip.height).toBeLessThan(36);

  saveShot('mobile-nav-1440', await page.screenshot());
});
