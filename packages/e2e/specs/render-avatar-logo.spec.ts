// Avatar brand-logo failure states — asserted in a REAL browser.
//
// WHY THIS SPEC EXISTS. ADR-0034 rests on one promise: the monogram is
// the floor, so a sender whose logo is missing looks exactly like one
// that never had a logo. That promise shipped broken. The logo layer
// was an `<img>` carrying an opaque background, and `/api/icons/:domain`
// answers **204 on a cold cache** — the state every domain is in until
// a worker fills it. Chromium paints a broken-image placeholder for a
// failed sized image, and the opaque background painted over the
// monogram regardless. Every avatar on the Senders page became a
// broken-image glyph on a blank tile.
//
// Every layer of the suite was green. `avatar.test.tsx` asserted the
// monogram was in the MARKUP (it was) and that an `<img>` existed (it
// did). SSR markup assertions cannot see a browser's failed-image
// painting, and no test in the repo had ever loaded this component in
// an engine that fetches images. That is the gap this file closes, and
// it is the only reason it is worth its runtime.
//
// ## The assertion
//
// For each state we screenshot the avatar, then REMOVE the logo layer
// from the DOM and screenshot the same element again:
//
//   - 204 / 401 / connection refused → the two shots must be
//     BYTE-IDENTICAL. A failed logo layer must paint nothing whatever,
//     so deleting it changes no pixel.
//   - 200 with a real mark          → they must DIFFER, and the mark
//     must cover the monogram.
//
// No baseline images, no pixel decoding, no control markup: the page is
// its own control. On the shipped-and-broken component every failure
// case fails this, which is the property a regression test needs.
//
// ## Self-contained
//
// A local server renders the REAL `Avatar` (SSR, exactly as the web app
// emits it) and answers `/api/icons/*` with whichever state the test is
// exercising. No stack, no database, no Gmail, no auth — `storageState`
// is explicitly cleared so this runs anywhere Chromium does.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * The REAL component's SSR output, rendered in a child process under
 * `tsx` — Playwright's own transform compiles JSX with a
 * component-testing factory React cannot render, so this cannot be done
 * in-process. `brandLogos` and the API base are read at module scope
 * (build-time constants in the browser bundle), hence the child env; an
 * empty API base keeps the icon URL relative so it resolves against
 * this spec's own server.
 */
function ssrAvatar(name: string, domain: string, size: number): string {
  return execFileSync(
    `${here}../../../node_modules/.bin/tsx`,
    [`${here}../helpers/ssr-avatar.ts`, name, domain, String(size)],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NEXT_PUBLIC_DM_FLAG_BRAND_LOGOS: 'true',
        NEXT_PUBLIC_API_URL: '',
        // The shared package's tsconfig is the one declaring the React
        // JSX runtime; without it tsx compiles `avatar.tsx` against the
        // classic runtime and the render dies on `React is not defined`.
        TSX_TSCONFIG_PATH: `${here}../../shared/tsconfig.json`,
      },
    },
  );
}

const AVATAR_MARKUP = [
  ['Chase', 'chase.com', 40],
  ['Bank of America', 'bankofamerica.com', 24],
  ['Airbnb', 'airbnb.com', 28],
  ['Figma', 'figma.com', 72],
]
  .map(([name, domain, size]) => ssrAvatar(String(name), String(domain), Number(size)))
  .join('');
const TOKENS_CSS = readFileSync(
  new URL('../../shared/src/styles/tokens.css', import.meta.url),
  'utf8',
);

/** A mark that is unmistakable against the pale neutral monogram. */
const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" fill="#0b6"/>' +
  '<circle cx="32" cy="32" r="16" fill="#fff"/></svg>';

type IconState = 'miss' | 'rejected' | 'hit';

/**
 * Serve one page containing real `Avatar` instances at every production
 * size, plus the icon endpoint in the requested state. The 40px Chase
 * fixture stays first because the logo paint tests use it as their target.
 */
async function serveAvatar(state: IconState): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    if (req.url?.startsWith('/api/icons/')) {
      if (state === 'miss') {
        // Exactly what the real endpoint returns for an uncached
        // domain — i.e. every domain, on first render.
        res.writeHead(204);
        return res.end();
      }
      if (state === 'rejected') {
        // The route is public now, but a proxy/auth regression must
        // still reveal the monogram instead of an empty/broken tile.
        res.writeHead(401);
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      return res.end(LOGO_SVG);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    const theme = new URL(req.url ?? '/', 'http://avatar.test').searchParams.get('theme');
    res.end(
      `<!doctype html><html data-theme="${theme === 'dark' ? 'dark' : 'light'}">` +
        `<meta charset="utf-8"><style>${TOKENS_CSS}</style>` +
        `<body style="margin:0;padding:24px;background:var(--dm-bg);display:flex;align-items:center;gap:20px">${AVATAR_MARKUP}</body></html>`,
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Chromium may keep the last icon/page socket alive. Waiting
        // for that idle connection makes this otherwise self-contained
        // paint spec hang nondeterministically after its assertions.
        server.closeAllConnections();
      }),
  };
}

/**
 * Screenshot the avatar, drop the logo layer, screenshot it again.
 * Returns both shots plus how many layers were found — a component that
 * stopped emitting a layer at all would otherwise pass vacuously.
 */
