import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ServerApiError, serverApiErrorDisplayId, serverGet } from './server';

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

  it('scopes an explicit mailbox read with the same header as the browser client', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const fetchSpy = vi.fn(async () => Response.json({ data: { readiness: 'ready' } }));
    vi.stubGlobal('fetch', fetchSpy);

    await serverGet('/api/v1/sync/status', 'dm_access=token', undefined, {
      mailboxId: 'mailbox-2',
    });

    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:4000/api/v1/sync/status', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
      headers: {
        Accept: 'application/json',
        Cookie: 'dm_access=token',
        'X-Active-Mailbox-Id': 'mailbox-2',
      },
    });
  });
});

describe('serverApiErrorDisplayId', () => {
  it('reads the envelope displayId off a ServerApiError', () => {
    const err = new ServerApiError(
      409,
      { error: { code: 'PROTECTED_SENDER', displayId: 'DM-7F2A91' } },
      'boom',
    );
    expect(serverApiErrorDisplayId(err)).toBe('DM-7F2A91');
  });

  it('returns null for a non-ServerApiError', () => {
    expect(serverApiErrorDisplayId(new Error('boom'))).toBeNull();
  });

  it('returns null when the body carries no error envelope', () => {
    const err = new ServerApiError(500, 'plain text', 'boom');
    expect(serverApiErrorDisplayId(err)).toBeNull();
  });
});
