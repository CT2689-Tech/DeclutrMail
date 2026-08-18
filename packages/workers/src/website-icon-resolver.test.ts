import { readFileSync } from 'node:fs';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  normalizeSquareIcon,
  resolveWebsiteIcon,
  type WebsiteIconHttpPort,
} from './website-icon-resolver.js';

const PNG = readFileSync(new URL('../../../apps/web/public/icons/icon-192.png', import.meta.url));

describe('resolveWebsiteIcon', () => {
  it('returns an official Apple Touch icon advertised by the brand website', async () => {
    const calls: string[] = [];
    const http: WebsiteIconHttpPort = {
      get: async (url) => {
        calls.push(url);
        if (url === 'https://brand.example/') {
          return {
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: Buffer.from(
              '<html><head><link href="/brand.png" sizes="180x180" rel="apple-touch-icon"></head></html>',
            ),
          };
        }
        if (url === 'https://brand.example/brand.png') {
          return { status: 200, contentType: 'image/png', body: PNG };
        }
        return { status: 404, contentType: 'text/plain' };
      },
    };

    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async () => ['93.184.216.34'],
      http,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error(result.reason);
    expect(result.mime).toBe('image/png');
    expect(result.image.byteLength).toBeGreaterThan(0);
    expect(result.image.readUInt32BE(16)).toBe(128);
    expect(result.image.readUInt32BE(20)).toBe(128);
    // PNG colour type 2 is opaque RGB. Transparent marks would let the
    // monogram letter show through underneath the logo layer.
    expect(result.image[25]).toBe(2);
    expect(calls).toEqual(['https://brand.example/', 'https://brand.example/brand.png']);
  });

  it('decodes HTML entities in advertised icon URLs', async () => {
    const calls: string[] = [];
    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async () => ['93.184.216.34'],
      http: {
        get: async (url) => {
          calls.push(url);
          if (url === 'https://brand.example/') {
            return {
              status: 200,
              contentType: 'text/html',
              body: Buffer.from(
                '<link rel="apple-touch-icon" href="/brand.png?width=180&amp;height=180">',
              ),
            };
          }
          if (url === 'https://brand.example/brand.png?width=180&height=180') {
            return { status: 200, contentType: 'image/png', body: PNG };
          }
          return { status: 404, contentType: 'text/plain' };
        },
      },
    });

    expect(result.status).toBe('ok');
    expect(calls).toEqual([
      'https://brand.example/',
      'https://brand.example/brand.png?width=180&height=180',
    ]);
  });

  it('prefers the largest advertised Apple Touch icon', async () => {
    const calls: string[] = [];
    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async () => ['93.184.216.34'],
      http: {
        get: async (url) => {
          calls.push(url);
          if (url === 'https://brand.example/') {
            return {
              status: 200,
              contentType: 'text/html',
              body: Buffer.from(
                '<link rel="apple-touch-icon" sizes="57x57" href="/tiny.png">' +
                  '<link rel="apple-touch-icon" sizes="180x180" href="/large.png">',
              ),
            };
          }
          if (url === 'https://brand.example/large.png') {
            return { status: 200, contentType: 'image/png', body: PNG };
          }
          return { status: 404, contentType: 'text/plain' };
        },
      },
    });

    expect(result.status).toBe('ok');
    expect(calls).toEqual(['https://brand.example/', 'https://brand.example/large.png']);
  });

  it('does not fetch a manifest when an advertised touch icon succeeds', async () => {
    const calls: string[] = [];
    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async () => ['93.184.216.34'],
      http: {
        get: async (url) => {
          calls.push(url);
          if (url === 'https://brand.example/') {
            return {
              status: 200,
              contentType: 'text/html',
              body: Buffer.from(
                '<link rel="apple-touch-icon" href="/brand.png">' +
                  '<link rel="manifest" href="/app.webmanifest">',
              ),
            };
          }
          if (url === 'https://brand.example/brand.png') {
            return { status: 200, contentType: 'image/png', body: PNG };
          }
          throw new Error(`unexpected request: ${url}`);
        },
      },
    });

    expect(result.status).toBe('ok');
    expect(calls).toEqual(['https://brand.example/', 'https://brand.example/brand.png']);
  });

  it('falls back to the largest square web-app manifest icon', async () => {
    const calls: string[] = [];
    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async () => ['93.184.216.34'],
      http: {
        get: async (url) => {
          calls.push(url);
          if (url === 'https://brand.example/') {
            return {
              status: 200,
              contentType: 'text/html',
              body: Buffer.from('<link rel="manifest" href="/app.webmanifest">'),
            };
          }
          if (url === 'https://brand.example/app.webmanifest') {
            return {
              status: 200,
              contentType: 'application/manifest+json',
              body: Buffer.from(
                JSON.stringify({
                  icons: [
                    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                  ],
                }),
              ),
            };
          }
          if (url === 'https://brand.example/icon-512.png') {
            return { status: 200, contentType: 'image/png', body: PNG };
          }
          return { status: 404, contentType: 'text/plain' };
        },
      },
    });

    expect(result.status).toBe('ok');
    expect(calls).toEqual([
      'https://brand.example/',
      'https://brand.example/app.webmanifest',
      'https://brand.example/icon-512.png',
    ]);
  });

  it('uses a high-resolution standard icon when no touch icon or manifest exists', async () => {
    const calls: string[] = [];
    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async () => ['93.184.216.34'],
      http: {
        get: async (url) => {
          calls.push(url);
          if (url === 'https://brand.example/') {
            return {
              status: 200,
              contentType: 'text/html',
              body: Buffer.from(
                '<link rel="icon" sizes="32x32" href="/small.png">' +
                  '<link rel="icon" sizes="192x192" href="/android.png">',
              ),
            };
          }
          if (url === 'https://brand.example/android.png') {
            return { status: 200, contentType: 'image/png', body: PNG };
          }
          return { status: 404, contentType: 'text/plain' };
        },
      },
    });

    expect(result.status).toBe('ok');
    expect(calls).toEqual(['https://brand.example/', 'https://brand.example/android.png']);
  });

  it('accepts a usable 32px favicon instead of falling back to a monogram', async () => {
    const favicon = await sharp({
      create: { width: 32, height: 32, channels: 4, background: '#0a7a68' },
    })
      .png()
      .toBuffer();
    const calls: string[] = [];
    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async () => ['93.184.216.34'],
      http: {
        get: async (url) => {
          calls.push(url);
          if (url === 'https://brand.example/') {
            return {
              status: 200,
              contentType: 'text/html',
              body: Buffer.from('<link rel="icon" sizes="32x32" href="/favicon.png">'),
            };
          }
          if (url === 'https://brand.example/favicon.png') {
            return { status: 200, contentType: 'image/png', body: favicon };
          }
          return { status: 404, contentType: 'text/plain' };
        },
      },
    });

    expect(result.status).toBe('ok');
    expect(calls).toEqual(['https://brand.example/', 'https://brand.example/favicon.png']);
  });

  it('accepts a mildly rectangular application mark as a last-resort logo', async () => {
    const mark = await sharp({
      create: { width: 48, height: 32, channels: 4, background: '#0a7a68' },
    })
      .png()
      .toBuffer();

    const normalized = await normalizeSquareIcon(mark);

    expect(normalized).not.toBeNull();
    expect(normalized?.readUInt32BE(16)).toBe(128);
    expect(normalized?.readUInt32BE(20)).toBe(128);
  });

  it('accepts a self-contained SVG favicon and rasterizes it before storage', async () => {
    const calls: string[] = [];
    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async () => ['93.184.216.34'],
      http: {
        get: async (url) => {
          calls.push(url);
          if (url === 'https://brand.example/') {
            return {
              status: 200,
              contentType: 'text/html',
              body: Buffer.from(
                '<link rel="icon" type="image/svg+xml" sizes="any" href="/favicon.svg">',
              ),
            };
          }
          if (url === 'https://brand.example/favicon.svg') {
            return {
              status: 200,
              contentType: 'image/svg+xml',
              body: Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#0a7a68"/></svg>',
              ),
            };
          }
          return { status: 404, contentType: 'text/plain' };
        },
      },
    });

    expect(result.status).toBe('ok');
    expect(calls).toEqual(['https://brand.example/', 'https://brand.example/favicon.svg']);
  });

  it('rejects active content inside a website SVG before rasterization', async () => {
    const calls: string[] = [];
    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async () => ['93.184.216.34'],
      http: {
        get: async (url) => {
          calls.push(url);
          if (url === 'https://brand.example/') {
            return {
              status: 200,
              contentType: 'text/html',
              body: Buffer.from(
                '<link rel="icon" type="image/svg+xml" sizes="any" href="/favicon.svg">',
              ),
            };
          }
          if (url === 'https://brand.example/favicon.svg') {
            return {
              status: 200,
              contentType: 'image/svg+xml',
              body: Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script></svg>',
              ),
            };
          }
          return { status: 404, contentType: 'text/plain' };
        },
      },
    });

    expect(result.status).toBe('none');
    expect(calls).toEqual([
      'https://brand.example/',
      'https://brand.example/favicon.svg',
      'https://brand.example/apple-touch-icon.png',
    ]);
  });

  it('still rejects tracking-pixel-sized artwork', async () => {
    const pixel = await sharp({
      create: { width: 1, height: 1, channels: 4, background: '#0a7a68' },
    })
      .png()
      .toBuffer();

    await expect(normalizeSquareIcon(pixel)).resolves.toBeNull();
  });

  it('propagates a manifest network failure instead of caching a false miss', async () => {
    await expect(
      resolveWebsiteIcon('brand.example', {
        resolveHost: async () => ['93.184.216.34'],
        http: {
          get: async (url) => {
            if (url === 'https://brand.example/') {
              return {
                status: 200,
                contentType: 'text/html',
                body: Buffer.from('<link rel="manifest" href="/app.webmanifest">'),
              };
            }
            throw new Error('socket timeout');
          },
        },
      }),
    ).rejects.toThrow(/socket timeout/);
  });

  it('tries the conventional Apple Touch path when metadata is absent', async () => {
    const calls: string[] = [];
    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async () => ['93.184.216.34'],
      http: {
        get: async (url) => {
          calls.push(url);
          if (url === 'https://brand.example/') {
            return { status: 200, contentType: 'text/html', body: Buffer.from('<html></html>') };
          }
          if (url === 'https://brand.example/apple-touch-icon.png') {
            return { status: 200, contentType: 'image/png', body: PNG };
          }
          return { status: 404, contentType: 'text/plain' };
        },
      },
    });

    expect(result.status).toBe('ok');
    expect(calls).toEqual(['https://brand.example/', 'https://brand.example/apple-touch-icon.png']);
  });

  it('treats a genuinely unresolvable website as a cacheable miss', async () => {
    const dnsError = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });

    const result = await resolveWebsiteIcon('missing.example', {
      resolveHost: async () => {
        throw dnsError;
      },
      http: {
        get: async () => {
          throw new Error('must not dial without a validated address');
        },
      },
    });

    expect(result).toEqual({ status: 'none', reason: 'website http 0' });
  });

  it('rejects an image response that crossed the byte ceiling', async () => {
    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async () => ['93.184.216.34'],
      http: {
        get: async (url) => {
          if (url === 'https://brand.example/') {
            return {
              status: 200,
              contentType: 'text/html',
              body: Buffer.from('<link rel="apple-touch-icon" href="/oversize.png">'),
            };
          }
          return { status: 200, contentType: 'image/png', body: PNG, tooLarge: true };
        },
      },
    });

    expect(result).toEqual({ status: 'none', reason: 'website icon oversize' });
  });

  it('revalidates redirects and refuses a private-network hop before dialing it', async () => {
    const calls: string[] = [];
    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async (hostname) =>
        hostname === 'brand.example' ? ['93.184.216.34'] : ['169.254.169.254'],
      http: {
        get: async (url) => {
          calls.push(url);
          if (url === 'https://brand.example/') {
            return {
              status: 302,
              contentType: 'text/html',
              location: 'https://metadata.example/latest',
            };
          }
          throw new Error('private redirect was dialed');
        },
      },
    });

    expect(result.status).toBe('none');
    expect(calls).toEqual(['https://brand.example/']);
  });

  it('retries the canonical www host when the bare homepage is blocked', async () => {
    const calls: string[] = [];
    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async () => ['93.184.216.34'],
      http: {
        get: async (url) => {
          calls.push(url);
          if (url === 'https://brand.example/') {
            return { status: 403, contentType: 'text/html' };
          }
          if (url === 'https://www.brand.example/') {
            return {
              status: 200,
              contentType: 'text/html',
              body: Buffer.from('<link rel="apple-touch-icon" href="/brand.png">'),
            };
          }
          if (url === 'https://www.brand.example/brand.png') {
            return { status: 200, contentType: 'image/png', body: PNG };
          }
          return { status: 404, contentType: 'text/plain' };
        },
      },
    });

    expect(result.status).toBe('ok');
    expect(calls).toEqual([
      'https://brand.example/',
      'https://www.brand.example/',
      'https://www.brand.example/brand.png',
    ]);
  });

  it('does not mistake a square social-card image for a brand icon', async () => {
    const calls: string[] = [];
    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async () => ['93.184.216.34'],
      http: {
        get: async (url) => {
          calls.push(url);
          if (url === 'https://brand.example/') {
            return {
              status: 200,
              contentType: 'text/html',
              body: Buffer.from(
                '<meta name="twitter:image" content="https://cdn.example/brand-square.png">',
              ),
            };
          }
          if (url === 'https://cdn.example/brand-square.png') {
            return { status: 200, contentType: 'image/png', body: PNG };
          }
          return { status: 404, contentType: 'text/plain' };
        },
      },
    });

    expect(result.status).toBe('none');
    expect(calls).toEqual(['https://brand.example/', 'https://brand.example/apple-touch-icon.png']);
  });

  it('uses an explicit application tile image when icon links are absent', async () => {
    const calls: string[] = [];
    const result = await resolveWebsiteIcon('brand.example', {
      resolveHost: async () => ['93.184.216.34'],
      http: {
        get: async (url) => {
          calls.push(url);
          if (url === 'https://brand.example/') {
            return {
              status: 200,
              contentType: 'text/html',
              body: Buffer.from('<meta name="msapplication-TileImage" content="/brand-tile.png">'),
            };
          }
          if (url === 'https://brand.example/brand-tile.png') {
            return { status: 200, contentType: 'image/png', body: PNG };
          }
          return { status: 404, contentType: 'text/plain' };
        },
      },
    });

    expect(result.status).toBe('ok');
    expect(calls).toEqual(['https://brand.example/', 'https://brand.example/brand-tile.png']);
  });

  it('retries transient homepage failures instead of caching a month-long miss', async () => {
    await expect(
      resolveWebsiteIcon('brand.example', {
        resolveHost: async () => ['93.184.216.34'],
        http: {
          get: async (url) => ({
            status: url === 'https://brand.example/' ? 503 : 404,
            contentType: 'text/html',
          }),
        },
      }),
    ).rejects.toThrow(/website homepage.*503/i);
  });

  it('retries when every advertised icon fails transiently', async () => {
    await expect(
      resolveWebsiteIcon('brand.example', {
        resolveHost: async () => ['93.184.216.34'],
        http: {
          get: async (url) => {
            if (url === 'https://brand.example/') {
              return {
                status: 200,
                contentType: 'text/html',
                body: Buffer.from('<link rel="apple-touch-icon" href="/brand.png">'),
              };
            }
            if (url === 'https://brand.example/brand.png') {
              return { status: 429, contentType: 'image/png' };
            }
            return { status: 404, contentType: 'text/plain' };
          },
        },
      }),
    ).rejects.toThrow(/website icon.*429/i);
  });
});
