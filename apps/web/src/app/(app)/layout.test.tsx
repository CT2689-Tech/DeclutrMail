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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, type FetchStubHandler } from '@/test/fetch-stub';

const { pushSpy, replaceSpy, undoTrayPropsSpy, pathnameRef } = vi.hoisted(() => ({
  pushSpy: vi.fn(),
  replaceSpy: vi.fn(),
  undoTrayPropsSpy: vi.fn(),
  // Mutable so tests can drive the pathname-dependent branch (the
  // user-scoped-route fallback under no active mailbox). Defaults to a
  // mailbox-scoped route so every pre-existing test is unaffected.
  pathnameRef: { current: '/senders' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy, replace: replaceSpy }),
  usePathname: () => pathnameRef.current,
}));
vi.mock('@/features/triage/triage-undo-tray', () => ({
  TriageUndoTray: (props: { mailboxId?: string }) => {
    undoTrayPropsSpy(props);
    return <div data-testid="triage-undo-tray" />;
  },
}));

import AppLayout from './layout';

afterEach(() => {
  vi.restoreAllMocks();
  pushSpy.mockClear();
  replaceSpy.mockClear();
  undoTrayPropsSpy.mockClear();
  pathnameRef.current = '/senders';
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
    expect(undoTrayPropsSpy).toHaveBeenCalledWith({ mailboxId: 'mb-1' });
    // No deletion pending → no banner.
    expect(screen.queryByTestId('deletion-grace-banner')).not.toBeInTheDocument();
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
});
