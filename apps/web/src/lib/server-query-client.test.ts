import { afterEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => sentry);

import { ServerApiError } from '@/lib/api/server';
import { settleServerQueries } from './server-query-client';

describe('settleServerQueries', () => {
  afterEach(() => {
    sentry.captureException.mockReset();
    vi.restoreAllMocks();
  });

  it('stays quiet on designed 4xx prefetch failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await settleServerQueries('senders', [
      Promise.reject(new ServerApiError(409, { error: { code: 'NO_ACTIVE_MAILBOX' } }, 'conflict')),
    ]);
    expect(warn).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports 5xx prefetch failures to Sentry and keeps the page renderable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new ServerApiError(503, {}, 'GET /api/senders failed: 503');
    await settleServerQueries('senders', [Promise.reject(error)]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { surface: 'server-hydration', hydration_surface: 'senders' },
    });
  });

  it('stays quiet when billing is intentionally disabled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await settleServerQueries('billing', [
      Promise.reject(
        new ServerApiError(503, { error: { code: 'BILLING_DISABLED' } }, 'billing disabled'),
      ),
    ]);
    expect(warn).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });
});
