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

  it('logs bounded prefetch duration and outcome metrics for page-load monitoring', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(145.6784);

    await settleServerQueries('senders', [Promise.resolve({ ok: true })]);

    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      level: 'info',
      event: 'server_hydration.prefetch',
      surface: 'senders',
      duration_ms: 45.678,
      query_count: 1,
      designed_failure_count: 0,
      unexpected_failure_count: 0,
    });
  });

  it('does not pollute latency percentiles when a boundary has no queries to run', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await settleServerQueries('senders', []);

    expect(info).not.toHaveBeenCalled();
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

  it('keeps the page renderable when optional Sentry reporting throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    sentry.captureException.mockImplementationOnce(() => {
      throw new Error('Sentry unavailable');
    });

    await expect(
      settleServerQueries('senders', [
        Promise.reject(new ServerApiError(503, {}, 'GET /api/senders failed: 503')),
      ]),
    ).resolves.toBeUndefined();
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
