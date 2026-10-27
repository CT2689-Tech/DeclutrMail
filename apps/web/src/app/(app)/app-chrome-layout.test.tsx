/**
 * Tests for the `(app)` group layout's branch ladder (D134 split +
 * U-NAV integration mounts).
 *
 * Ladder under test (see the layout docblock):
 *
 *   1. While `GET /api/auth/me` is in flight, the layout renders the
 *      auth skeleton and NEVER its children — no flash of unauthed
 *      content on app routes.
 *
 *   2. A 401 bounces the browser to the OAuth start endpoint exactly
 *      as before the split, still without rendering children.
 *
 *   3. Onboarding gate (D6/D109/D113): `onboardedAt === null` replaces
 *      the route with `/onboarding` and renders no app chrome.
 *
 *   4. Deletion-pending (D216): the GracePeriodBanner renders above
 *      the shell while a request is pending — and stays absent on the
 *      happy path.
 *
 *   5. Happy path: children render inside the shell, and the nav
 *      keeps Cleanup as one Senders destination, with review modes
 *      owned by its workspace rather than repeated shell tabs.
 *
 *   6. Screener badge (D74/D77): the count query fires ONLY for tiers
 *      with the `screener` capability — a Free session must never
 *      hit an endpoint the server would 402.
 */

import {
  dehydrate,
  focusManager,
  HydrationBoundary,
  onlineManager,
  QueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { toast as sharedToast } from '@declutrmail/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ONBOARDING_STATE_KEY } from '@/features/onboarding/api/query-options';
import { DEFAULT_SENDERS_QUERY } from '@/features/senders/api/query-options';
import { sendersKeys } from '@/features/senders/api/query-keys';
import { useSenders } from '@/features/senders/api/use-senders';
import { makeQueryClient } from '@/lib/query-client';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, type FetchStubHandler } from '@/test/fetch-stub';

const {
  pushSpy,
  prefetchSpy,
  replaceSpy,
  refreshSpy,
  undoTrayPropsSpy,
  pathnameRef,
  searchParamsRef,
  toastSpy,
} = vi.hoisted(() => ({
  pushSpy: vi.fn(),
  prefetchSpy: vi.fn(),
  replaceSpy: vi.fn(),
  refreshSpy: vi.fn(),
  undoTrayPropsSpy: vi.fn(),
  // Mutable so tests can drive the pathname-dependent branch (the
  // user-scoped-route fallback under no active mailbox). Defaults to a
  // mailbox-scoped route so every pre-existing test is unaffected.
  pathnameRef: { current: '/senders' },
  searchParamsRef: { current: '' },
  // Records every toast while still showing it, so a test can assert that
  // one never fired even when no toast host is mounted.
  toastSpy: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushSpy,
    prefetch: prefetchSpy,
    replace: replaceSpy,
    refresh: refreshSpy,
  }),
  usePathname: () => pathnameRef.current,
  useSearchParams: () => new URLSearchParams(searchParamsRef.current),
}));
vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<{ toast: typeof sharedToast }>();
  return {
    ...actual,
    toast: (...args: Parameters<typeof sharedToast>) => {
      toastSpy(...args);
      actual.toast(...args);
    },
  };
});
vi.mock('@/features/triage/triage-undo-tray', () => ({
  ProductUndoTray: (props: { enableShortcut?: boolean; mailboxId?: string }) => {
    undoTrayPropsSpy(props);
    return <div data-testid="triage-undo-tray" />;
  },
}));

import { SCREENER_COUNT_POLL_MS } from '@/features/screener/api/use-screener';

import { AppChromeLayout as AppLayout } from './app-chrome-layout';
import { MAILBOX_SCOPE_RESET_EVENT } from '@/features/mailboxes/api/reset-mailbox-cache';

// A stale expanded preference must not change the approved five-group rail.
beforeEach(() => {
  window.localStorage.setItem('dm.sidebar.collapsed', 'false');
});

afterEach(() => {
  window.localStorage.removeItem('dm.sidebar.collapsed');
  vi.restoreAllMocks();
  pushSpy.mockClear();
  prefetchSpy.mockClear();
  replaceSpy.mockClear();
  refreshSpy.mockClear();
  undoTrayPropsSpy.mockClear();
  pathnameRef.current = '/senders';
  searchParamsRef.current = '';
});

function renderLayout(client = createTestQueryClient()) {
  const layout = () => (
    <QueryWrapper client={client}>
      <AppLayout>
        <span>authed app body</span>
      </AppLayout>
    </QueryWrapper>
  );
  const result = render(layout());
  return {
    ...result,
    client,
    rerenderAt(pathname: string) {
      pathnameRef.current = pathname;
      result.rerender(layout());
    },
  };
}

async function openUtilityNavigation() {
  await userEvent.click(await screen.findByRole('button', { name: 'Open navigation menu' }));
  return screen.getByRole('dialog', { name: 'Navigation menu' });
}

function cleanupRailButton() {
  return within(screen.getByRole('navigation', { name: 'Product navigation' })).getByRole(
    'button',
    { name: 'Cleanup' },
  );
}

async function expectPendingReviewCount(count: number) {
  await vi.waitFor(() =>
    expect(cleanupRailButton()).toHaveAttribute(
      'aria-description',
      expect.stringContaining(`${count} senders awaiting first review`),
    ),
  );
  expect(screen.getByTestId('nav-dot-senders')).toBeInTheDocument();
}

