import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getServerMe, hasServerAccessCookie } from './server-me';

describe('hasServerAccessCookie', () => {
  it('detects only a non-empty access cookie', () => {
    expect(hasServerAccessCookie('theme=dark; dm_access=token; dm_refresh=refresh')).toBe(true);
    expect(hasServerAccessCookie('dm_access=token.with=padding')).toBe(true);
    expect(hasServerAccessCookie('theme=dark; dm_refresh=refresh')).toBe(false);
    expect(hasServerAccessCookie('other_dm_access=token')).toBe(false);
    expect(hasServerAccessCookie('dm_access=')).toBe(false);
    expect(hasServerAccessCookie('')).toBe(false);
  });
});

describe('getServerMe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('leaves a terminal 401 for the existing client auth flow', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'UNAUTHORIZED', message: 'Session expired' } },
          { status: 401 },
        ),
      ),
    );

    await expect(getServerMe('dm_access=expired')).resolves.toBeNull();
  });

  it('falls back to the client query when the server seed is temporarily unavailable', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'INTERNAL', message: 'Temporarily unavailable' } },
          { status: 503 },
        ),
      ),
    );

    await expect(getServerMe('dm_access=unavailable')).resolves.toBeNull();
  });
});
