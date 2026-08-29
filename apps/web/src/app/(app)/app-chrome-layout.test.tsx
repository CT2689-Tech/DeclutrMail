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
 *      lists every built surface — including Screener (#220) and
 *      Billing (#219), restored after both shipped.
 *
 *   6. Screener badge (D74/D77): the count query fires ONLY for tiers
 *      with the `screener` capability — a Free/Plus session must never
 *      hit an endpoint the server would 402.
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
vi.mock('@/features/triage/triage-undo-tray', () => ({
  ProductUndoTray: (props: { enableShortcut?: boolean; mailboxId?: string }) => {
    undoTrayPropsSpy(props);
    return <div data-testid="triage-undo-tray" />;
  },
}));

import { AppChromeLayout as AppLayout } from './app-chrome-layout';
import { MAILBOX_SCOPE_RESET_EVENT } from '@/features/mailboxes/api/reset-mailbox-cache';

afterEach(() => {
  vi.restoreAllMocks();
  pushSpy.mockClear();
  prefetchSpy.mockClear();
  replaceSpy.mockClear();
  refreshSpy.mockClear();
  undoTrayPropsSpy.mockClear();
  pathnameRef.current = '/senders';
  searchParamsRef.current = '';
});

function renderLayout() {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <AppLayout>
        <span>authed app body</span>
      </AppLayout>
    </QueryWrapper>,
  );
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
            activeSenders: 1,
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
    expect(String(assignSpy.mock.calls[0]![0])).toContain('/api/auth/google/start');
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
      const sendersNav = screen
        .getAllByRole('button')
        .find((button) => button.textContent?.includes('Senders'));
      expect(sendersNav).toHaveTextContent('1');
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
          activeSenders: 1,
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

  it('replaces the route with /onboarding when onboarding is incomplete (strict gate)', async () => {
    installFetchStub(authedHandlers({ onboardedAt: null }));

    renderLayout();

    await vi.waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledWith('/onboarding');
    });
    // Once the gate engages the chrome renders nothing behind the
    // redirect — no half-authed screen.
    expect(screen.queryByText('authed app body')).not.toBeInTheDocument();
  });

  it('refreshes the router when the active mailbox scope resets', async () => {
    installFetchStub(authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }));
    renderLayout();
    expect(await screen.findByText('authed app body')).toBeInTheDocument();

    window.dispatchEvent(new Event(MAILBOX_SCOPE_RESET_EVENT));

    expect(refreshSpy).toHaveBeenCalledOnce();
  });

  it('renders children + the full nav (incl. Screener/Billing) on the happy path, with no banner', async () => {
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
    // Screener + Billing shipped — their entries are back in the nav
    // (D207 honest nav; trimmed by fb75b05 while the routes were stubs).
    // The nav renders twice below `sm` widths never reached here, but
    // getAllBy* keeps this robust to the drawer variant.
    expect(screen.getAllByText('Screener').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Billing').length).toBeGreaterThan(0);
    // Kept surfaces are present (spot-check both nav groups).
    expect(screen.getByText('Triage')).toBeInTheDocument();
    expect(screen.getByText('Autopilot')).toBeInTheDocument();
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

  it('prefetches a sidebar destination on intent before navigation', async () => {
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

    const triageNav = await screen.findByRole('button', { name: 'Triage' });
    await user.hover(triageNav);

    expect(prefetchSpy).toHaveBeenCalledWith('/triage');
    expect(pushSpy).not.toHaveBeenCalled();

    await user.click(triageNav);
    expect(pushSpy).toHaveBeenCalledWith('/triage');
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

    expect(await screen.findByLabelText('3 new senders waiting in Screener')).toBeInTheDocument();
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

    renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    expect(screen.queryByLabelText(/waiting in Screener/)).not.toBeInTheDocument();
  });

  it('NEVER fires the count query for an under-tier workspace (the server would 402)', async () => {
    const countSpy = vi.fn(() => ok({ data: { pending: 3 } }));
    installFetchStub([
      ...authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z', tier: 'free' }),
      { method: 'GET', path: '/api/screener/count', respond: countSpy },
    ]);

    renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    // The nav still lists Screener (the route renders the D77 upsell
    // for under-tier visitors) — but the badge query never fires and
    // no badge renders. A 402 must never surface as an error state.
    expect(screen.getAllByText('Screener').length).toBeGreaterThan(0);
    expect(countSpy).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/waiting in Screener/)).not.toBeInTheDocument();
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

    expect(await screen.findByText('No active mailbox')).toBeInTheDocument();
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

      expect(await screen.findByText('No active mailbox')).toBeInTheDocument();
      expect(
        await screen.findByText('Could not connect that Gmail account. Try again.'),
      ).toBeInTheDocument();
      // One-shot: the param is stripped so a refresh doesn't replay it.
      expect(window.location.search).toBe('');
    } finally {
      (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(
        'http://localhost/senders',
      );
    }
  });

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

    await vi.waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/onboarding'));
    // The reconnect gate must NOT have flashed.
    expect(screen.queryByText('No active mailbox')).not.toBeInTheDocument();
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
    expect(screen.queryByText('No active mailbox')).not.toBeInTheDocument();
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
    expect(screen.queryByText('No active mailbox')).not.toBeInTheDocument();
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
    expect(screen.queryByText('No active mailbox')).not.toBeInTheDocument();
  });

  it('still shows the reconnect gate on a mailbox-scoped route (/senders)', async () => {
    pathnameRef.current = '/senders';
    installFetchStub(onboardedNoMailbox());

    renderLayout();

    expect(await screen.findByText('No active mailbox')).toBeInTheDocument();
    expect(screen.queryByText('authed app body')).not.toBeInTheDocument();
  });

  it('keeps the mailbox-scoped /settings/senders subroute behind the reconnect gate (standing policies need a mailbox)', async () => {
    // /settings/senders reads session-scoped `useSenders` — it must NOT
    // fall through the allowlist (that would render a dead-end 409), even
    // though it lives under /settings.
    pathnameRef.current = '/settings/senders';
    installFetchStub(onboardedNoMailbox());

    renderLayout();

    expect(await screen.findByText('No active mailbox')).toBeInTheDocument();
    expect(screen.queryByText('authed app body')).not.toBeInTheDocument();
  });

  it('renders /settings/privacy (data export + legal, user-scoped) through the gate', async () => {
    pathnameRef.current = '/settings/privacy';
    installFetchStub(onboardedNoMailbox());

    renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    expect(screen.queryByText('No active mailbox')).not.toBeInTheDocument();
  });

  // `/api/security-events` is JwtGuard + AdminAllowlistGuard with no
  // CurrentMailboxGuard, so the D181 audit log does not depend on a
  // mailbox. Gating it trapped an operator with zero connected mailboxes
  // behind the reconnect takeover on a route that never needed one —
  // the 2026-07-09 billing/deletion trap in miniature.
  it('renders /admin/security (audit log, mailbox-independent) through the gate', async () => {
    pathnameRef.current = '/admin/security';
    installFetchStub(onboardedNoMailbox());

    renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    expect(screen.queryByText('No active mailbox')).not.toBeInTheDocument();
  });
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
});

