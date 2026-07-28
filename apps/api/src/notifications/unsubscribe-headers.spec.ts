import { beforeAll, describe, expect, it } from 'vitest';

import { unsubscribeHeaders } from './unsubscribe-headers.js';

describe('unsubscribeHeaders', () => {
  beforeAll(() => {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = 'z'.repeat(32);
  });

  it('emits both RFC 8058 headers', async () => {
    const headers = await unsubscribeHeaders({
      userId: 'u-1',
      category: 'reminders',
      apiUrl: 'https://api.declutrmail.com',
    });
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(headers['List-Unsubscribe']).toMatch(
      /^<https:\/\/api\.declutrmail\.com\/api\/email\/unsubscribe\?t=.+>$/,
    );
  });
});
