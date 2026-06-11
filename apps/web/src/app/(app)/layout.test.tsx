/**
 * Tests for the `(app)` group layout's auth boundary (D134 split).
 *
 * Since the split, the root providers no longer auth-gate routes —
 * this layout owns its own `AuthProvider`. The invariants:
 *
 *   1. While `GET /api/auth/me` is in flight, the layout renders the
 *      auth skeleton and NEVER its children — no flash of unauthed
 *      content on app routes.
 *
 *   2. A 401 bounces the browser to the OAuth start endpoint exactly
 *      as before the split, still without rendering children.
 *
 * The happy path (children render once `me` resolves) is exercised by
 * the browser smoke + existing feature-screen tests; here we pin the
 * gate states, which don't need the AppShell/sender stubs.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub } from '@/test/fetch-stub';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/senders',
}));

import AppLayout from './layout';

afterEach(() => {
  vi.restoreAllMocks();
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