describe('nav plan chips after D251 (design-gate B1)', () => {
  it('plus: Autopilot and Screener carry no lock chip; Brief still chips Pro', async () => {
    installFetchStub(authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z', tier: 'plus' }));
    renderLayout();

    const nav = await screen.findByRole('navigation');
    const chips = within(nav).queryAllByLabelText(/^(Plus|Pro) feature$/);
    // Sidebar nav items render as <button>, not links (sidebar.tsx) —
    // the chip sits inside the button next to the label span.
    const chippedFor = (label: string) =>
      chips.some((chip) => chip.closest('button')?.textContent?.includes(label));

    // Plus OWNS these screens now — a lock chip on them is the chip's
    // contract inverted (a paying user told their screen is paywalled).
    expect(chippedFor('Autopilot')).toBe(false);
    expect(chippedFor('Screener')).toBe(false);
    // Still genuinely locked on plus.
    expect(chippedFor('Brief')).toBe(true);
  });

  it('free: Autopilot chips Plus (the granting tier), not Pro', async () => {
    installFetchStub(authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z', tier: 'free' }));
    renderLayout();

    const nav = await screen.findByRole('navigation');
    const autopilotItem = within(nav)
      .getAllByRole('button')
      .find((b) => b.textContent?.includes('Autopilot'));
    expect(autopilotItem).toBeDefined();
    expect(within(autopilotItem!).getByLabelText('Plus feature')).toBeInTheDocument();
  });
});
