import { beforeAll, describe, expect, it } from 'vitest';

import { unsubscribeHeadersFor, unsubscribeUrl } from './unsubscribe-headers.js';
import { verifyUnsubscribeToken } from './unsubscribe-token.js';

describe('unsubscribeUrl', () => {
  beforeAll(() => {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = 'z'.repeat(32);
  });

  const input = {
    userId: '11111111-1111-4111-8111-111111111111',
    scope: 'all' as const,
    apiUrl: 'https://api.declutrmail.com',
  };

  it('targets the API unsubscribe route with a signed token', async () => {
    const url = await unsubscribeUrl(input);
    expect(url).toMatch(
      /^https:\/\/api\.declutrmail\.com\/api\/email\/unsubscribe\?t=[A-Za-z0-9._%-]+$/,
    );
  });

  it('normalises a trailing slash on apiUrl', async () => {
    const url = await unsubscribeUrl({ ...input, apiUrl: 'https://api.declutrmail.com/' });
    expect(url).toContain('https://api.declutrmail.com/api/email/unsubscribe?t=');
  });

  it('mints a token the endpoint will actually honour', async () => {
    // A URL whose token does not verify is a dead unsubscribe link —
    // the compliance failure this whole surface exists to prevent.
    const url = await unsubscribeUrl(input);
    const token = decodeURIComponent(new URL(url).searchParams.get('t') ?? '');
    expect(await verifyUnsubscribeToken(token)).toEqual({
      userId: input.userId,
      scope: 'all',
    });
  });
});

describe('unsubscribeHeadersFor', () => {
  it('emits both RFC 8058 headers around the url', () => {
    const headers = unsubscribeHeadersFor('https://api.declutrmail.com/api/email/unsubscribe?t=x');
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(headers['List-Unsubscribe']).toBe(
      '<https://api.declutrmail.com/api/email/unsubscribe?t=x>',
    );
  });
});
