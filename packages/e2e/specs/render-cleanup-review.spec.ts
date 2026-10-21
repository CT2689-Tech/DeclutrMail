import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator } from '@playwright/test';

const webRoot = fileURLToPath(new URL('../../../apps/web', import.meta.url));
const requireFromShared = createRequire(new URL('../../shared/package.json', import.meta.url));
const esbuild = createRequire(requireFromShared.resolve('vite/package.json'))('esbuild') as {
  build(
    options: Record<string, unknown>,
  ): Promise<{ outputFiles: Array<{ path: string; text: string }> }>;
};
interface FixtureBuild {
  onResolve(options: { filter: RegExp }, callback: () => { path: string; namespace: string }): void;
  onLoad(
    options: { filter: RegExp; namespace: string },
    callback: () => { contents: string; loader: string; resolveDir: string },
  ): void;
}
// Production components, internal wrappers and CSS; synthetic accounts and no telemetry/network.
const { outputFiles } = await esbuild.build({
  absWorkingDir: webRoot,
  bundle: true,
  jsx: 'automatic',
  platform: 'browser',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  entryPoints: ['src/test/cleanup-review.fixture.tsx'],
  outfile: 'fixture.js',
  write: false,
  plugins: [
    {
      name: 'isolated-review-boundaries',
      setup(build: FixtureBuild) {
        build.onResolve({ filter: /(?:auth-provider|posthog|next\/link)$/ }, () => ({
          path: 'mocks',
          namespace: 'review',
        }));
        build.onLoad({ filter: /.*/, namespace: 'review' }, () => ({
          loader: 'tsx',
          resolveDir: webRoot,
          contents: `export const useOptionalAuth=()=>null; export const getActiveMailboxEmail=()=>null;
      export const track=async()=>undefined; export default function Link(props){return <a {...props}/>}`,
        }));
      },
    },
  ],
});
const client = outputFiles.find((file) => file.path.endsWith('.js'))!.text;
const css =
  readFileSync(new URL('../../shared/src/styles/tokens.css', import.meta.url), 'utf8') +
  outputFiles.find((file) => file.path.endsWith('.css'))!.text;
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
// Build with --list and this variable to serve the same fixture in Codex's built-in browser.
if (process.env.DM_CLEANUP_REVIEW_DIR) {
  const dir = process.env.DM_CLEANUP_REVIEW_DIR;
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of [
    ['index.html', html],
    ['fixture.js', client],
    ['fixture.css', css],
  ])
    writeFileSync(`${dir}/${name}`, value!);
}
let server: ReturnType<typeof createServer>;
let url: string;
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const kind =
      req.url === '/fixture.js'
        ? 'text/javascript'
        : req.url === '/fixture.css'
          ? 'text/css'
          : 'text/html';
    res.writeHead(200, { 'content-type': kind });
    res.end(req.url === '/fixture.js' ? client : req.url === '/fixture.css' ? css : html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
for (const viewport of [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport, reducedMotion: 'reduce' });
    for (const surface of ['senders', 'triage'])
      test(`${surface} choices, scope and return focus`, async ({ page }) => {
        await page.goto(`${url}?surface=${surface}`);
        const opener = page.getByRole('button', { name: `Review ${surface}`, exact: true });
        await opener.click();
        const dialog = page.getByRole('dialog');
        for (const name of ['Unsubscribe only', '+ Archive', '+ Delete'])
          await fullyVisible(dialog.getByRole('radio', { name, exact: true }));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(opener).toBeFocused();
        await expect(page.getByTestId('accepted')).toBeEmpty();
        for (const days of [180, null]) {
          await opener.click();
          await dialog.getByRole('radio', { name: '+ Delete', exact: true }).click();
          const age = dialog.getByRole('combobox', { name: 'Email age', exact: true });
          await expect(age).toHaveValue('180');
          await expect(age.getByRole('option', { name: 'Any age', exact: true })).toHaveAttribute(
            'value',
            'all',
          );
          const archived = dialog.getByRole('checkbox', { name: 'Include archived email' });
          await expect(archived).not.toBeChecked();
          if (days === null) {
            await age.selectOption('all');
            await archived.check();
          }
          await dialog.getByRole('button', { name: 'Unsubscribe + Delete', exact: true }).click();
          const payload = JSON.parse((await page.getByTestId('accepted').textContent())!);
          expect(payload).toMatchObject(
            surface === 'senders'
              ? {
                  secondary: { type: 'delete', olderThanDays: days },
                  senderIds: ['fixture-sender'],
                }
              : { backlogMode: 'delete', olderThanDays: days },
          );
          expect(payload.reach).toBe(days === null ? 'all_mail' : undefined);
        }
      });
    test('Home names the sender and count before accepting', async ({ page }) => {
      await page.goto(`${url}?surface=home`);
      const opener = page.getByRole('button', { name: 'Review home', exact: true });
      await opener.click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toHaveAccessibleDescription(/Fixture Newsletter:.*12 emails/);
      await fullyVisible(dialog.locator('#home-fix-impact'));
      await expect(page.getByTestId('accepted')).toBeEmpty();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(opener).toBeFocused();
      await opener.click();
      await dialog.getByRole('button', { name: 'Unsubscribe + Archive', exact: true }).click();
      await expect(page.getByTestId('accepted')).toHaveText(
        JSON.stringify({ mode: 'archive', emailCount: 12, senderIds: ['fixture-sender'] }),
      );
    });
    test('native Tab leaves inline Screener Delete without cancelling it', async ({ page }) => {
      await page.goto(`${url}?surface=screener`);
      await page.getByRole('button', { name: 'Review screener', exact: true }).click();
      const preview = page.getByRole('region', { name: /^Preview · Delete / });
      await preview.getByRole('button', { name: /^Delete for/ }).focus();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Next row', exact: true })).toBeFocused();
      await expect(preview).toBeVisible();
      await expect(page.getByTestId('accepted')).toBeEmpty();
    });
  });
}
async function fullyVisible(locator: Locator) {
  await expect(locator).toBeVisible();
  expect(
    await locator.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return (
        r.top >= 0 &&
        r.left >= 0 &&
        r.right <= innerWidth &&
        r.bottom <= innerHeight &&
        element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
      );
    }),
    'control is fully visible and receives pointer input before any scrolling',
  ).toBe(true);
}
