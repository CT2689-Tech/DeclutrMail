import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoUncontainedViewportEscape, expectNoViewportOverflow } from '../helpers/a11y';

const webRoot = fileURLToPath(new URL('../../../apps/web', import.meta.url));
const requireFromShared = createRequire(new URL('../../shared/package.json', import.meta.url));
const esbuild = createRequire(requireFromShared.resolve('vite/package.json'))('esbuild') as {
  build(options: Record<string, unknown>): Promise<{
    outputFiles: Array<{ path: string; text: string }>;
  }>;
};
interface FixtureBuild {
  onResolve(options: { filter: RegExp }, callback: () => { path: string; namespace: string }): void;
  onLoad(
    options: { filter: RegExp; namespace: string },
    callback: () => { contents: string; loader: string; resolveDir: string },
  ): void;
}
const { outputFiles } = await esbuild.build({
  absWorkingDir: webRoot,
  bundle: true,
  jsx: 'automatic',
  platform: 'browser',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  entryPoints: ['src/test/onboarding-choices.fixture.tsx'],
  outfile: 'fixture.js',
  write: false,
  plugins: [
    {
      name: 'isolated-onboarding-boundaries',
      setup(build: FixtureBuild) {
        build.onResolve({ filter: /(?:auth-provider|posthog|lib\/sentry)$/ }, () => ({
          path: 'boundaries',
          namespace: 'review',
        }));
        build.onLoad({ filter: /.*/, namespace: 'review' }, () => ({
          loader: 'tsx',
          resolveDir: webRoot,
          contents: `export const useOptionalAuth=()=>null;export const getActiveMailboxEmail=()=>null;export const track=async()=>undefined;export const captureFeatureException=()=>undefined;`,
        }));
      },
    },
  ],
});
const client = outputFiles.find((file) => file.path.endsWith('.js'))!.text;
const css =
  readFileSync(new URL('../../shared/src/styles/tokens.css', import.meta.url), 'utf8') +
  (outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '');
const appTheme = readFileSync(
  new URL('../../../apps/web/src/features/theme/app-light-theme.css', import.meta.url),
  'utf8',
);
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style id="app-styles">${appTheme}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
// Export the same fixture for a manual smoke in Codex's built-in browser.
if (process.env.DM_ONBOARDING_CHOICES_DIR) {
  mkdirSync(process.env.DM_ONBOARDING_CHOICES_DIR, { recursive: true });
  for (const [name, value] of [
    ['index.html', html],
    ['fixture.js', client],
    ['fixture.css', css],
  ])
    writeFileSync(`${process.env.DM_ONBOARDING_CHOICES_DIR}/${name}`, value!);
}
let server: ReturnType<typeof createServer>;
let url: string;
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const name = req.url?.split('?')[0];
    const isJs = name === '/fixture.js';
    const isCss = name === '/fixture.css';
    res.writeHead(200, {
      'content-type': isJs ? 'text/javascript' : isCss ? 'text/css' : 'text/html; charset=utf-8',
    });
    res.end(isJs ? client : isCss ? css : html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const paint = (choice: Locator) =>
  choice.evaluate((element) => {
    const style = getComputedStyle(element);
    return { shadow: style.boxShadow, background: style.backgroundColor };
  });

const settlePaint = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    // Flush pending theme/style changes before collecting their animations.
    getComputedStyle(document.body).getPropertyValue('background-color');
    document.body.getBoundingClientRect();
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });

const settledScreenshot = async (page: Page, name: string) => {
  await settlePaint(page);
  let previous = await page.screenshot({ animations: 'disabled' });
  for (let attempt = 1; attempt < 6; attempt++) {
    await settlePaint(page);
    const current = await page.screenshot({ animations: 'disabled' });
    if (current.equals(previous)) return current;
    if (attempt === 5) {
      await test.info().attach(`${name}-previous-paint`, {
        body: previous,
        contentType: 'image/png',
      });
      await test.info().attach(`${name}-latest-paint`, {
        body: current,
        contentType: 'image/png',
      });
    }
    previous = current;
  }
  throw new Error(`${name} paint did not settle within six consecutive captures`);
};

