import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

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
  entryPoints: ['src/features/activity/activity-selection.fixture.tsx'],
  outfile: 'fixture.js',
  write: false,
  plugins: [
    {
      name: 'isolated-review-boundaries',
      setup(build: FixtureBuild) {
        build.onResolve({ filter: /(?:auth-provider|posthog|next\/link)$/ }, () => ({
          path: 'boundaries',
          namespace: 'review',
        }));
        build.onLoad({ filter: /.*/, namespace: 'review' }, () => ({
          loader: 'tsx',
          resolveDir: webRoot,
          contents: `export const useOptionalAuth=()=>({me:{activeMailboxId:'mb-story',tier:'pro'}});export const getActiveMailboxEmail=()=> 'fixture@example.invalid';export const track=async()=>undefined;export default function Link(props){return <a {...props}/>}`,
        }));
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: 'navigation',
          namespace: 'activity-nav',
        }));
        build.onLoad({ filter: /.*/, namespace: 'activity-nav' }, () => ({
          loader: 'ts',
          resolveDir: webRoot,
          contents: `export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({});`,
        }));
        build.onResolve({ filter: /^@sentry\/nextjs$/ }, () => ({
          path: 'telemetry',
          namespace: 'activity-telemetry',
        }));
        build.onLoad({ filter: /.*/, namespace: 'activity-telemetry' }, () => ({
          loader: 'ts',
          resolveDir: webRoot,
          contents: `export const addBreadcrumb=()=>undefined;export const captureException=()=>undefined;export const captureMessage=()=>undefined;export const withScope=()=>undefined;export const getClient=()=>undefined;export const captureRouterTransitionStart=()=>undefined;export const init=()=>undefined;`,
        }));
      },
    },
  ],
});
const client = outputFiles.find((file) => file.path.endsWith('.js'))!.text;
const css =
  readFileSync(new URL('../../shared/src/styles/tokens.css', import.meta.url), 'utf8') +
  outputFiles.find((file) => file.path.endsWith('.css'))!.text;
const html = `<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0;background:var(--dm-bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`;
// Build with --list and this variable to serve the same fixture in Codex's built-in browser.
if (process.env.DM_ACTIVITY_SELECTION_DIR) {
  const dir = process.env.DM_ACTIVITY_SELECTION_DIR;
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
const pageErrors = new WeakMap<Page, string[]>();
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page), 'review components have no uncaught browser errors').toEqual([]);
});
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
for (const width of [1280, 320]) {
  test.describe(`${width}px Activity selection`, () => {
    test.use({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    test('eligible checkboxes stay separate from sender logos and support keyboard selection', async ({
      page,
    }) => {
      await page.goto(url);
      await expect(page.getByText('Select actions to undo together.')).toBeVisible();
      const boxes = page.getByRole('checkbox', { name: /Select activity row/ });
      await expect(boxes).toHaveCount(2);
      const cards = page.locator('[data-activity-card]');
      await expect(cards).toHaveCount(5);
      for (let index = 0; index < 2; index++) {
        const card = cards.nth(index);
        const bounds = await card.getByRole('checkbox').boundingBox();
        const logo = await card.locator('[data-activity-sender-avatar]').boundingBox();
        expect(bounds).not.toBeNull();
        expect(logo).not.toBeNull();
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(logo!.x);
        await expect
          .poll(() => card.locator('[data-row-sender]').evaluate((el) => el.clientWidth))
          .toBeGreaterThanOrEqual(100);
        await expect
          .poll(() =>
            card.locator('[data-row-sender]').evaluate((el) => el.scrollWidth - el.clientWidth),
          )
          .toBeLessThanOrEqual(0);
      }
      await boxes.nth(0).focus();
      await page.keyboard.press('Space');
      await expect(page.getByText('1 action selected')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Undo 1 action', exact: true })).toBeEnabled();
      await boxes.nth(1).check();
      await expect(page.getByRole('button', { name: 'Undo 2 actions', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Clear', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Bulk actions' })).toHaveCount(0);
      await expect(boxes.nth(0)).not.toBeChecked();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  });
}
