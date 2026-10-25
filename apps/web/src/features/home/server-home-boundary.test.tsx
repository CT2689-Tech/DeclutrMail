import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import type { Me } from '@/features/auth/api/me-contract';
import { makeQueryClient } from '@/lib/query-client';
import { useCachedScreenerCount } from '@/features/screener/api/use-screener';
import { homeKeys } from './api/query-keys';
import { useHomePending } from './api/use-home-pending';
import { useHomeSummary } from './api/use-home-summary';
import { ServerHomeBoundary } from './server-home-boundary';

function HomeProbe() {
  const summary = useHomeSummary({ enabled: true, mailboxId: 'mb-synthetic' });
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
    if (path.endsWith('/inbox-report')) {
      return Response.json({
        data: {
          generatedAt: '2026-10-01T00:00:00.000Z',
          mailboxSizeBucket: 'under_1gb',
          insights: [],
          fix: { senderKeys: [], sendersCount: 0, inboxEmailCount: 0 },
          fallbackSenderCount: 0,
          receivedCount: 0,
          totalBytes: 0,
          variant: 'fallback',
        },
      });
    }
    if (path === '/api/home/visit') {
      return Response.json({
        data: {
          visitId: '00000000-0000-4000-8000-000000000000',
          since: null,
          until: '2026-10-10T10:00:00.000Z',
          indexedEmails: null,
          indexedSenders: null,
        },
      });
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
  it('hydrates the main number and resolves client-owned tasks without duplicate reads', async () => {
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
      expect(await screen.findByText('9 cleared; 0 to review; 3 new')).toBeInTheDocument();
      expect(await screen.findByText('Badge: 3')).toBeInTheDocument();
      expect(client.getQueryData(homeKeys.summary('mb-synthetic'))).toMatchObject({
        decidedSenders: 9,
      });
      expect(client.getQueryData(homeKeys.summary())).toBeUndefined();
      expect(fetchSpy.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
        '/api/auth/me',
        '/api/activity/summary',
        '/api/mailboxes/mb-synthetic/inbox-report',
        '/api/triage/bootstrap',
        '/api/screener/count',
      ]);
      for (const [, init] of fetchSpy.mock.calls.slice(1, 2)) {
        expect(init?.headers).toMatchObject({ 'X-Active-Mailbox-Id': 'mb-synthetic' });
      }
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it('waits only for the primary summary and leaves tasks to the browser', async () => {
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
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(ready).toBe(true);
    expect((await render).props.state?.queries).toHaveLength(2);
  });

  it.each(['free', 'plus', 'pro'] as const)('preserves %s capability gates', async (tier) => {
    const fetchSpy = stub(tier);
    await ServerHomeBoundary({ cookieHeader: 'dm_access=synthetic', children: <div /> });
    const paths = fetchSpy.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths.includes('/api/triage/bootstrap')).toBe(false);
    expect(paths.includes('/api/screener/count')).toBe(false);
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
    expect(boundary.props.state?.queries).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('does not dehydrate a computed visit window when the cookie is absent', async () => {
    stub();
    const boundary = await ServerHomeBoundary({
      cookieHeader: 'dm_access=synthetic',
      children: <div />,
    });
    const client = makeQueryClient();
    const view = render(<QueryClientProvider client={client}>{boundary}</QueryClientProvider>);
    try {
      expect(client.getQueryData(homeKeys.visit('mb-synthetic'))).toBeUndefined();
      expect(client.getQueryData([...homeKeys.all, 'inbox-report', 'mb-synthetic'])).toMatchObject({
        variant: 'fallback',
        receivedCount: 0,
      });
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it('hydrates the visit peek and inbox report onto the home query keys', async () => {
    stub();
    const boundary = await ServerHomeBoundary({
      cookieHeader:
        'dm_access=synthetic; dm_home_visit=mb-synthetic:11111111-1111-4111-8111-111111111111',
      children: <div />,
    });
    const client = makeQueryClient();
    const view = render(<QueryClientProvider client={client}>{boundary}</QueryClientProvider>);
    try {
      expect(client.getQueryData(homeKeys.visit('mb-synthetic'))).toMatchObject({
        indexedEmails: null,
        indexedSenders: null,
      });
      expect(client.getQueryData([...homeKeys.all, 'inbox-report', 'mb-synthetic'])).toMatchObject({
        variant: 'fallback',
        receivedCount: 0,
      });
    } finally {
      view.unmount();
      client.clear();
    }
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
    expect(boundary.props.state?.queries).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
