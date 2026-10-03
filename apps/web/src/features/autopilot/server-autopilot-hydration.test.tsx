import { cloneElement } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, type DehydratedState } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasCapability } from '@declutrmail/shared/entitlements';

const auth = vi.hoisted(() => ({
  me: { activeMailboxId: '00000000-0000-4000-8000-000000000001', tier: 'pro' } as {
    activeMailboxId: string | null;
    tier: 'free' | 'plus' | 'pro';
  } | null,
  read: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: 'dm_access=test' }) }));
vi.mock('@/features/auth/api/server-me', () => ({ getServerMe: auth.read }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@/features/autopilot/autopilot-entitlement-surface', () => ({
  AutopilotEntitlementSurface: () => <RouteProbe />,
}));

import AutopilotPage from '@/app/(app)/autopilot/page';
import { makeQueryClient } from '@/lib/query-client';
import { ServerQueryHydration } from '@/lib/server-query-hydration';
import { resetMailboxScopedCache } from '@/features/mailboxes/api/reset-mailbox-cache';
import { useAutopilotRules } from './api/use-autopilot-rules';
import { usePendingSuggestions } from './api/use-pending-suggestions';
import { usePatternSuggestion } from './api/use-pattern-suggestion';

const mailboxId = '00000000-0000-4000-8000-000000000001';
const pendingMeta = {
  total: 73,
  pagination: { nextCursor: 'next-page', hasMore: true, limit: 50 },
};
const paths = [
  '/api/autopilot/rules',
  '/api/autopilot/pending-suggestions',
  '/api/autopilot/pattern-suggestion',
] as const;

function PremiumProbe() {
  const pending = usePendingSuggestions(auth.me?.activeMailboxId ?? null);
  const pattern = usePatternSuggestion();
  return (
    <div>
      {pending.isSuccess && pattern.isSuccess
        ? `Review ready: ${pending.data.meta?.total}`
        : 'Review loading'}
    </div>
  );
}
function RouteProbe() {
  const rules = useAutopilotRules();
  return (
    <>
      <div>{rules.isSuccess ? 'Rules ready' : 'Rules loading'}</div>
      {auth.me && hasCapability(auth.me.tier, 'autopilot') ? <PremiumProbe /> : null}
    </>
  );
}

async function hydrateRoute() {
  const route = await AutopilotPage();
  return ServerQueryHydration(route.props);
}
function hydratedKeys(boundary: Awaited<ReturnType<typeof hydrateRoute>>) {
  const state: DehydratedState = boundary.props.state;
  return state.queries.map((query) => query.queryKey);
}
function response(path: string) {
  return Response.json({
    data: path.endsWith('pattern-suggestion') ? null : [],
    meta: path.endsWith('pending-suggestions') ? pendingMeta : {},
  });
}