function ok(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Stubs for a fully-authed render. `onboardedAt` / `deletionRequest`
 * select the ladder branch under test; `tier` (default `pro`) selects
 * the screener-badge gating branch (D74/D77).
 */
function authedHandlers(opts: {
  onboardedAt: string | null;
  deletionRequest?: { effectiveAt: string; status: 'pending' | 'executing' };
  tier?: 'free' | 'plus' | 'pro';
  laterRecovery?: unknown;
}): FetchStubHandler[] {
  return [
    {
      method: 'GET',
      path: '/api/auth/me',
      respond: () =>
        ok({
          data: {
            user: { id: 'u-1', email: 'founder@example.test', workspaceId: 'ws-1' },
            mailboxes: [
              {
                id: 'mb-1',
                email: 'founder@example.test',
                status: 'active',
                connectedAt: '2026-01-01T00:00:00.000Z',
                readiness: 'ready',
              },
            ],
            activeMailboxId: 'mb-1',
            tier: opts.tier ?? 'pro',
            cleanupRemaining: opts.tier === 'free' ? 5 : null,
          },
        }),
    },
    {
      method: 'GET',
      path: '/api/onboarding/state',
      respond: () => ok({ data: { onboardedAt: opts.onboardedAt } }),
    },
    {
      method: 'GET',
      path: '/api/senders',
      respond: () => ok({ data: [], meta: { pagination: { hasMore: false, nextCursor: null } } }),
    },
    {
      method: 'GET',
      path: '/api/senders/summary',
      respond: () =>
        ok({
          data: {
            totalSenders: 1,
            activeSenders: 9,
            cleanupActiveSenders: 1,
            last30dVolume: 0,
            noiseReducible: 0,
            protected: 0,
            needsReview: 0,
            byBucket: {
              one_time: 0,
              protect: 0,
              people: 0,
              needs_review: 0,
              quiet: 0,
              dormant: 0,
              bulk: 0,
              other: 1,
            },
            asOf: '2026-08-16T00:00:00.000Z',
          },
        }),
    },
    {
      method: 'GET',
      path: '/api/account/deletion',
      respond: () =>
        ok({
          data: {
            request: opts.deletionRequest
              ? {
                  id: 'adr-1',
                  requestedAt: '2026-06-10T00:00:00.000Z',
                  effectiveAt: opts.deletionRequest.effectiveAt,
                  basis: 'flat-grace',
                  waiverConfirmed: false,
                  status: opts.deletionRequest.status,
                }
              : null,
            projection: {
              flatGraceAt: '2026-06-19T00:00:00.000Z',
              latestUndoExpiresAt: null,
              activeUndoCount: 0,
              projectedEffectiveAt: '2026-06-19T00:00:00.000Z',
              projectedBasis: 'flat-grace',
            },
          },
        }),
    },
    {
      method: 'GET',
      path: '/api/snoozed/recovery',
      respond: () =>
        ok({
          data: opts.laterRecovery ?? { affectedCount: 0, firstIssue: null },
        }),
    },
    {
      method: 'GET',
      path: '/api/home/visit',
      respond: () =>
        ok({
          data: {
            visitId: '00000000-0000-4000-8000-000000000000',
            since: null,
            until: '2026-01-02T00:00:00.000Z',
            indexedEmails: null,
            indexedSenders: null,
          },
        }),
    },
    {
      method: 'POST',
      path: '/api/home/visit',
      respond: () =>
        ok({
          data: {
            visitId: 'visit-1',
            since: null,
            until: '2026-01-02T00:00:00.000Z',
            indexedEmails: null,
            indexedSenders: null,
          },
        }),
    },
  ];
}

describe('(app) layout auth boundary — D134', () => {
  it('renders the auth skeleton, not children, while /api/auth/me is in flight', () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/auth/me',
        // Never resolves — pins the in-flight state.
        respond: () => new Promise<Response>(() => undefined),
      },
    ]);

    renderLayout();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('authed app body')).not.toBeInTheDocument();
  });

  it('bounces a 401 to the OAuth start endpoint without rendering children', async () => {
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);

    installFetchStub([
      {
        method: 'POST',
        path: '/api/auth/refresh',
        respond: () => new Response(null, { status: 401 }),
      },
      {
        method: 'GET',
        path: '/api/auth/me',
        respond: () =>
          new Response(JSON.stringify({ error: { code: 'unauthenticated' } }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);

    renderLayout();

    // `assign` fires during render while the 401 error persists, so a
    // re-render may call it more than once — assert presence + target,
    // not an exact count.
    await vi.waitFor(() => {
      expect(assignSpy).toHaveBeenCalled();
    });
    expect(String(assignSpy.mock.calls[0]![0])).toContain('/sign-in?returning=1');
    expect(screen.queryByText('authed app body')).not.toBeInTheDocument();
  });
});

describe('(app) layout integration mounts — U-NAV', () => {
  it('keeps a streamed route list independent from the shell summary count', async () => {
    const sendersSpy = vi.fn((_request: Request, _url: URL) =>
      ok({ data: [], meta: { pagination: { hasMore: false, nextCursor: null } } }),
    );
    installFetchStub(
      authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }).map((handler) =>
        handler.path === '/api/senders' ? { ...handler, respond: sendersSpy } : handler,
      ),
    );

    const serverClient = makeQueryClient();
    serverClient.setQueryData(sendersKeys.list(DEFAULT_SENDERS_QUERY), {
      pages: [
        {
          data: [{}],
          meta: {
            pagination: { hasMore: false, nextCursor: null },
            query: {
              globalMaxTotal: 0,
              totalMatching: 0,
              filterCounts: {},
              asOf: '2026-08-16T00:00:00.000Z',
            },
          },
        },
      ],
      pageParams: [undefined],
    });

    function StreamedSendersRoute() {
      const [arrived, setArrived] = useState(false);
      useEffect(() => setArrived(true), []);
      return arrived ? (
        <HydrationBoundary state={dehydrate(serverClient)}>
          <SendersRouteProbe />
        </HydrationBoundary>
      ) : null;
    }

    function SendersRouteProbe() {
      const senders = useSenders(DEFAULT_SENDERS_QUERY);
      return <span>{senders.isSuccess ? 'hydrated senders route' : 'senders loading'}</span>;
    }

    render(
      <QueryWrapper client={makeQueryClient()}>
        <AppLayout>
          <StreamedSendersRoute />
        </AppLayout>
      </QueryWrapper>,
    );

    expect(await screen.findByText('hydrated senders route')).toBeInTheDocument();
    expect(sendersSpy).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      const nav = within(screen.getByRole('navigation', { name: 'Product navigation' }));
      expect(nav.getByRole('button', { name: 'Cleanup' })).toHaveAttribute(
        'aria-description',
        expect.stringContaining('Senders: 1'),
      );
      expect(screen.getByTestId('nav-dot-senders')).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Cleanup views' })).not.toBeInTheDocument();
    });
  });

  it('falls back to one route-owned browser request when server prefetch data is absent', async () => {
    const sendersSpy = vi.fn((_request: Request, _url: URL) =>
      ok({
        data: [],
        meta: {
          pagination: { hasMore: false, nextCursor: null },
          query: {
            globalMaxTotal: 0,
            totalMatching: 0,
            filterCounts: {},
            asOf: '2026-08-16T00:00:00.000Z',
          },
        },
      }),
    );
    installFetchStub(
      authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }).map((handler) =>
        handler.path === '/api/senders' ? { ...handler, respond: sendersSpy } : handler,
      ),
    );

    function SendersRouteProbe() {
      const senders = useSenders(DEFAULT_SENDERS_QUERY);
      return <span>{senders.isSuccess ? 'route fallback ready' : 'route fallback loading'}</span>;
    }

    render(
      <QueryWrapper client={makeQueryClient()}>
        <AppLayout>
          <SendersRouteProbe />
        </AppLayout>
      </QueryWrapper>,
    );

    expect(await screen.findByText('route fallback ready')).toBeInTheDocument();
    expect(sendersSpy).toHaveBeenCalledOnce();
  });

  it('keeps the nav summary unfiltered on a filtered senders URL', async () => {
    searchParamsRef.current = 'q=amazon.com';
    const summarySpy = vi.fn((_request: Request, _url: URL) =>
      ok({
        data: {
          totalSenders: 1,
          activeSenders: 9,
          cleanupActiveSenders: 1,
          last30dVolume: 0,
          noiseReducible: 0,
          protected: 0,
          needsReview: 0,
          byBucket: {},
          asOf: '2026-08-16T00:00:00.000Z',
        },
      }),
    );
    installFetchStub(
      authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }).map((handler) =>
        handler.path === '/api/senders/summary' ? { ...handler, respond: summarySpy } : handler,
      ),
    );

    renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    await vi.waitFor(() => expect(summarySpy).toHaveBeenCalledOnce());
    expect(summarySpy.mock.calls[0]![1].toString()).not.toContain('q=');
  });

  it.each([
    [
      '/triage?connect_error=connect_failed',
      '/onboarding?connect_error=connect_failed&returnTo=%2Ftriage',
    ],
    [
      '/triage?connect_error=something-new',
      '/onboarding?connect_error=connect_failed&returnTo=%2Ftriage',
    ],
    ['/senders?sender=s-123', '/onboarding?returnTo=%2Fsenders%3Fsender%3Ds-123'],
  ])('preserves the intent from %s through onboarding', async (from, to) => {
    const setURL = (u: string) =>
      (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(u);
    setURL(`http://localhost${from}`);
    pathnameRef.current = from.split('?')[0]!;
    installFetchStub(authedHandlers({ onboardedAt: null }));
    try {
      renderLayout();
      await vi.waitFor(() => expect(replaceSpy).toHaveBeenCalledWith(to));
      expect(toastSpy).not.toHaveBeenCalled();
    } finally {
      setURL('http://localhost/senders');
    }
  });

  it.each(['/settings', '/settings/privacy', '/settings/help', '/billing'])(
    'keeps %s accessible before onboarding finishes',
    async (path) => {
      pathnameRef.current = path;
      installFetchStub(authedHandlers({ onboardedAt: null }));
      const { client } = renderLayout();
      await act(async () => {
        await vi.waitFor(() =>
          expect(client.getQueryData(ONBOARDING_STATE_KEY)).toMatchObject({ onboardedAt: null }),
        );
      });
      expect(screen.getByText('authed app body')).toBeInTheDocument();
      expect(replaceSpy).not.toHaveBeenCalled();
    },
  );

  it('keeps mailbox-scoped sender policies gated before onboarding finishes', async () => {
    pathnameRef.current = '/settings/senders';
    (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(
      'http://localhost/settings/senders',
    );
    installFetchStub(authedHandlers({ onboardedAt: null }));
    renderLayout();
    await vi.waitFor(() =>
      expect(replaceSpy).toHaveBeenCalledWith('/onboarding?returnTo=%2Fsettings%2Fsenders'),
    );
    expect(screen.queryByText('authed app body')).not.toBeInTheDocument();
    (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(
      'http://localhost/senders',
    );
  });

  it('refreshes the router when the active mailbox scope resets', async () => {
    installFetchStub(authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }));
    renderLayout();
    expect(await screen.findByText('authed app body')).toBeInTheDocument();

    window.dispatchEvent(new Event(MAILBOX_SCOPE_RESET_EVENT));

    expect(refreshSpy).toHaveBeenCalledOnce();
  });

  it('renders five fixed workspace groups, section routes and the settings shortcut without a banner', async () => {
    installFetchStub([
      ...authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }),
      {
        method: 'GET',
        path: '/api/screener/count',
        respond: () => ok({ data: { pending: 0 } }),
      },
    ]);

    renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    // jsdom applies no CSS, so the mobile tab bar renders alongside the
    // sidebar — scope to the sidebar's landmark.
    const nav = within(screen.getByRole('navigation', { name: 'Product navigation' }));
    expect(nav.getAllByRole('button').map((row) => row.getAttribute('aria-label'))).toEqual([
      'Home',
      'Cleanup',
      'Automations',
      'Catch up',
      'Activity',
    ]);
    expect(nav.getByRole('button', { name: 'Cleanup' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: /expand sidebar|collapse sidebar/i })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Cleanup views' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Triage' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Screener' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    const primary = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(primary.getAllByRole('button').map((row) => row.getAttribute('aria-label'))).toEqual([
      'Home',
      'Cleanup',
      'Automations',
      'Catch up',
      'Activity',
    ]);
    expect(primary.queryByRole('button', { name: 'More' })).toBeNull();
    // The trust strip is gone from the top bar.
    expect(screen.queryByRole('button', { name: 'Undo windows' })).not.toBeInTheDocument();
    // Recovery follows the active mailbox across the whole app shell,
    // not only the Triage route.
    expect(screen.getByTestId('triage-undo-tray')).toBeInTheDocument();
    expect(undoTrayPropsSpy).toHaveBeenCalledWith({
      enableShortcut: false,
      mailboxId: 'mb-1',
    });
    // No deletion pending → no banner.
    expect(screen.queryByTestId('deletion-grace-banner')).not.toBeInTheDocument();
  });

  it('keeps Cleanup in Senders and other feature groups in contextual navigation', async () => {
    installFetchStub(authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }));
    const { rerenderAt } = renderLayout();
    await screen.findByText('authed app body');
    const groups = [
      { label: 'Home', route: '/home', destinations: [] },
      {
        label: 'Cleanup',
        route: '/senders',
        destinations: [],
      },
      {
        label: 'Automations',
        route: '/autopilot',
        destinations: [],
      },
      {
        label: 'Catch up',
        route: '/brief',
        destinations: [
          ['Daily Brief', '/brief'],
          ['Follow-ups', '/followups'],
          ['Later', '/later'],
        ],
      },
      { label: 'Activity', route: '/activity', destinations: [] },
    ] as const;
    for (const group of groups) {
      const primary = within(screen.getByRole('navigation', { name: 'Primary' }));
      await userEvent.click(primary.getByRole('button', { name: group.label }));
      expect(pushSpy).toHaveBeenLastCalledWith(group.route);
      rerenderAt(group.route);
      if (group.label === 'Cleanup') {
        expect(screen.queryByRole('navigation', { name: 'Cleanup views' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Triage' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Screener' })).not.toBeInTheDocument();
      }
      expect(primary.getByRole('button', { name: group.label })).toHaveAttribute(
        'aria-current',
        'page',
      );
      for (const [label, route] of group.destinations) {
        const section = within(screen.getByRole('navigation', { name: `${group.label} views` }));
        await userEvent.click(section.getByRole('button', { name: new RegExp(`^${label}`) }));
        expect(pushSpy).toHaveBeenLastCalledWith(route);
        rerenderAt(route);
        expect(section.getByRole('button', { name: new RegExp(`^${label}`) })).toHaveAttribute(
          'aria-current',
          'page',
        );
      }
    }
  });

  it('keeps account, billing and help reachable through the mobile utility menu', async () => {
    installFetchStub(authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }));
    renderLayout();
    await screen.findByText('authed app body');
    for (const [label, route] of [
      ['Manage Gmail accounts', '/settings#mailboxes'],
      ['Settings', '/settings'],
      ['Plan & billing', '/billing'],
      ['Help & glossary', '/settings/help'],
    ]) {
      const dialog = await openUtilityNavigation();
      expect(within(dialog).queryByRole('navigation', { name: 'Product navigation' })).toBeNull();
      expect(within(dialog).getByText('founder@example.test')).toBeVisible();
      expect(within(dialog).getByRole('button', { name: 'Close navigation menu' })).toBeVisible();
      await userEvent.click(within(dialog).getByRole('button', { name: new RegExp(label!) }));
      expect(pushSpy).toHaveBeenLastCalledWith(route);
      expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).toBeNull();
    }
  });

  it('maps the internal snoozed nav key to canonical /later and keeps it active', async () => {
    pathnameRef.current = '/later';
    installFetchStub([
      ...authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }),
      {
        method: 'GET',
        path: '/api/screener/count',
        respond: () => ok({ data: { pending: 0 } }),
      },
    ]);

    const user = userEvent.setup();
    renderLayout();

    const laterNav = await screen.findByRole('button', { name: 'Later' });
    expect(laterNav).toHaveAttribute('aria-current', 'page');
    await user.click(laterNav);
    expect(pushSpy).toHaveBeenCalledWith('/later');
  });

  it('prefetches a section destination on intent before navigation', async () => {
    pathnameRef.current = '/brief';
    installFetchStub([
      ...authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }),
      {
        method: 'GET',
        path: '/api/screener/count',
        respond: () => ok({ data: { pending: 0 } }),
      },
    ]);

    const user = userEvent.setup();
    renderLayout();

    const nav = await screen.findByRole('navigation', { name: 'Catch up views' });
    const quietNav = within(nav).getByRole('button', { name: 'Follow-ups' });
    await user.hover(quietNav);

    expect(prefetchSpy).toHaveBeenCalledWith('/followups');
    expect(pushSpy).not.toHaveBeenCalled();

    await user.click(quietNav);
    expect(pushSpy).toHaveBeenCalledWith('/followups');
  });

  it('mounts the grace-period banner above the shell while a deletion is pending (D216)', async () => {
    installFetchStub(
      authedHandlers({
        onboardedAt: '2026-01-02T00:00:00.000Z',
        deletionRequest: { effectiveAt: '2026-06-19T00:00:00.000Z', status: 'pending' },
      }),
    );

    renderLayout();

    expect(await screen.findByTestId('deletion-grace-banner')).toBeInTheDocument();
    expect(screen.getByText(/Account deletion scheduled for/)).toBeInTheDocument();
    // The banner is additive — the app stays usable behind it.
    expect(screen.getByText('authed app body')).toBeInTheDocument();
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});

