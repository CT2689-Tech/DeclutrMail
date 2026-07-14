import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';

import { AUTO_ARCHIVE_LOW_ENGAGEMENT } from './fixtures';

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    me: {
      user: { id: 'u', email: 'me@example.com', workspaceId: 'w' },
      activeMailboxId: 'mb-1',
      mailboxes: [
        {
          id: 'mb-1',
          email: 'me@example.com',
          status: 'active',
          connectedAt: null,
          readiness: 'ready',
        },
      ],
      tier: 'free',
      cleanupRemaining: 5,
    },
  }),
}));

import { AutopilotEntitlementSurface } from './autopilot-entitlement-surface';

describe('AutopilotEntitlementSurface — safe pre-upgrade value', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('loads only the real preset catalog and keeps suggestions and mutations unmounted', async () => {
    let rulesReads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/autopilot/rules',
        respond: () => {
          rulesReads += 1;
          return jsonOk({ data: [AUTO_ARCHIVE_LOW_ENGAGEMENT] });
        },
      },
    ]);

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AutopilotEntitlementSurface />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('autopilot-observe-preview')).toBeInTheDocument();
    expect(
      screen.getByText(/does not inspect new mail, create suggestions, or change anything/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(rulesReads).toBe(1));
    expect(await screen.findByText('Auto-archive low-engagement')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /upgrade to pro · \$19\/mo/i })).toHaveAttribute(
      'href',
      '/billing',
    );
    expect(
      screen.queryByRole('button', { name: /pause every autopilot rule/i }),
    ).not.toBeInTheDocument();
  });
});
