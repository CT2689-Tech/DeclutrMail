import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator } from '@playwright/test';
import { expectNoUncontainedViewportEscape, expectNoViewportOverflow } from '../helpers/a11y';

const requireFromShared = createRequire(new URL('../../shared/package.json', import.meta.url));
const esbuild = createRequire(requireFromShared.resolve('vite/package.json'))('esbuild') as {
  build(options: Record<string, unknown>): Promise<{
    outputFiles: Array<{ path: string; text: string }>;
  }>;
};
const { outputFiles } = await esbuild.build({
  absWorkingDir: fileURLToPath(new URL('../../../apps/web', import.meta.url)),
  bundle: true,
  jsx: 'automatic',
  platform: 'browser',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  entryPoints: ['src/test/settings-controls.fixture.tsx'],
  outfile: 'fixture.js',
  write: false,
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
// The same real controls can be checked manually in Codex's built-in browser.
if (process.env.DM_SETTINGS_CONTROLS_DIR) {
  mkdirSync(process.env.DM_SETTINGS_CONTROLS_DIR, { recursive: true });
  for (const [name, value] of [
    ['index.html', html],
    ['fixture.js', client],
    ['fixture.css', css],
  ])
    writeFileSync(`${process.env.DM_SETTINGS_CONTROLS_DIR}/${name}`, value!);
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
const paint = (control: Locator) =>
  control.evaluate((element) => {
    const track = getComputedStyle(element.querySelector('.dm-switch-track')!);
    const knob = getComputedStyle(element.querySelector('.dm-switch-knob')!);
    return { track: track.backgroundColor, outline: track.boxShadow, knob: knob.backgroundColor };
  });

for (const width of [320, 375, 1280]) {
  test(`Settings controls stay clear, functional and isolated to app light at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) => route.abort());
    await page.setViewportSize({ width, height: 812 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url);
    const reminder = page.getByRole('switch', { name: 'Reminder emails', exact: true });
    const disabled = page.getByRole('switch', { name: 'Unavailable preference', exact: true });
    const essential = page.getByRole('radio', { name: /^Essential only/ });
    const accept = page.getByRole('radio', { name: /^Accept all/ });
    const offPaint = {
      track: 'rgba(45, 38, 48, 0.055)',
      outline: 'rgb(107, 100, 115) 0px 0px 0px 1px inset',
      knob: 'rgb(107, 100, 115)',
    };
    await expect.poll(() => paint(reminder)).toEqual(offPaint);
    await expect(disabled).toBeDisabled();
    await expect(disabled).toHaveAttribute('aria-checked', 'false');
    await expect(disabled).toHaveCSS('opacity', '0.45');
    await expect(essential).toBeChecked();
    await expect(essential).toHaveCSS('accent-color', 'rgb(111, 86, 138)');

    await reminder.press('Space');
    await expect(reminder).toHaveAttribute('aria-checked', 'true');
    await expect
      .poll(() => paint(reminder))
      .toEqual({
        track: 'rgb(111, 86, 138)',
        outline: 'none',
        knob: 'rgb(255, 255, 255)',
      });
    await reminder.click();
    await expect.poll(() => paint(reminder)).toEqual(offPaint);
    await accept.click();
    await expect(accept).toBeChecked();
    await essential.press('Space');
    await expect(essential).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('dm-cookie-consent'))).toBe('essential');
    await expectNoViewportOverflow(page);
    await expectNoUncontainedViewportEscape(page);

    for (const mode of ['dark', 'public']) {
      await page.evaluate((mode) => {
        if (mode === 'dark') document.documentElement.dataset.theme = 'dark';
        else {
          document.documentElement.dataset.theme = 'light';
          document.querySelector('#dm-app-theme')!.remove();
        }
      }, mode);
      await expect(essential).toHaveCSS('accent-color', 'auto');
      const withStyles = await page.screenshot({ animations: 'disabled' });
      await page.evaluate(() => document.querySelector<HTMLStyleElement>('#app-styles')!.remove());
      expect((await page.screenshot({ animations: 'disabled' })).equals(withStyles)).toBe(true);
      await page.evaluate((styles) => {
        const sheet = document.createElement('style');
        sheet.id = 'app-styles';
        sheet.textContent = styles;
        document.head.append(sheet);
      }, appTheme);
    }
    await page.evaluate(() => {
      const marker = document.createElement('span');
      marker.id = 'dm-app-theme';
      marker.hidden = true;
      document.body.prepend(marker);
    });
    await expect.poll(() => paint(reminder)).toEqual(offPaint);
    await expect(essential).toHaveCSS('accent-color', 'rgb(111, 86, 138)');
    expect(errors).toEqual([]);
  });
}