describe('(app) layout — screener badge tier gating (D74/D77)', () => {
  it('lets Home own the count while its route is streaming and observes the hydrated nav summary', async () => {
    pathnameRef.current = '/home';
    const countSpy = vi.fn(() => ok({ data: { pending: 3 } }));
    installFetchStub([
      ...authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z', tier: 'pro' }),
      { method: 'GET', path: '/api/screener/count', respond: countSpy },
    ]);
    const client = createTestQueryClient();
    render(
      <QueryWrapper client={client}>
        <AppLayout>
          <span>Home route pending</span>
        </AppLayout>
      </QueryWrapper>,
    );
    expect(await screen.findByText('Home route pending')).toBeInTheDocument();
    expect(countSpy).not.toHaveBeenCalled();
    expect(client.getQueryState(['screener', 'count'])).toBeUndefined();

    await act(async () => {
      client.setQueryData(['screener', 'count'], { pending: 3 });
    });
    const nav = within(screen.getByRole('navigation', { name: 'Product navigation' }));
    expect(nav.getByRole('button', { name: 'Cleanup' })).toHaveAttribute(
      'aria-description',
      expect.stringContaining('3 senders awaiting first review'),
    );
    expect(countSpy).not.toHaveBeenCalled();
  });

  it('renders the pending-count badge for a Pro workspace', async () => {
    installFetchStub([
      ...authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z', tier: 'pro' }),
      {
        method: 'GET',
        path: '/api/screener/count',
        respond: () => ok({ data: { pending: 3 } }),
      },
    ]);

    renderLayout();

    await screen.findByText('authed app body');
    await expectPendingReviewCount(3);
  });

  it('polls the Screener count again after the tab is hidden and shown while online', async () => {
    let reads = 0;
    installFetchStub([
      ...authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z', tier: 'pro' }),
      {
        method: 'GET',
        path: '/api/screener/count',
        respond: () => {
          reads += 1;
          return ok({ data: { pending: reads === 1 ? 3 : 4 } });
        },
      },
    ]);
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 0,
          gcTime: 60_000,
          // Production turns focus refetch off. Resume has to be the
          // interval tick, or a hidden tab that cleared the timer never
          // polls again.
          refetchOnWindowFocus: false,
        },
        mutations: { retry: false },
      },
    });
    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    const setVisibility = (value: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    };
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    setVisibility('visible');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { client: mounted } = renderLayout(client);
      await screen.findByText('authed app body');
      await expectPendingReviewCount(3);
      const baseline = reads;
      expect(baseline).toBeGreaterThan(0);

      setVisibility('hidden');
      await act(async () => {
        mounted.setQueryData(['screener', 'count'], (current: unknown) =>
          current === undefined ? current : { ...(current as object) },
        );
        await vi.advanceTimersByTimeAsync(SCREENER_COUNT_POLL_MS);
      });
      expect(reads).toBe(baseline);
      expect(cleanupRailButton()).toHaveAttribute(
        'aria-description',
        expect.stringContaining('3 senders awaiting first review'),
      );

      setVisibility('visible');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SCREENER_COUNT_POLL_MS);
      });
      expect(reads).toBe(baseline + 1);
      await expectPendingReviewCount(4);
    } finally {
      vi.useRealTimers();
      focusManager.setFocused(undefined);
      onlineManager.setOnline(true);
      if (originalVisibility)
        Object.defineProperty(document, 'visibilityState', originalVisibility);
    }
  });

  it('renders no badge at zero pending — a calm sidebar is the resting state', async () => {
    installFetchStub([
      ...authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z', tier: 'pro' }),
      {
        method: 'GET',
        path: '/api/screener/count',
        respond: () => ok({ data: { pending: 0 } }),
      },
    ]);

    const { client } = renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(client.getQueryData(['screener', 'count'])).toEqual({ pending: 0 }),
    );
    expect(cleanupRailButton()).not.toHaveAttribute(
      'aria-description',
      expect.stringContaining('awaiting first review'),
    );
  });

  it('NEVER fires the count query for an under-tier workspace (the server would 402)', async () => {
    const countSpy = vi.fn(() => ok({ data: { pending: 3 } }));
    installFetchStub([
      ...authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z', tier: 'free' }),
      { method: 'GET', path: '/api/screener/count', respond: countSpy },
    ]);

    renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    // Cleanup stays reachable, while its first-review view owns the upsell.
    // The shell never issues a doomed count query for an under-tier workspace.
    expect(cleanupRailButton()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Screener' })).not.toBeInTheDocument();
    expect(countSpy).not.toHaveBeenCalled();
    expect(cleanupRailButton()).not.toHaveAttribute(
      'aria-description',
      expect.stringContaining('awaiting first review'),
    );
  });
});

