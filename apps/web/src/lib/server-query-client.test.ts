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
      timed_out_count: 0,
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
  it('bounds a hung prefetch so it cannot hold the whole page hostage', async () => {
    // Every authed route awaits its prefetch set before the first byte
    // of HTML. A query that never settles used to hang that render
    // forever — `Promise.allSettled` waits for all of them and never
    // rejects, so nothing here could observe it.
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    // A promise that NEVER settles — the case the deadline exists for.
    const hung = new Promise<unknown>(() => {});
    const settled = settleServerQueries('app-shell', [hung, Promise.resolve('fine')]);

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(settled).resolves.toBeUndefined();

    const logged = JSON.parse((info.mock.calls[0]?.[0] as string) ?? '{}');
    expect(logged.timed_out_count).toBe(1);
    // A timeout is NOT an unexpected failure — it must not inflate the
    // metric that pages on real prefetch errors.
    expect(logged.unexpected_failure_count).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('deadline'));
    // A hang is a capacity signal, not a per-render exception.
    expect(sentry.captureException).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not time out a prefetch that settles inside the deadline', async () => {
    // The blind case for the guard above: if the deadline fired on
    // ordinary latency it would silently downgrade working server
    // renders into client fetches — worse for exactly the slow
    // connections it is meant to protect.
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await settleServerQueries('app-shell', [Promise.resolve('quick')]);
    const logged = JSON.parse((info.mock.calls[0]?.[0] as string) ?? '{}');
    expect(logged.timed_out_count).toBe(0);
    expect(logged.query_count).toBe(1);
  });
});
