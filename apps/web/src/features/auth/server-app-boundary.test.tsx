import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { makeQueryClient } from '@/lib/query-client';
import { AuthProvider } from './auth-provider';
import { ServerAppBoundary } from './server-app-boundary';

describe('ServerAppBoundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('hydrates auth and every eligible shell read in one outer owner', async () => {
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
              timezone: 'America/Los_Angeles',
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
    expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
      'http://localhost:4000/api/auth/me',
      'http://localhost:4000/api/onboarding/state',
      'http://localhost:4000/api/account/deletion',
      'http://localhost:4000/api/v1/sync/status',
      'http://localhost:4000/api/snoozed/recovery',
      'http://localhost:4000/api/undo',
      'http://localhost:4000/api/senders/summary',
      'http://localhost:4000/api/screener/count',
    ]);
    for (const call of fetchSpy.mock.calls.slice(3)) {
      const headers = (call[1] as RequestInit).headers as Record<string, string>;
      expect(headers['X-Active-Mailbox-Id']).toBe('mailbox-1');
    }
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

    expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
      'http://localhost:4000/api/auth/me',
      'http://localhost:4000/api/onboarding/state',
      'http://localhost:4000/api/account/deletion',
    ]);
  });
});
