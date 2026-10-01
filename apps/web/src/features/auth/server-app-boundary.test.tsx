import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { makeQueryClient } from '@/lib/query-client';
import { AuthProvider } from './auth-provider';
import { ServerAppBoundary } from './server-app-boundary';

describe('ServerAppBoundary', () => {
  it('does not hold every screen behind slow decorative and undo reads', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (['/api/account/deletion', '/api/snoozed/recovery', '/api/undo'].includes(path)) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      return Response.json({
        data:
          path === '/api/auth/me'
            ? { activeMailboxId: 'mailbox-1', mailboxes: [], tier: 'pro' }
            : {},
      });
    });
    vi.stubGlobal('fetch', fetchSpy);
    let ready = false;
    const boundary = ServerAppBoundary({ cookieHeader: 'dm_access=token', children: <div /> }).then(
      (result) => {
        ready = true;
        return result;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBe(true);
    await vi.advanceTimersByTimeAsync(1_500);
    await boundary;
  });

  it('overlaps the two user-scoped gate reads instead of serial round trips', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return Response.json({
          data: String(input).endsWith('/api/auth/me')
            ? { activeMailboxId: null, mailboxes: [], tier: 'pro' }
            : {},
        });
      }),
    );
    let ready = false;
    const boundary = ServerAppBoundary({ cookieHeader: 'dm_access=token', children: <div /> }).then(
      (result) => {
        ready = true;
        return result;
      },
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(ready).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    await boundary;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('hydrates the two gates without waiting for accessories', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const fetchSpy = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/me')) {
        return Response.json({
          data: {
            user: {
              id: 'user-1',
              email: 'founder@example.test',
              workspaceId: 'workspace-1',
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
            mailboxes: [
              {
                id: 'mailbox-1',
                email: 'founder@example.test',
                status: 'active',
                connectedAt: '2026-01-01T00:00:00.000Z',
                readiness: 'ready',
              },
            ],
            activeMailboxId: 'mailbox-1',
            tier: 'pro',
            cleanupRemaining: null,
          },
        });
      }
      return Response.json({ data: {} });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const boundary = await ServerAppBoundary({
      cookieHeader: 'dm_access=token',
      children: (
        <AuthProvider>
          <div>App ready</div>
        </AuthProvider>
      ),
    });
    render(<QueryClientProvider client={makeQueryClient()}>{boundary}</QueryClientProvider>);

    expect(screen.getByText('App ready')).toBeInTheDocument();
    expect(fetchSpy.mock.calls.map(([input]) => String(input)).sort()).toEqual([
      'http://localhost:4000/api/auth/me',
      'http://localhost:4000/api/onboarding/state',
    ]);
  });

  it('does not issue mailbox-scoped shell reads without an active mailbox', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const fetchSpy = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (String(input).endsWith('/api/auth/me')) {
        return Response.json({
          data: {
            user: {
              id: 'user-1',
              email: 'founder@example.test',
              workspaceId: 'workspace-1',
              timezone: null,
            },
            mailboxes: [],
            activeMailboxId: null,
            tier: 'free',
            cleanupRemaining: 5,
          },
        });
      }
      return Response.json({ data: {} });
    });
    vi.stubGlobal('fetch', fetchSpy);

    await ServerAppBoundary({ cookieHeader: 'dm_access=token', children: <div /> });

    expect(fetchSpy.mock.calls.map(([input]) => String(input)).sort()).toEqual([
      'http://localhost:4000/api/auth/me',
      'http://localhost:4000/api/onboarding/state',
    ]);
  });
});