async function shotWithAndWithoutLogoLayer(page: Page) {
  const avatar = page.locator('[aria-hidden="true"]').first();
  await expect(avatar).toBeVisible();
  // Give the icon request time to complete (or fail) before the first
  // shot — otherwise "paints nothing" is true only because nothing has
  // been attempted yet.
  await page.waitForLoadState('networkidle');

  const before = await avatar.screenshot();
  const layers = await avatar.evaluate((el) => {
    const found = Array.from(el.children).filter((c) =>
      /background-image/.test(c.getAttribute('style') ?? ''),
    );
    found.forEach((c) => c.remove());
    return found.length;
  });
  const after = await avatar.screenshot();
  return { before, after, layers };
}

// Nothing here touches the app, the API or a session.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Avatar brand logo (ADR-0034) — real-browser paint', () => {
  test('the premium monogram treatment holds at every production size in both themes', async ({
    page,
  }) => {
    const { url, close } = await serveAvatar('miss');
    try {
      const readTiles = () =>
        page.locator('[aria-hidden="true"]').evaluateAll((nodes) =>
          nodes.map((node) => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return {
              size: rect.width,
              background: style.backgroundImage,
              border: style.borderColor,
              shadow: style.boxShadow,
              weight: style.fontWeight,
            };
          }),
        );

      await page.goto(`${url}?theme=light`);
      const light = await readTiles();
      expect(light.map(({ size }) => size)).toEqual([40, 24, 28, 72]);
      expect(
        light.every(
          ({ background, border, shadow, weight }) =>
            background.includes('linear-gradient') &&
            border !== 'rgba(0, 0, 0, 0)' &&
            shadow !== 'none' &&
            weight === '600',
        ),
      ).toBe(true);

      await page.goto(`${url}?theme=dark`);
      const dark = await readTiles();
      expect(dark.map(({ size }) => size)).toEqual([40, 24, 28, 72]);
      expect(new Set(light.map(({ background }) => background))).toHaveProperty('size', 1);
      expect(new Set(dark.map(({ background }) => background))).toHaveProperty('size', 1);
      expect(new Set(dark.map(({ border }) => border))).toHaveProperty('size', 1);
      expect(dark.map(({ background }) => background)).not.toEqual(
        light.map(({ background }) => background),
      );
    } finally {
      await close();
    }
  });

  for (const state of ['miss', 'rejected'] as const) {
    test(`a ${state} icon response paints nothing over the monogram`, async ({ page }) => {
      const { url, close } = await serveAvatar(state);
      try {
        await page.goto(url);
        const { before, after, layers } = await shotWithAndWithoutLogoLayer(page);

        expect(layers, 'the logo layer should have been attempted at all').toBe(1);
        // THE regression assertion. With the shipped `<img>` layer this
        // differs: Chromium paints a broken-image placeholder, and the
        // layer's opaque background covers the monogram underneath.
        expect(
          before.equals(after),
          'a failed logo layer must paint nothing — the monogram is the floor',
        ).toBe(true);

        // No `<img>` at all: its failure state is the placeholder glyph.
        expect(await page.locator('img').count()).toBe(0);
      } finally {
        await close();
      }
    });
  }

  test('an unreachable icon endpoint paints nothing over the monogram', async ({ page }) => {
    // Offline / DNS failure / dropped connection — the same floor.
    const { url, close } = await serveAvatar('miss');
    try {
      await page.route('**/api/icons/**', (route) => route.abort('connectionrefused'));
      await page.goto(url);
      const { before, after } = await shotWithAndWithoutLogoLayer(page);
      expect(before.equals(after)).toBe(true);
    } finally {
      await close();
    }
  });

  test('a cached mark renders and covers the monogram', async ({ page }) => {
    const { url, close } = await serveAvatar('hit');
    try {
      await page.goto(url);

      // Read the layer's own URL BEFORE the shot helper removes it, and
      // confirm it is our endpoint serving real image bytes — otherwise
      // "the shots differ" could be satisfied by any paint at all.
      const served = await page.evaluate(async () => {
        const layer = document.querySelector<HTMLElement>('[style*="background-image"]');
        const src = layer?.style.backgroundImage.match(/url\("([^"]+)"\)/)?.[1];
        if (src === undefined) return null;
        const res = await fetch(src);
        return { path: new URL(src, location.href).pathname, status: res.status };
      });
      expect(served).toEqual({ path: '/api/icons/chase.com', status: 200 });

      const geometry = await page
        .locator('[aria-hidden="true"]')
        .first()
        .evaluate((avatar) => {
          const layer = avatar.querySelector<HTMLElement>('[style*="background-image"]');
          if (!layer) return null;
          const avatarRect = avatar.getBoundingClientRect();
          const layerRect = layer.getBoundingClientRect();
          return {
            avatar: {
              x: avatarRect.x,
              y: avatarRect.y,
              width: avatarRect.width,
              height: avatarRect.height,
            },
            layer: {
              x: layerRect.x,
              y: layerRect.y,
              width: layerRect.width,
              height: layerRect.height,
            },
            backgroundSize: getComputedStyle(layer).backgroundSize,
          };
        });
      expect(geometry?.layer).toEqual(geometry?.avatar);
      expect(geometry?.backgroundSize).toBe('cover');

      const { before, after, layers } = await shotWithAndWithoutLogoLayer(page);

      expect(layers).toBe(1);
      // The positive case: the layer is doing its job, so the two shots
      // must differ. Without this, "paints nothing" would pass on a
      // component that never renders a logo at all.
      expect(before.equals(after), 'a cached mark must actually paint').toBe(false);
    } finally {
      await close();
    }
  });
});