describe('Autopilot server hydration', () => {
  beforeEach(() => {
    auth.me = { activeMailboxId: mailboxId, tier: 'pro' };
    auth.read.mockImplementation(async () => auth.me);
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    auth.read.mockReset();
  });

  it.each(['plus', 'pro'] as const)(
    'hydrates all initial %s reads at the exact client keys, without fetching again',
    async (tier) => {
      auth.me = { activeMailboxId: mailboxId, tier };
      const fetchSpy = vi.fn(async (input: string | URL | Request) =>
        response(new URL(String(input)).pathname),
      );
      vi.stubGlobal('fetch', fetchSpy);
      const boundary = await hydrateRoute();
      expect(fetchSpy.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual(paths);
      const client = makeQueryClient();
      render(<QueryClientProvider client={client}>{boundary}</QueryClientProvider>);
      expect(screen.getByText('Rules ready')).toBeInTheDocument();
      expect(screen.getByText('Review ready: 73')).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(
        client.getQueryData(['autopilot', 'pending-suggestions', 'page', mailboxId, null]),
      ).toEqual({ data: [], meta: pendingMeta });
      client.clear();
    },
  );

  it('starts all mailbox reads together after authentication confirms scope', async () => {
    vi.useFakeTimers();
    let authenticated = false;
    const starts: number[] = [];
    auth.read.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      authenticated = true;
      return auth.me;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init: RequestInit) => {
        expect(authenticated).toBe(true);
        expect(init.headers).toMatchObject({
          Cookie: 'dm_access=test',
          'X-Active-Mailbox-Id': mailboxId,
        });
        starts.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 600));
        return response(new URL(String(input)).pathname);
      }),
    );
    const started = Date.now();
    const rendering = hydrateRoute();
    await vi.advanceTimersByTimeAsync(100);
    expect(starts).toEqual([started + 100, started + 100, started + 100]);
    await vi.advanceTimersByTimeAsync(600);
    await rendering;
  });

  it('only fetches the capability-exempt rule catalog for Free', async () => {
    auth.me = { activeMailboxId: mailboxId, tier: 'free' };
    const fetchSpy = vi.fn(async () => response(paths[0]));
    vi.stubGlobal('fetch', fetchSpy);
    const boundary = await hydrateRoute();
    render(<QueryClientProvider client={makeQueryClient()}>{boundary}</QueryClientProvider>);
    expect(screen.getByText('Rules ready')).toBeInTheDocument();
    expect(screen.queryByText(/Review ready/)).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([null, { activeMailboxId: null, tier: 'pro' as const }])(
    'skips mailbox reads without a confirmed active mailbox: %j',
    async (me) => {
      auth.me = me;
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const boundary = await hydrateRoute();
      expect(boundary.props.state.queries).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each([401, 403, 409, 500])(
    'leaves a failed pending page absent for client recovery (%i)',
    async (status) => {
      let pendingReads = 0;
      const fetchSpy = vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path === paths[1] && ++pendingReads === 1)
          return Response.json({ error: { code: 'TEST_FAILURE' } }, { status });
        return response(path);
      });
      vi.stubGlobal('fetch', fetchSpy);
      const boundary = await hydrateRoute();
      expect(pendingReads).toBe(1);
      expect(hydratedKeys(boundary)).toEqual([
        ['autopilot', 'rules'],
        ['autopilot', 'pattern-suggestion'],
      ]);
      const client = makeQueryClient();
      render(<QueryClientProvider client={client}>{boundary}</QueryClientProvider>);
      await waitFor(() => expect(screen.getByText('Review ready: 73')).toBeInTheDocument());
      expect(pendingReads).toBe(2);
      client.clear();
    },
  );

  it.each([401, 403, 409, 500])(
    'recovers a late failed stream without delaying rules (%i)',
    async (status) => {
      let pendingReads = 0;
      const fetchSpy = vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path === paths[1] && ++pendingReads === 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return Response.json({ error: { code: 'TEST_FAILURE' } }, { status });
        }
        return response(path);
      });
      vi.stubGlobal('fetch', fetchSpy);
      const boundary = await hydrateRoute();
      const state: DehydratedState = boundary.props.state;
      const transportFailure = state.queries
        .find((query) => query.queryKey[1] === 'pending-suggestions')
        ?.promise?.catch((error: unknown) => error);
      const client = makeQueryClient();
      render(<QueryClientProvider client={client}>{boundary}</QueryClientProvider>);
      expect(screen.getByText('Rules ready')).toBeInTheDocument();
      expect(screen.getByText('Review loading')).toBeInTheDocument();
      expect(pendingReads).toBe(1);
      await waitFor(() => expect(screen.getByText('Review ready: 73')).toBeInTheDocument(), {
        timeout: 2_000,
      });
      expect(pendingReads).toBe(2);
      expect(await transportFailure).toMatchObject({
        name: 'DeclutrMailStreamedQueryRecovery',
        message: 'Optional query is recovering in the browser',
      });
      expect(await transportFailure).not.toHaveProperty('body');
      client.clear();
    },
  );

  it('streams slow successful suggestions without refetching or delaying rules', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path !== paths[0]) await new Promise((resolve) => setTimeout(resolve, 100));
      return response(path);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const boundary = await hydrateRoute();
    const client = makeQueryClient();
    render(<QueryClientProvider client={client}>{boundary}</QueryClientProvider>);
    expect(screen.getByText('Rules ready')).toBeInTheDocument();
    expect(screen.getByText('Review loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Review ready: 73')).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    client.clear();
  });

  it('keeps the first page and a cursor page in separate cache entries', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.searchParams.has('cursor')) {
        return Response.json({
          data: [],
          meta: { total: 73, pagination: { nextCursor: null, hasMore: false, limit: 50 } },
        });
      }
      return response(url.pathname);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const boundary = await hydrateRoute();
    const client = makeQueryClient();
    function CursorProbe() {
      const page = usePendingSuggestions(mailboxId, 'next-page');
      return (
        <div>
          {page.isSuccess && page.data.meta?.pagination.hasMore === false
            ? 'Cursor ready'
            : 'Cursor loading'}
        </div>
      );
    }
    render(
      <QueryClientProvider client={client}>
        {boundary}
        <CursorProbe />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Cursor ready')).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(String(fetchSpy.mock.calls.at(-1)?.[0])).toBe(
      'http://localhost:4000/api/autopilot/pending-suggestions?cursor=next-page',
    );
    expect(
      client.getQueryData(['autopilot', 'pending-suggestions', 'page', mailboxId, null]),
    ).toEqual({ data: [], meta: pendingMeta });
    client.clear();
  });

  it('does not hydrate another mailbox’s pending page', async () => {
    auth.me = { activeMailboxId: '00000000-0000-4000-8000-000000000002', tier: 'pro' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => response(new URL(String(input)).pathname)),
    );
    const boundary = await hydrateRoute();
    const keys = hydratedKeys(boundary);
    expect(keys).toContainEqual([
      'autopilot',
      'pending-suggestions',
      'page',
      auth.me.activeMailboxId,
      null,
    ]);
    expect(keys).not.toContainEqual(['autopilot', 'pending-suggestions', 'page', mailboxId, null]);
  });

  it('discards an old mailbox stream when scope resets during the first load', async () => {
    const secondMailbox = '00000000-0000-4000-8000-000000000002';
    let resolveOld!: (value: Response) => void;
    let pendingReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path === paths[1]) {
          if (++pendingReads === 1)
            return new Promise<Response>((resolve) => {
              resolveOld = resolve;
            });
          return Response.json({ data: [], meta: { ...pendingMeta, total: 5 } });
        }
        return response(path);
      }),
    );
    const boundary = await hydrateRoute();
    const client = makeQueryClient();
    function MailboxProbe({ id }: { id: string }) {
      const pending = usePendingSuggestions(id);
      return (
        <p>
          {pending.isSuccess ? `Mailbox review: ${pending.data.meta?.total}` : 'Mailbox loading'}
        </p>
      );
    }
    const view = render(
      <QueryClientProvider client={client}>
        {cloneElement(boundary, { children: <MailboxProbe id={mailboxId} /> })}
      </QueryClientProvider>,
    );
    expect(screen.getByText('Mailbox loading')).toBeInTheDocument();
    view.rerender(
      <QueryClientProvider client={client}>
        {cloneElement(boundary, { children: <MailboxProbe id={secondMailbox} /> })}
      </QueryClientProvider>,
    );
    await act(async () => {
      await resetMailboxScopedCache(client);
    });
    await waitFor(() => expect(screen.getByText('Mailbox review: 5')).toBeInTheDocument());
    await act(async () => {
      resolveOld(response(paths[1]));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(
      client.getQueryData(['autopilot', 'pending-suggestions', 'page', mailboxId, null]),
    ).toBeUndefined();
    expect(
      client.getQueryData(['autopilot', 'pending-suggestions', 'page', secondMailbox, null]),
    ).toMatchObject({ meta: { total: 5 } });
    expect(screen.queryByText('Mailbox review: 73')).not.toBeInTheDocument();
    client.clear();
  });

  it('renders rules immediately, aborts a hung stream, and recovers in the client', async () => {
    vi.useFakeTimers();
    let pendingAborted = false;
    let pendingReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === paths[1] && ++pendingReads === 1) {
          return new Promise<Response>((_resolve, reject) =>
            init.signal?.addEventListener(
              'abort',
              () => {
                pendingAborted = true;
                reject(new Error('Aborted test read'));
              },
              { once: true },
            ),
          );
        }
        return response(path);
      }),
    );
    const rendering = hydrateRoute();
    await vi.advanceTimersByTimeAsync(0);
    const boundary = await rendering;
    expect(pendingAborted).toBe(false);
    const client = makeQueryClient();
    render(<QueryClientProvider client={client}>{boundary}</QueryClientProvider>);
    expect(screen.getByText('Rules ready')).toBeInTheDocument();
    expect(screen.getByText('Review loading')).toBeInTheDocument();
    expect(pendingReads).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(pendingAborted).toBe(true);
    expect(screen.getByText('Rules ready')).toBeInTheDocument();
    expect(screen.getByText('Review ready: 73')).toBeInTheDocument();
    expect(pendingReads).toBe(2);
    client.clear();
  });
});