describe('(app) layout — passive sync-error banner (D224)', () => {
  it('mounts the banner above the shell when the latest sync outcome is a fresh error', async () => {
    installFetchStub([
      ...authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }),
      {
        method: 'GET',
        path: '/api/screener/count',
        respond: () => ok({ data: { pending: 0 } }),
      },
      {
        method: 'GET',
        path: '/api/v1/sync/status',
        respond: () =>
          ok({
            data: {
              readiness_status: 'ready',
              current_stage: 'ready',
              progress_pct: 100,
              is_ready_for_triage: true,
              last_synced_at: null,
              last_sync_error_at: new Date(Date.now() - 5 * 60_000).toISOString(),
              last_sync_error_code: 'GMAIL_HISTORY_GONE',
            },
          }),
      },
    ]);

    renderLayout();

    expect(await screen.findByTestId('sync-error-banner')).toBeInTheDocument();
    // Additive — the app stays usable behind it.
    expect(screen.getByText('authed app body')).toBeInTheDocument();
    // Retryable failures retain the manual recovery action.
    expect(screen.getByRole('button', { name: /check gmail for new emails/i })).toBeInTheDocument();
  });

  it('shows reconnect recovery without a doomed Sync-now action for an invalid grant', async () => {
    const syncStatusSpy = vi.fn(() =>
      ok({
        data: {
          readiness_status: 'ready',
          current_stage: 'ready',
          progress_pct: 100,
          is_ready_for_triage: true,
          last_synced_at: new Date(Date.now() - 30 * 60_000).toISOString(),
          last_sync_error_at: new Date(Date.now() - 5 * 60_000).toISOString(),
          last_sync_error_code: 'InvalidGrantError',
        },
      }),
    );
    installFetchStub([
      ...authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }),
      {
        method: 'GET',
        path: '/api/screener/count',
        respond: () => ok({ data: { pending: 0 } }),
      },
      {
        method: 'GET',
        path: '/api/v1/sync/status',
        respond: syncStatusSpy,
      },
    ]);

    renderLayout();

    expect(await screen.findByRole('button', { name: 'Reconnect Gmail' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /check gmail for new emails/i }),
    ).not.toBeInTheDocument();
    // Banner + topbar consume the same mailbox-keyed React Query entry.
    expect(syncStatusSpy).toHaveBeenCalledTimes(1);
  });
});

