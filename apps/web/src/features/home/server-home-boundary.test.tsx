import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import type { Me } from '@/features/auth/api/me-contract';
import { makeQueryClient } from '@/lib/query-client';
import { useCachedScreenerCount } from '@/features/screener/api/use-screener';
import { useHomePending } from './api/use-home-pending';
import { useHomeSummary } from './api/use-home-summary';
import { ServerHomeBoundary } from './server-home-boundary';

function HomeProbe() {
  const summary = useHomeSummary({ enabled: true });
  const pending = useHomePending({ enabled: true, tier: 'pro' });
  return (
    <div>
      {summary.isSuccess && !pending.isLoading
        ? `${summary.data.decidedSenders} cleared; ${pending.triagePending} to review; ${pending.screenerPending} new`
        : 'Loading Home'}
    </div>
  );
}

function BadgeProbe() {
  const count = useCachedScreenerCount();
  return <span>Badge: {count ?? 'pending'}</span>;
}

function stub(tier: Me['tier'] = 'pro', mailboxId: string | null = 'mb-synthetic') {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
  const fetchSpy = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/auth/me') {
      return Response.json({ data: { tier, activeMailboxId: mailboxId } });
    }
    if (path === '/api/activity/summary') {
      return Response.json({ data: { since: null, decidedSenders: 9 } });
    }
    if (path === '/api/triage/bootstrap') {
      return Response.json({ data: { queue: [], stats: {}, todaySummary: {} } });
    }
    if (path === '/api/screener/count') {
      return Response.json({ data: { pending: 3 } });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Home server hydration', () => {
  it('makes the main number and action counts immediately available without duplicate browser reads', async () => {
    const fetchSpy = stub();
    const boundary = await ServerHomeBoundary({
      cookieHeader: 'dm_access=synthetic',
      children: <HomeProbe />,
    });
    const client = makeQueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <BadgeProbe />
        {boundary}
      </QueryClientProvider>,
    );
    try {
      expect(screen.getByText('9 cleared; 0 to review; 3 new')).toBeInTheDocument();
      expect(await screen.findByText('Badge: 3')).toBeInTheDocument();
      expect(fetchSpy.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
        '/api/auth/me',
        '/api/activity/summary',
        '/api/triage/bootstrap',
        '/api/screener/count',
      ]);
      for (const [, init] of fetchSpy.mock.calls.slice(1)) {
        expect(init?.headers).toMatchObject({ 'X-Active-Mailbox-Id': 'mb-synthetic' });
      }
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it('starts all critical reads together and leaves optional workflows to the browser', async () => {
    vi.useFakeTimers();
    const fetchSpy = stub();
    const original = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation(async (input, init) => {
      if (!String(input).endsWith('/api/auth/me')) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return original(input, init);
    });
    let ready = false;
    const render = ServerHomeBoundary({
      cookieHeader: 'dm_access=synthetic',
      children: <div />,
    }).then((boundary) => {
      ready = true;
      return boundary;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(ready).toBe(true);
    expect((await render).props.state?.queries).toHaveLength(3);
  });

  it.each(['free', 'plus', 'pro'] as const)('preserves %s capability gates', async (tier) => {
    const fetchSpy = stub(tier);
    await ServerHomeBoundary({ cookieHeader: 'dm_access=synthetic', children: <div /> });
    const paths = fetchSpy.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths.includes('/api/triage/bootstrap')).toBe(true);
    expect(paths.includes('/api/screener/count')).toBe(tier !== 'free');
  });

  it('skips mailbox reads when there is no active mailbox', async () => {
    const fetchSpy = stub('pro', null);
    const boundary = await ServerHomeBoundary({
      cookieHeader: 'dm_access=synthetic',
      children: <div />,
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(boundary.props.state?.queries).toHaveLength(0);
  });

  it('does not seed Home after a rejected session', async () => {
    const fetchSpy = stub();
    fetchSpy.mockResolvedValue(Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }));
    const boundary = await ServerHomeBoundary({
      cookieHeader: 'dm_access=expired',
      children: <div />,
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(boundary.props.state?.queries).toHaveLength(0);
  });

  it('leaves failed reads absent for the existing client recovery path', async () => {
    const fetchSpy = stub();
    const original = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation((input, init) =>
      String(input).includes('/api/activity/summary')
        ? Promise.resolve(Response.json({ error: { code: 'UNAVAILABLE' } }, { status: 503 }))
        : original(input, init),
    );
    const boundary = await ServerHomeBoundary({
      cookieHeader: 'dm_access=synthetic',
      children: <div />,
    });
    expect(boundary.props.state?.queries).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('bounds a hung read and preserves successful siblings for client recovery', async () => {
    vi.useFakeTimers();
    const fetchSpy = stub();
    const original = fetchSpy.getMockImplementation()!;
    let aborted = false;
    fetchSpy.mockImplementation((input, init) => {
      if (String(input).includes('/api/activity/summary')) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
      return original(input, init);
    });
    const render = ServerHomeBoundary({ cookieHeader: 'dm_access=synthetic', children: <div /> });
    await vi.advanceTimersByTimeAsync(2_000);
    const boundary = await render;
    expect(aborted).toBe(true);
    expect(boundary.props.state?.queries).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
