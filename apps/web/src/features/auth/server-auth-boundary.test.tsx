import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { makeQueryClient } from '@/lib/query-client';
import { AuthProvider } from './auth-provider';
import { ServerAuthBoundary } from './server-auth-boundary';

describe('ServerAuthBoundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('renders authenticated children immediately without a duplicate client me request', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const fetchSpy = vi.fn(async () =>
      Response.json({
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
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const boundary = await ServerAuthBoundary({
      cookieHeader: 'dm_access=token',
      children: (
        <AuthProvider>
          <div>Authenticated app</div>
        </AuthProvider>
      ),
    });
    render(<QueryClientProvider client={makeQueryClient()}>{boundary}</QueryClientProvider>);

    expect(screen.getByText('Authenticated app')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-skeleton')).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
