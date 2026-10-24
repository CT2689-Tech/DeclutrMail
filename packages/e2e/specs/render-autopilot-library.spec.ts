import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { expectNoUncontainedViewportEscape, expectNoViewportOverflow } from '../helpers/a11y';

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
  entryPoints: ['src/features/autopilot/sender-rule-library.fixture.tsx'],
  outfile: 'fixture.js',
  write: false,
  plugins: [
    {
      name: 'isolated-review-boundaries',
      setup(build: FixtureBuild) {
        build.onResolve({ filter: /(?:auth-provider|posthog|lib\/sentry|next\/link)$/ }, () => ({
          path: 'boundaries',
          namespace: 'review',
        }));
        build.onLoad({ filter: /.*/, namespace: 'review' }, () => ({
          loader: 'tsx',
          resolveDir: webRoot,
          contents: `export const useOptionalAuth=()=>({me:{activeMailboxId:'fixture-mailbox',tier:'pro'}});export const getActiveMailboxEmail=()=> 'fixture@example.invalid';export const track=async()=>undefined;export const addBreadcrumb=()=>undefined;export const captureFeatureException=()=>undefined;export default function Link(props){return <a {...props}/>}`,
        }));
        build.onResolve({ filter: /api\/autopilot-sender-rules$/ }, () => ({
          path: 'transport',
          namespace: 'sender-rule',
        }));
        build.onLoad({ filter: /.*/, namespace: 'sender-rule' }, () => ({
          loader: 'ts',
          resolveDir: webRoot,
          contents: `export * from './src/features/autopilot/sender-rule-browser-data.fixture';`,
        }));
        build.onResolve({ filter: /api\/use-action$/ }, () => ({
          path: 'status',
          namespace: 'sender-status',
        }));
        build.onLoad({ filter: /.*/, namespace: 'sender-status' }, () => ({
          loader: 'tsx',
          resolveDir: webRoot,
          contents: `import {useQuery} from '@tanstack/react-query';import {fixtureBatchStatus} from './src/features/autopilot/sender-rule-browser-data.fixture';export const useRevertUndo=()=>({mutate:()=>{},isPending:false});export const useUndoStatus=()=>({});export function useBatchStatus(id){return useQuery({queryKey:['fixture-batch',id],queryFn:()=>fixtureBatchStatus(id),enabled:!!id,refetchInterval:q=>q.state.data?.status==='executing'?300:false});}`,
        }));
        build.onResolve({ filter: /undo\/in-flight$/ }, () => ({
          path: 'active',
          namespace: 'sender-active',
        }));
        build.onLoad({ filter: /.*/, namespace: 'sender-active' }, () => ({
          loader: 'ts',
          resolveDir: webRoot,
          contents: `export const useInFlightActions=()=>({data:[]});`,
        }));
        build.onResolve({ filter: /api\/autopilot$/ }, () => ({
          path: 'preset',
          namespace: 'sender-preset',
        }));
        build.onLoad({ filter: /.*/, namespace: 'sender-preset' }, () => ({
          loader: 'ts',
          resolveDir: webRoot,
          contents: `export * from './src/lib/api/autopilot.ts';export const postPauseAll=async()=>({data:{pausedCount:9}});`,
        }));
      },
    },
  ],
});
const client = outputFiles.find((file) => file.path.endsWith('.js'))!.text;
const css =
  readFileSync(new URL('../../shared/src/styles/tokens.css', import.meta.url), 'utf8') +
  readFileSync(
    new URL('../../../apps/web/src/features/theme/app-light-theme.css', import.meta.url),
    'utf8',
  ) +
  outputFiles.find((file) => file.path.endsWith('.css'))!.text;
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
// Build with --list and this variable to serve the same fixture in Codex's built-in browser.
if (process.env.DM_AUTOPILOT_LIBRARY_DIR) {
  const dir = process.env.DM_AUTOPILOT_LIBRARY_DIR;
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of [
    ['index.html', html],
    ['fixture.js', client],
    ['fixture.css', css],
  ])
    writeFileSync(`${dir}/${name}`, value!);
}

for (const width of [320, 375, 1280]) {
  for (const theme of ['light', 'dark']) {
    test(`expanded presets fit the ${width}px ${theme} Automations page`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`${url}?scenario=route&theme=${theme}`);
      await expect(page.getByRole('heading', { name: 'Autopilot', exact: true })).toBeVisible();
      await expectNoViewportOverflow(page);
      await expectNoUncontainedViewportEscape(page);
      const disclosure = page.getByText(/^Preset rules ·/);
      await disclosure.click();
      await expect(page.getByRole('heading', { name: 'Preset rules', exact: true })).toBeVisible();
      await expectNoViewportOverflow(page);
      await expectNoUncontainedViewportEscape(page);
      await expect(page.getByRole('heading', { name: 'Pending suggestions' })).toBeVisible();
      await disclosure.click();
      await expect(page.getByRole('heading', { name: 'Preset rules', exact: true })).toBeHidden();
      await expectNoUncontainedViewportEscape(page);
    });
  }
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
for (const viewport of [
  { width: 1280, height: 900 },
  { width: 320, height: 700 },
]) {
  test.describe(`${viewport.width}px sender rule library`, () => {
    test.use({ viewport, reducedMotion: 'reduce' });
    test('searchable selection, saved defaults, exact preview and recovery', async ({ page }) => {
      await page.goto(url);
      await expect(page.getByRole('button', { name: /^Newsletter cleanup Delete/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.getByRole('button', { name: 'Edit rule Newsletter cleanup', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Remove Studio Weekly' })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: /Family Book Club/ })).toBeDisabled();
      await page.getByRole('searchbox', { name: 'Search name or email' }).fill('Market');
      await expect(page.getByRole('checkbox', { name: /Market Notes/ })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: /Studio Weekly/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Remove Studio Weekly' })).toBeVisible();
      await page.getByRole('button', { name: 'Save rule', exact: true }).click();
      await expect(page.getByText('Rule saved. Email stays where it is.')).toBeVisible();
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog.getByRole('heading', { name: 'Delete 12 emails?' })).toBeVisible();
      await dialog.getByRole('checkbox', { name: /Market Notes/ }).uncheck();
      await expect(dialog.getByRole('heading', { name: 'Delete 9 emails?' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      await expect(dialog.getByRole('heading', { name: 'Delete 12 emails?' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.getByText('12 emails moved.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Activity and Undo' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
    test('global pause and library disclosure remain keyboard reachable', async ({ page }) => {
      await page.goto(url);
      const pause = page.getByRole('button', { name: 'Pause all', exact: true });
      await expect(pause).toBeEnabled();
      await pause.focus();
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('dialog').getByRole('heading', { name: 'Pause 8 rules?' }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(pause).toBeFocused();
      await page.getByRole('searchbox', { name: 'Search rules' }).fill('Travel');
      await page.getByRole('button', { name: /^Travel offers/ }).click();
      await expect(page.getByRole('heading', { name: 'Travel offers' })).toBeVisible();
    });
  });
}
