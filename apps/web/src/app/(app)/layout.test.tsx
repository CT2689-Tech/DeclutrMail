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
 *   5. Happy path: children render inside the shell, and the nav is
 *      honest — trimmed placeholder surfaces (Screener #220, Billing
 *      #219) never appear.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, type FetchStubHandler } from '@/test/fetch-stub';

const { pushSpy, replaceSpy } = vi.hoisted(() => ({
  pushSpy: vi.fn(),
  replaceSpy: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy, replace: replaceSpy }),
  usePathname: () => '/senders',
}));

import AppLayout from './layout';

afterEach(() => {
  vi.restoreAllMocks();
  pushSpy.mockClear();
  replaceSpy.mockClear();
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
 * select the ladder branch under test.
 */
function authedHandlers(opts: {
  onboardedAt: string | null;
  deletionRequest?: { effectiveAt: string; status: 'pending' | 'executing' };
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
            tier: 'pro',
            cleanupRemaining: null,
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

  it('renders children + an honest nav (no Screener/Billing) on the happy path, with no banner', async () => {
    installFetchStub(authedHandlers({ onboardedAt: '2026-01-02T00:00:00.000Z' }));

    renderLayout();

    expect(await screen.findByText('authed app body')).toBeInTheDocument();
    // Trimmed placeholder surfaces must not be advertised (D207).
    expect(screen.queryByText('Screener')).not.toBeInTheDocument();
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    // Kept surfaces are present (spot-check both nav groups).
    expect(screen.getByText('Triage')).toBeInTheDocument();
    expect(screen.getByText('Autopilot')).toBeInTheDocument();
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
