import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { resolveBrandfetchIcon, type BrandfetchIconHttpPort } from './brandfetch-icon-resolver.js';
import { PermanentError, RateLimitError } from './worker-errors.js';

const PNG = readFileSync(new URL('../../../apps/web/public/icons/icon-192.png', import.meta.url));

describe('resolveBrandfetchIcon', () => {
  it('fetches the square brand icon and never sends the API key to the asset host', async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const http: BrandfetchIconHttpPort = {
      get: async (url, opts) => {
        calls.push({ url, ...(opts.authorization ? { authorization: opts.authorization } : {}) });
        if (url === 'https://api.brandfetch.io/v2/brands/domain/retailmenot.com') {
          return {
            status: 200,
            contentType: 'application/json',
            body: Buffer.from(
              JSON.stringify({
                logos: [
                  {
                    type: 'logo',
                    formats: [
                      {
                        src: 'https://cdn.brandfetch.io/horizontal.png',
                        format: 'png',
                        width: 820,
                        height: 148,
                      },
                    ],
                  },
                  {
                    type: 'icon',
                    formats: [
                      {
                        src: 'https://cdn.brandfetch.io/icon.png',
                        format: 'png',
                        width: 400,
                        height: 400,
                      },
                    ],
                  },
                ],
              }),
            ),
          };
        }
        if (url === 'https://cdn.brandfetch.io/icon.png') {
          return { status: 200, contentType: 'image/png', body: PNG };
        }
        throw new Error(`unexpected request: ${url}`);
      },
    };

    const result = await resolveBrandfetchIcon('retailmenot.com', {
      apiKey: 'secret-test-key',
      resolveHost: async () => ['93.184.216.34'],
      http,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error(result.reason);
    expect(result.mime).toBe('image/png');
    expect(result.image.readUInt32BE(16)).toBe(128);
    expect(result.image.readUInt32BE(20)).toBe(128);
    expect(result.image[25]).toBe(2);
    expect(calls).toEqual([
      {
        url: 'https://api.brandfetch.io/v2/brands/domain/retailmenot.com',
        authorization: 'Bearer secret-test-key',
      },
      { url: 'https://cdn.brandfetch.io/icon.png' },
    ]);
  });

  it('treats an unknown Brandfetch domain as a cacheable miss', async () => {
    await expect(
      resolveBrandfetchIcon('unknown.example', {
        apiKey: 'server-secret',
        resolveHost: async () => ['93.184.216.34'],
        http: { get: async () => ({ status: 404, contentType: 'application/json' }) },
      }),
    ).resolves.toEqual({ status: 'none', reason: 'brandfetch has no brand' });
  });

  it('fails terminally for an invalid server credential instead of caching a domain miss', async () => {
    await expect(
      resolveBrandfetchIcon('brand.example', {
        apiKey: 'invalid-secret',
        resolveHost: async () => ['93.184.216.34'],
        http: { get: async () => ({ status: 401, contentType: 'application/json' }) },
      }),
    ).rejects.toBeInstanceOf(PermanentError);
  });

  it('classifies quota exhaustion as retryable rate limiting', async () => {
    await expect(
      resolveBrandfetchIcon('brand.example', {
        apiKey: 'server-secret',
        resolveHost: async () => ['93.184.216.34'],
        http: { get: async () => ({ status: 429, contentType: 'application/json' }) },
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('strips authorization before following any metadata redirect', async () => {
    const authorizations: Array<string | undefined> = [];
    const result = await resolveBrandfetchIcon('brand.example', {
      apiKey: 'server-secret',
      resolveHost: async () => ['93.184.216.34'],
      http: {
        get: async (url, opts) => {
          authorizations.push(opts.authorization);
          if (url.includes('api.brandfetch.io')) {
            return {
              status: 302,
              contentType: 'text/plain',
              location: 'https://redirect.example/metadata',
            };
          }
          return { status: 404, contentType: 'application/json' };
        },
      },
    });

    expect(result.status).toBe('none');
    expect(authorizations).toEqual(['Bearer server-secret', undefined]);
  });

  it('refuses a private-network artwork URL before dialing it', async () => {
    const calls: string[] = [];
    const result = await resolveBrandfetchIcon('brand.example', {
      apiKey: 'server-secret',
      resolveHost: async (hostname) =>
        hostname === 'api.brandfetch.io' ? ['93.184.216.34'] : ['127.0.0.1'],
      http: {
        get: async (url) => {
          calls.push(url);
          return {
            status: 200,
            contentType: 'application/json',
            body: Buffer.from(
              JSON.stringify({
                logos: [
                  {
                    type: 'icon',
                    formats: [
                      {
                        src: 'https://private.example/icon.png',
                        format: 'png',
                        width: 400,
                        height: 400,
                      },
                    ],
                  },
                ],
              }),
            ),
          };
        },
      },
    });

    expect(result.status).toBe('none');
    expect(calls).toEqual(['https://api.brandfetch.io/v2/brands/domain/brand.example']);
  });
});