describe('(app) layout — one banner slot', () => {
  it('shows only the highest-priority banner; the rest wait behind "+N more"', async () => {
    const user = userEvent.setup();
    installFetchStub([
      ...authedHandlers({
        onboardedAt: '2026-01-02T00:00:00.000Z',
        deletionRequest: { effectiveAt: '2026-06-19T00:00:00.000Z', status: 'pending' },
      }),
      {
        method: 'GET',
        path: '/api/screener/count',
        respond: () => ok({ data: { pending: 0 } }),
      },
      {
        method: 'GET',
        path: '/api/v1/sync/status',
        respond: () =>
          ok({
            data: {
              readiness_status: 'ready',
              current_stage: 'ready',
              progress_pct: 100,
              is_ready_for_triage: true,
              last_synced_at: null,
              last_sync_error_at: new Date(Date.now() - 5 * 60_000).toISOString(),
              last_sync_error_code: 'GMAIL_HISTORY_GONE',
            },
          }),
      },
    ]);

    renderLayout();

    // Deletion outranks a sync failure: it holds the slot.
    const deletion = await screen.findByTestId('deletion-grace-banner');
    const sync = await screen.findByTestId('sync-error-banner');
    const more = await screen.findByRole('button', { name: '+1 more' });
    expect(deletion.closest('.dm-banner-item')).not.toHaveAttribute('hidden');
    expect(sync.closest('.dm-banner-item')).toHaveAttribute('hidden');

    await user.click(more);
    expect(sync.closest('.dm-banner-item')).not.toHaveAttribute('hidden');
  });
});

