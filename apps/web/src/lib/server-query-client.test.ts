import { afterEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => sentry);

import { ServerApiError } from '@/lib/api/server';
import { makeServerQueryClient, settleServerQueries } from './server-query-client';

describe('settleServerQueries', () => {
  afterEach(() => {
    sentry.captureException.mockReset();
    vi.restoreAllMocks();
  });

  it('stays quiet on designed 4xx prefetch failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await settleServerQueries(
      'senders',
      [
        Promise.reject(
          new ServerApiError(409, { error: { code: 'NO_ACTIVE_MAILBOX' } }, 'conflict'),
        ),
      ],
      makeServerQueryClient(),
    );
    expect(warn).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('logs bounded prefetch duration and outcome metrics for page-load monitoring', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(145.6784);

    await settleServerQueries('senders', [Promise.resolve({ ok: true })], makeServerQueryClient());

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

    await settleServerQueries('senders', [], makeServerQueryClient());

    expect(info).not.toHaveBeenCalled();
  });

  it('reports 5xx prefetch failures to Sentry and keeps the page renderable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new ServerApiError(503, {}, 'GET /api/senders failed: 503');
    await settleServerQueries('senders', [Promise.reject(error)], makeServerQueryClient());
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
      settleServerQueries(
        'senders',
        [Promise.reject(new ServerApiError(503, {}, 'GET /api/senders failed: 503'))],
        makeServerQueryClient(),
      ),
    ).resolves.toBeUndefined();
  });

  it('stays quiet when billing is intentionally disabled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await settleServerQueries(
      'billing',
      [
        Promise.reject(
          new ServerApiError(503, { error: { code: 'BILLING_DISABLED' } }, 'billing disabled'),
        ),
      ],
      makeServerQueryClient(),
    );
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
    const settled = settleServerQueries(
      'app-shell',
      [hung, Promise.resolve('fine')],
      makeServerQueryClient(),
    );

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

  it('CANCELS the in-flight query when the deadline fires, not just stops awaiting it', async () => {
    // The defect this exists for: `Promise.race` abandons a query, it
    // does not stop it. `serverGet` carries its own 3s abort, so an
    // abandoned read kept running for a further second while the browser
    // — handed a cache miss — refetched the same thing. The server paid
    // for the expensive read twice, and did so exactly when it was
    // already slow enough to miss a 2s deadline.
    //
    // Asserting the wrapper resolves proves nothing about that. This
    // asserts the query client was told to cancel.
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const queryClient = makeServerQueryClient();
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries').mockResolvedValue();

    const hung = new Promise<unknown>(() => {});
    const settled = settleServerQueries('app-shell', [hung], queryClient);

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(settled).resolves.toBeUndefined();

    expect(cancelQueries).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does NOT cancel when every prefetch settles inside the deadline', async () => {
    // Blind case for the guard above. Cancelling on a healthy render
    // would abort work that was about to succeed and downgrade a good
    // server render into a client fetch — the opposite of the point.
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const queryClient = makeServerQueryClient();
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries').mockResolvedValue();

    await settleServerQueries('app-shell', [Promise.resolve('quick')], queryClient);

    expect(cancelQueries).not.toHaveBeenCalled();
  });

  it('cancels once, not once per timed-out query in the batch', async () => {
    // Every query in a batch carries the same deadline, so a hung batch
    // fires N timers at the same tick. `cancelQueries()` cancels all
    // in-flight queries on the client, so calling it per query would be
    // N-1 redundant teardowns on the render path.
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const queryClient = makeServerQueryClient();
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries').mockResolvedValue();

    const settled = settleServerQueries(
      'app-shell',
      [new Promise(() => {}), new Promise(() => {}), new Promise(() => {})],
      queryClient,
    );
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(settled).resolves.toBeUndefined();

    expect(cancelQueries).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('still rejects the deadline if cancellation throws', async () => {
    // ORDERING GUARD. `cancelQueries()` walks every query's `onCancel`
    // and aborts its controller. If it ever threw synchronously and the
    // throw came BEFORE `reject`, the deadline promise would stay
    // pending forever and hang the render — the exact failure the
    // deadline exists to prevent. It cannot throw today; this makes the
    // ordering that guarantees it can never matter into a tested
    // property rather than a comment.
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const queryClient = makeServerQueryClient();
    vi.spyOn(queryClient, 'cancelQueries').mockImplementation(() => {
      throw new Error('teardown blew up');
    });

    const settled = settleServerQueries('app-shell', [new Promise(() => {})], queryClient);
    await vi.advanceTimersByTimeAsync(2_000);
    // The render proceeds. Without reject-before-cancel this never settles.
    await expect(settled).resolves.toBeUndefined();

    const logged = JSON.parse((info.mock.calls[0]?.[0] as string) ?? '{}');
    expect(logged.timed_out_count).toBe(1);
    vi.useRealTimers();
  });

  it('does not report cancelled siblings as unexpected failures', async () => {
    // THE TEST THE OTHER THREE COULD NOT BE. Those mock `cancelQueries`
    // and pass bare promises never registered in the cache, so they
    // assert that the call HAPPENED, not what it DOES — the starved-input
    // blind-guard shape. A real batch is required to see the consequence.
    //
    // Cancelling on the first timeout rejects every other in-flight query
    // with `CancelledError`. Classified naively those are "unexpected
    // failures", so one hung dependency in the 7-query app-shell batch
    // emitted 6 Sentry events and tripped the unexpected-failure alert
    // while `timed_out_count` reported 1 — both signals corrupted, in
    // opposite directions, during exactly the saturation the deadline
    // exists for.
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const queryClient = makeServerQueryClient();
    // REAL queries on a REAL client, and `cancelQueries` is NOT mocked.
    const hung = queryClient.fetchQuery({
      queryKey: ['hung'],
      queryFn: () => new Promise(() => {}),
    });
    const alsoHung = queryClient.fetchQuery({
      queryKey: ['also-hung'],
      queryFn: () => new Promise(() => {}),
    });

    const settled = settleServerQueries('app-shell', [hung, alsoHung], queryClient);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(settled).resolves.toBeUndefined();

    const logged = JSON.parse((info.mock.calls[0]?.[0] as string) ?? '{}');
    // A cancelled sibling is the same event as the timeout that caused
    // it, not a separate fault.
    expect(logged.unexpected_failure_count).toBe(0);
    expect(logged.timed_out_count).toBe(2);
    expect(sentry.captureException).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not time out a prefetch that settles inside the deadline', async () => {
    // The blind case for the guard above: if the deadline fired on
    // ordinary latency it would silently downgrade working server
    // renders into client fetches — worse for exactly the slow
    // connections it is meant to protect.
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await settleServerQueries('app-shell', [Promise.resolve('quick')], makeServerQueryClient());
    const logged = JSON.parse((info.mock.calls[0]?.[0] as string) ?? '{}');
    expect(logged.timed_out_count).toBe(0);
    expect(logged.query_count).toBe(1);
  });
});
