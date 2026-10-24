import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const tokens = readFileSync(new URL('../../shared/src/styles/tokens.css', import.meta.url), 'utf8');
const appTheme = readFileSync(
  new URL('../../../apps/web/src/features/theme/app-light-theme.css', import.meta.url),
  'utf8',
);

test.use({ storageState: { cookies: [], origins: [] } });

// Load the actual styles with the same route marker as the server layouts.
// Keep the app stylesheet loaded across route changes, as Next does, and
// render a body-level dialog to exercise portal inheritance.
test('light appearance follows the app route and leaves public/dark paint unchanged', async ({
  page,
}) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8">
      <style>${tokens}</style><style id="app-styles">${appTheme}</style>
      </head><body><span id="dm-app-theme" hidden></span>
      <main><h1 style="font-family:var(--dm-font-display)">Senders</h1>
      <span class="dm-sidebar-logo"><span style="font-family:var(--dm-font-display)">DeclutrMail</span></span>
      <p style="color:var(--dm-fg-muted)">Review your senders</p></main>
      <section role="dialog" aria-label="Archive preview" style="background:var(--dm-card)">
      <h2 style="font-family:var(--dm-font-display)">Archive preview</h2>
      <button style="background:var(--dm-primary);color:var(--dm-fg-inverse)">Archive</button>
      <p style="background:var(--dm-primary);color:var(--dm-fg-inverse-muted)">Review before applying</p>
      </section></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    const readAppearance = () =>
      page.evaluate(() => {
        const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
        return {
          background: style('body').backgroundColor,
          card: style('[role="dialog"]').backgroundColor,
          accent: style('button').backgroundColor,
          headingFont: style('h1').fontFamily,
          dialogFont: style('h2').fontFamily,
          brandFont: style('.dm-sidebar-logo > span').fontFamily,
        };
      });
    const light = await readAppearance();
    expect(light.background).toBe('rgb(247, 246, 249)');
    expect(light.card).toBe('rgb(255, 255, 255)');
    expect(light.accent).toBe('rgb(111, 86, 138)');
    expect(light.headingFont).toContain('Geist');
    expect(light.dialogFont).toBe(light.headingFont);
    expect(light.brandFont).toContain('Fraunces');
    const contrast = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    expect(contrast.violations).toEqual([]);

    // Public navigation removes the layout marker, even while its CSS remains.
    await page.evaluate(() => document.querySelector('#dm-app-theme')!.remove());
    await expect.poll(readAppearance).toMatchObject({
      background: 'rgb(246, 242, 235)',
      card: 'rgb(255, 252, 248)',
      accent: 'rgb(89, 65, 95)',
    });
    const publicWithStyles = await page.screenshot();
    await page.evaluate(() => document.querySelector<HTMLStyleElement>('#app-styles')!.remove());
    expect((await page.screenshot()).equals(publicWithStyles)).toBe(true);

    // Dark mode must retain every pixel, including display type and shadows.
    await page.evaluate((css) => {
      const stylesheet = document.createElement('style');
      stylesheet.id = 'app-styles';
      stylesheet.textContent = css;
      document.head.append(stylesheet);
      const marker = document.createElement('span');
      marker.id = 'dm-app-theme';
      marker.hidden = true;
      document.body.prepend(marker);
      document.documentElement.dataset.theme = 'dark';
    }, appTheme);
    // Reduced motion still allows a brief theme transition. Capture its
    // settled palette so the exact image comparison cannot race that paint.
    await expect.poll(readAppearance).toMatchObject({
      background: 'rgb(30, 26, 33)',
      card: 'rgb(48, 42, 50)',
      accent: 'rgb(209, 184, 214)',
    });
    const darkWithStyles = await page.screenshot();
    expect((await readAppearance()).headingFont).toContain('Fraunces');
    await page.evaluate(() => document.querySelector('#app-styles')!.remove());
    expect((await page.screenshot()).equals(darkWithStyles)).toBe(true);

    // Switching back to explicit light restores the approved palette.
    await page.evaluate((css) => {
      const stylesheet = document.createElement('style');
      stylesheet.textContent = css;
      document.head.append(stylesheet);
      document.documentElement.dataset.theme = 'light';
    }, appTheme);
    await expect.poll(readAppearance).toEqual(light);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