describe('(app) layout — banner priority order', () => {
  // The slot shows the FIRST banner that renders, so child order in
  // `AppChromeLayout` IS the priority order. The access-deadline banner
  // sits after deletion and renders nothing in this fixture. The other
  // five are made active at once: account deletion, sync error, mailbox
  // reconnect, Later return, heard-from.
  it('orders the five app banners: deletion, sync error, reconnect, later return, heard-from', async () => {
    window.localStorage.setItem('dm-cookie-consent', 'essential');
    const handlers = authedHandlers({
      onboardedAt: '2026-01-02T00:00:00.000Z',
      deletionRequest: { effectiveAt: '2026-06-19T00:00:00.000Z', status: 'pending' },
      laterRecovery: {
        affectedCount: 1,
        firstIssue: {
          senderId: 'sender-1',
          displayName: 'Daily Digest',
          email: 'digest@example.test',
          snoozedUntil: '2026-07-14T10:00:00.000Z',
          returnStatus: 'missed',
          lastReturnAttemptAt: null,
          returnFailureKind: null,
        },
      },
    }).filter((handler) => handler.path !== '/api/auth/me');
    installFetchStub([
      {
        method: 'GET',
        path: '/api/auth/me',
        respond: () =>
          ok({
            data: {
              user: { id: 'u-1', email: 'founder@example.test', workspaceId: 'ws-1' },
              mailboxes: [
                {
                  id: 'mb-1',
                  email: 'founder@example.test',
                  status: 'active',
                  connectedAt: '2026-01-01T00:00:00.000Z',
                  readiness: 'ready',
                },
                {
                  id: 'mb-2',
                  email: 'second@example.test',
                  status: 'active',
                  connectedAt: '2026-01-01T00:00:00.000Z',
                  readiness: 'ready',
                  needsReconnect: true,
                },
              ],
              activeMailboxId: 'mb-1',
              tier: 'pro',
              cleanupRemaining: null,
              signupAttribution: { promptNeeded: true },
            },
          }),
      },
      ...handlers,
      { method: 'GET', path: '/api/screener/count', respond: () => ok({ data: { pending: 0 } }) },
      {
        method: 'GET',
        path: '/api/v1/sync/status',
        respond: () =>
          ok({
            data: {
              readiness_status: 'ready',
              current_stage: 'ready',
              progress_pct: 100,
              is_ready_for_triage: true,
              last_synced_at: null,
              last_sync_error_at: new Date(Date.now() - 5 * 60_000).toISOString(),
              last_sync_error_code: 'GMAIL_HISTORY_GONE',
            },
          }),
      },
    ]);

    try {
      renderLayout();

      const ids = [
        'deletion-grace-banner',
        'sync-error-banner',
        'mailbox-reconnect-banner',
        'later-return-alert',
        'heard-from-prompt',
      ];
      const banners = await Promise.all(ids.map((id) => screen.findByTestId(id)));
      await screen.findByRole('button', { name: '+4 more' });

      const items = Array.from(document.querySelectorAll('.dm-banner-item'));
      expect(banners.map((el) => items.indexOf(el.closest('.dm-banner-item')!))).toEqual([
        0, 2, 3, 4, 5,
      ]);
      // Only index 0 — the account-deletion banner — holds the slot.
      // Index 1 is the access-deadline banner, inactive in this fixture.
      expect(items.map((el) => el.hasAttribute('hidden'))).toEqual([
        false,
        true,
        true,
        true,
        true,
        true,
      ]);
    } finally {
      window.localStorage.removeItem('dm-cookie-consent');
    }
  });
});

describe('(app) layout — Later return recovery', () => {
  it('mounts the missed-return alert for an affected Free workspace', async () => {
    installFetchStub(
      authedHandlers({
        onboardedAt: '2026-01-02T00:00:00.000Z',
        tier: 'free',
        laterRecovery: {
          affectedCount: 1,
          firstIssue: {
            senderId: 'sender-1',
            displayName: 'Daily Digest',
            email: 'digest@example.test',
            snoozedUntil: '2026-07-14T10:00:00.000Z',
            returnStatus: 'missed',
            lastReturnAttemptAt: null,
            returnFailureKind: null,
          },
        },
      }),
    );

    renderLayout();

    expect(await screen.findByTestId('later-return-alert')).toHaveTextContent(
      /could not be confirmed/i,
    );
    expect(screen.getByText('authed app body')).toBeInTheDocument();
  });
});

