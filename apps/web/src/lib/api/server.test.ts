import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { serverGet } from './server';

describe('serverGet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('forwards the request cookie and unwraps a D202 envelope without caching', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const fetchSpy = vi.fn(async () =>
      Response.json({ data: { user: { id: 'user-1' } } }, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(serverGet('/api/auth/me', 'dm_access=token')).resolves.toEqual({
      user: { id: 'user-1' },
    });
    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:4000/api/auth/me', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
      headers: {
        Accept: 'application/json',
        Cookie: 'dm_access=token',
      },
    });
  });
});