for (const width of [320, 375, 1280]) {
  for (const screen of ['goals', 'presets']) {
    test(`${screen} keep visible selection and unchanged dark/public paint at ${width}px`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      // No account, API operation or telemetry is part of this appearance check.
      await page.route('**/api/**', (route) => route.abort());
      await page.setViewportSize({ width, height: 812 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      // No theme attribute also means light, matching first-time onboarding.
      await page.goto(`${url}/?screen=${screen}`);
      const first = page.getByRole('radio', { name: /^Reduce newsletters/ });
      const second = page.getByRole('radio', { name: /^Protect important senders/ });
      await expect(first).toHaveAttribute('aria-checked', 'false');
      const unselected = await paint(first);
      expect(unselected.shadow).toContain('rgb(216, 211, 222)');
      expect(unselected.background).toBe('rgb(255, 255, 255)');
      await first.click();
      const selectedPaint = {
        shadow: 'rgb(111, 86, 138) 0px 0px 0px 2px',
        background: 'rgb(241, 236, 246)',
      };
      await expect.poll(() => paint(first)).toEqual(selectedPaint);
      await second.press('Space');
      await expect(second).toHaveAttribute('aria-checked', 'true');
      await expect(first).toHaveAttribute('aria-checked', 'false');
      await expect.poll(() => paint(first)).toEqual(unselected);
      let selected = second;
      if (screen === 'presets') {
        const preset = page.getByRole('button', { name: /Newsletter graveyard/ });
        await preset.click();
        await expect(preset).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => paint(preset)).toEqual(selectedPaint);
        await preset.click();
        await expect.poll(() => paint(preset)).toEqual(unselected);
        await preset.click();
        selected = preset;
      }
      // Selection persists when keyboard focus moves to Continue.
      const continueButton = page.getByRole('button', {
        name: screen === 'presets' ? 'Continue with 1 rule' : 'Review my first sender',
        exact: true,
      });
      await expect(continueButton).toBeEnabled();
      await continueButton.focus();
      await expect.poll(() => paint(selected)).toEqual(selectedPaint);
      await expectNoViewportOverflow(page);
      await expectNoUncontainedViewportEscape(page);

      await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
      await expect.poll(() => paint(selected)).toMatchObject({ background: 'rgb(48, 42, 50)' });
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(30, 26, 33)');
      // Computed colors and two animation frames do not guarantee settled
      // rounded-edge rasterization. Require exact stability within each state,
      // then preserve the exact comparison across stylesheet changes.
      const darkWithStyles = await settledScreenshot(page, 'dark-with-app-styles');
      await page.evaluate(() => document.querySelector<HTMLStyleElement>('#app-styles')!.remove());
      const darkWithoutStyles = await settledScreenshot(page, 'dark-without-app-styles');
      if (!darkWithoutStyles.equals(darkWithStyles)) {
        await test.info().attach('dark-with-app-styles', {
          body: darkWithStyles,
          contentType: 'image/png',
        });
        await test.info().attach('dark-without-app-styles', {
          body: darkWithoutStyles,
          contentType: 'image/png',
        });
      }
      expect(darkWithoutStyles.equals(darkWithStyles)).toBe(true);

      await page.evaluate((styles) => {
        const sheet = document.createElement('style');
        sheet.id = 'app-styles';
        sheet.textContent = styles;
        document.head.append(sheet);
        document.documentElement.dataset.theme = 'light';
      }, appTheme);
      await expect.poll(() => paint(selected)).toEqual(selectedPaint);
      // Next can retain the stylesheet after leaving the app route.
      await page.evaluate(() => document.querySelector('#dm-app-theme')!.remove());
      await expect.poll(() => paint(selected)).toMatchObject({ background: 'rgb(255, 252, 248)' });
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(246, 242, 235)');
      const publicWithStyles = await settledScreenshot(page, 'public-with-app-styles');
      await page.evaluate(() => document.querySelector('#app-styles')!.remove());
      const publicWithoutStyles = await settledScreenshot(page, 'public-without-app-styles');
      if (!publicWithoutStyles.equals(publicWithStyles)) {
        await test.info().attach('public-with-app-styles', {
          body: publicWithStyles,
          contentType: 'image/png',
        });
        await test.info().attach('public-without-app-styles', {
          body: publicWithoutStyles,
          contentType: 'image/png',
        });
      }
      expect(publicWithoutStyles.equals(publicWithStyles)).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}