describe('(app) layout — no-active-mailbox branch (ladder #5)', () => {
  /** Authed `me` with ZERO connected mailboxes (active = null). */
  function noMailboxMe(): FetchStubHandler {
    return {
      method: 'GET',
      path: '/api/auth/me',
      respond: () =>
        ok({
          data: {
            user: { id: 'u-1', email: 'founder@example.test', workspaceId: 'ws-1' },
            mailboxes: [],
            activeMailboxId: null,
          },
        }),
    };
  }

  it('an ONBOARDED user with no active mailbox sees the reconnect gate', async () => {
    installFetchStub([
      noMailboxMe(),
      {
        method: 'GET',
        path: '/api/onboarding/state',
        respond: () => ok({ data: { onboardedAt: '2026-01-02T00:00:00.000Z' } }),
      },
      {
        method: 'GET',
        path: '/api/account/deletion',
        respond: () => ok({ data: { request: null, projection: null } }),
      },
    ]);

    renderLayout();

    expect(await screen.findByText('No Gmail account selected')).toBeInTheDocument();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('explains a connect failure on the reconnect gate instead of swallowing it (QA-onboarding-20260828-05)', async () => {
    // QA-onboarding-20260828-05: the toast used to be wired to the Triage
    // page only, which never mounts here — a connect failure leaves
    // `activeMailboxId` null, so this reconnect-gate branch renders
    // instead. The negative control: reverting `useConnectResultToast`'s
    // call site back to `triage/page.tsx` makes this assertion fail,
    // because that page never mounts on this branch.
    (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(
      'http://localhost/senders?connect_error=connect_failed',
    );
    installFetchStub([
      noMailboxMe(),
      {
        method: 'GET',
        path: '/api/onboarding/state',
        respond: () => ok({ data: { onboardedAt: '2026-01-02T00:00:00.000Z' } }),
      },
      {
        method: 'GET',
        path: '/api/account/deletion',
        respond: () => ok({ data: { request: null, projection: null } }),
      },
    ]);

    try {
      renderLayout();

      expect(await screen.findByText('No Gmail account selected')).toBeInTheDocument();
      expect(
        await screen.findByText('Could not connect that Gmail account. Try again.'),
      ).toBeInTheDocument();
      // One-shot: the param is stripped so a refresh doesn't replay it.
      await vi.waitFor(() => expect(window.location.search).toBe(''));
    } finally {
      (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(
        'http://localhost/senders',
      );
    }
  });

  it('still shows a connect error when the onboarding state cannot be read (fail-open)', async () => {
    const setURL = (u: string) =>
      (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(u);
    setURL('http://localhost/triage?connect_error=connect_failed');
    installFetchStub(
      authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }).filter(
        (h) => h.path !== '/api/onboarding/state',
      ),
    );

    try {
      renderLayout();

      expect(
        await screen.findByText('Could not connect that Gmail account. Try again.'),
      ).toBeInTheDocument();
      await vi.waitFor(() => expect(window.location.search).toBe(''));
    } finally {
      setURL('http://localhost/senders');
    }
  });

  // Nothing sends `?connected=`; a toast that printed it would let any link
  // put its own words in a green success toast inside the app.
  it('never turns ?connected= text into a success toast', async () => {
    const setURL = (u: string) =>
      (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(u);
    setURL(
      'http://localhost/senders?connected=Your%20account%20is%20verified&connect_error=connect_failed',
    );
    installFetchStub(authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }));

    try {
      renderLayout();

      // The app body renders before the hook's onboarding wait is over, so
      // wait for the closed code it does handle: then it has run.
      await vi.waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith(
          'Could not connect that Gmail account. Try again.',
          'danger',
        ),
      );
      expect(toastSpy).toHaveBeenCalledOnce();
    } finally {
      setURL('http://localhost/senders');
    }
  });

  // An unlisted code, including one that names an Object.prototype key,
  // reads as a plain connect failure and never reaches the toast raw.
  it.each(['something-new', 'toString'])(
    'shows the plain connect-failed line for the unlisted code %s',
    async (code) => {
      const setURL = (u: string) =>
        (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(
          u,
        );
      setURL(`http://localhost/triage?connect_error=${code}`);
      installFetchStub(authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }));

      try {
        renderLayout();

        await vi.waitFor(() =>
          expect(toastSpy).toHaveBeenCalledWith(
            'Could not connect that Gmail account. Try again.',
            'danger',
          ),
        );
        expect(toastSpy).toHaveBeenCalledOnce();
      } finally {
        setURL('http://localhost/senders');
      }
    },
  );

  it('an ONBOARDING-INCOMPLETE user with no active mailbox goes to /onboarding, NOT the reconnect gate', async () => {
    installFetchStub([
      noMailboxMe(),
      {
        method: 'GET',
        path: '/api/onboarding/state',
        respond: () => ok({ data: { onboardedAt: null } }),
      },
      {
        method: 'GET',
        path: '/api/account/deletion',
        respond: () => ok({ data: { request: null, projection: null } }),
      },
    ]);

    renderLayout();

    await vi.waitFor(() =>
      expect(replaceSpy).toHaveBeenCalledWith('/onboarding?returnTo=%2Fsenders'),
    );
    // The reconnect gate must NOT have flashed.
    expect(screen.queryByText('No Gmail account selected')).not.toBeInTheDocument();
  });

  it('holds (renders nothing) while onboarding state is in flight — no reconnect-gate flash', () => {
    installFetchStub([
      noMailboxMe(),
      // Onboarding state never resolves → resolving=true → hold.
      {
        method: 'GET',
        path: '/api/onboarding/state',
        respond: () => new Promise<Response>(() => undefined),
      },
      {
        method: 'GET',
        path: '/api/account/deletion',
        respond: () => ok({ data: { request: null, projection: null } }),
      },
    ]);

    renderLayout();

    // Neither the reconnect gate nor the app body — the branch is held
    // until onboarding state settles (the flash fix).
    expect(screen.queryByText('No Gmail account selected')).not.toBeInTheDocument();
    expect(screen.queryByText('authed app body')).not.toBeInTheDocument();
  });
});

describe('(app) layout — user-scoped routes stay reachable with no active mailbox (D116/D216/D121)', () => {
  /** Authed `me` with ZERO connected mailboxes (active = null). */
  function noMailboxMe(): FetchStubHandler {
    return {
      method: 'GET',
      path: '/api/auth/me',
      respond: () =>
        ok({
          data: {
            user: { id: 'u-1', email: 'founder@example.test', workspaceId: 'ws-1' },
            mailboxes: [],
            activeMailboxId: null,
          },
        }),
    };
  }

  function onboardedNoMailbox(): FetchStubHandler[] {
    return [
      noMailboxMe(),
      {
        method: 'GET',
        path: '/api/onboarding/state',
        respond: () => ok({ data: { onboardedAt: '2026-01-02T00:00:00.000Z' } }),
      },
      {
        method: 'GET',
        path: '/api/account/deletion',
        respond: () => ok({ data: { request: null, projection: null } }),
      },
    ];
  }

  it('renders /settings children through the gate — not the reconnect gate — and never polls sync status', async () => {
    pathnameRef.current = '/settings';
    // A read guard's poll would 409-storm here; assert it is never fired.
    const syncSpy = vi.fn(() => ok({ data: { readiness_status: 'ready' } }));
    installFetchStub([
      ...onboardedNoMailbox(),
      { method: 'GET', path: '/api/v1/sync/status', respond: syncSpy },
    ]);

    renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    expect(screen.queryByText('No Gmail account selected')).not.toBeInTheDocument();
    // SyncErrorBanner + SyncNowButton are gated off with no active mailbox.
    expect(syncSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('triage-undo-tray')).not.toBeInTheDocument();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('renders /billing children through the gate', async () => {
    pathnameRef.current = '/billing';
    installFetchStub(onboardedNoMailbox());

    renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    expect(screen.queryByText('No Gmail account selected')).not.toBeInTheDocument();
  });

  it('still shows the reconnect gate on a mailbox-scoped route (/senders)', async () => {
    pathnameRef.current = '/senders';
    installFetchStub(onboardedNoMailbox());

    renderLayout();

    expect(await screen.findByText('No Gmail account selected')).toBeInTheDocument();
    expect(screen.queryByText('authed app body')).not.toBeInTheDocument();
  });

  it('keeps the mailbox-scoped /settings/senders subroute behind the reconnect gate (standing policies need a mailbox)', async () => {
    // /settings/senders reads session-scoped `useSenders` — it must NOT
    // fall through the allowlist (that would render a dead-end 409), even
    // though it lives under /settings.
    pathnameRef.current = '/settings/senders';
    installFetchStub(onboardedNoMailbox());

    renderLayout();

    expect(await screen.findByText('No Gmail account selected')).toBeInTheDocument();
    expect(screen.queryByText('authed app body')).not.toBeInTheDocument();
  });

  it('renders /settings/privacy (data export + legal, user-scoped) through the gate', async () => {
    pathnameRef.current = '/settings/privacy';
    installFetchStub(onboardedNoMailbox());

    renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    expect(screen.queryByText('No Gmail account selected')).not.toBeInTheDocument();
  });

  // `/api/security-events` is JwtGuard + AdminAllowlistGuard with no
  // CurrentMailboxGuard, so the D181 audit log does not depend on a
  // mailbox. Gating it trapped an operator with zero connected mailboxes
  // behind the reconnect takeover on a route that never needed one —
  // the 2026-07-09 billing/deletion trap in miniature.
  it.each(['/admin/security', '/admin/acquisition'])(
    'renders %s (admin report, mailbox-independent) through the gate',
    async (pathname) => {
      pathnameRef.current = pathname;
      installFetchStub(onboardedNoMailbox());

      renderLayout();

      expect(await screen.findByText('authed app body')).toBeInTheDocument();
      expect(screen.queryByText('No Gmail account selected')).not.toBeInTheDocument();
    },
  );
});

describe('(app) layout — undo tray stays off account surfaces (D245)', () => {
  /** Fully-authed handlers with an active mailbox (tier pro default). */
  function activeMailboxHandlers(): FetchStubHandler[] {
    return [
      ...authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }),
      {
        method: 'GET',
        path: '/api/screener/count',
        respond: () => ok({ data: { pending: 0 } }),
      },
    ];
  }

  it('does not mount the tray on /billing even with an active mailbox', async () => {
    // Billing is user-scoped, not mailbox-backed — the tray was
    // overlaying the plan cards.
    pathnameRef.current = '/billing';
    installFetchStub(activeMailboxHandlers());

    renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    expect(screen.queryByTestId('triage-undo-tray')).not.toBeInTheDocument();
  });

  it('does not mount the tray on /settings even with an active mailbox', async () => {
    pathnameRef.current = '/settings';
    installFetchStub(activeMailboxHandlers());

    renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    expect(screen.queryByTestId('triage-undo-tray')).not.toBeInTheDocument();
  });

  it('mounts the tray on a mailbox-backed route (/senders) with an active mailbox', async () => {
    pathnameRef.current = '/senders';
    installFetchStub(activeMailboxHandlers());

    renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    expect(screen.getByTestId('triage-undo-tray')).toBeInTheDocument();
  });

  it.each([
    ['', false],
    ['view=guided', true],
    ['view=first-review', false],
    ['view=guided&q=lumen', true],
  ] as const)('sets the Undo shortcut for Senders query %s to %s', async (query, enabled) => {
    pathnameRef.current = '/senders';
    searchParamsRef.current = query;
    installFetchStub(activeMailboxHandlers());
    renderLayout();
    await screen.findByText('authed app body');
    expect(undoTrayPropsSpy).toHaveBeenLastCalledWith({
      enableShortcut: enabled,
      mailboxId: 'mb-1',
    });
  });
});

describe('nav plan chips after D251 (design-gate B1)', () => {
  it('plus: Cleanup and Autopilot remain unlocked; Daily Brief still chips Pro', async () => {
    installFetchStub(authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z', tier: 'plus' }));
    const { rerenderAt } = renderLayout();
    await screen.findByText('authed app body');
    // Cleanup views live inside Senders; the group still exposes truthful lock context.
    expect(cleanupRailButton()).not.toHaveAttribute(
      'aria-description',
      expect.stringContaining('feature'),
    );
    expect(screen.queryByRole('navigation', { name: 'Cleanup views' })).not.toBeInTheDocument();

    rerenderAt('/autopilot');
    const autopilot = within(
      screen.getByRole('navigation', { name: 'Product navigation' }),
    ).getByRole('button', { name: 'Automations' });
    expect(within(autopilot).queryByLabelText(/^(Plus|Pro) feature$/)).toBeNull();

    rerenderAt('/brief');
    const brief = within(screen.getByRole('navigation', { name: 'Catch up views' })).getByRole(
      'button',
      { name: /^Daily Brief/ },
    );
    expect(within(brief).getByLabelText('Pro feature')).toBeInTheDocument();
  });

  it('free: Autopilot chips Plus (the granting tier), not Pro', async () => {
    pathnameRef.current = '/autopilot';
    installFetchStub(authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z', tier: 'free' }));
    renderLayout();
    await screen.findByText('authed app body');

    const autopilot = within(
      screen.getByRole('navigation', { name: 'Product navigation' }),
    ).getByRole('button', { name: 'Automations' });
    expect(autopilot).toHaveAttribute('aria-description', expect.stringContaining('Plus feature'));
    expect(within(autopilot).queryByLabelText('Pro feature')).toBeNull();
  });
});
