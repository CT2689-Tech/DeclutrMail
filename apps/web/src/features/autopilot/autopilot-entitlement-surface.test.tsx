import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('offers a read-only live preview while keeping suggestions and mutations unmounted', async () => {
    let rulesReads = 0;
    let previewReads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/autopilot/rules',
        respond: () => {
          rulesReads += 1;
          return jsonOk({ data: [AUTO_ARCHIVE_LOW_ENGAGEMENT] });
        },
      },
      {
        method: 'POST',
        path: `/api/autopilot/rules/${AUTO_ARCHIVE_LOW_ENGAGEMENT.id}/preview`,
        respond: () => {
          previewReads += 1;
          return jsonOk({
            data: {
              ruleId: AUTO_ARCHIVE_LOW_ENGAGEMENT.id,
              wouldMatchCount: 2,
              evaluatedSenders: 14,
              sample: [
                {
                  senderKey: 'a'.repeat(64),
                  senderName: 'Weekly Deals',
                  senderEmail: 'deals@example.com',
                  reason: 'Low engagement over 90 days',
                },
              ],
            },
          });
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
      screen.getByText(/preview does not create suggestions or change gmail/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(rulesReads).toBe(1));
    expect(await screen.findByText('Auto-archive low-engagement')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview current matches' }));
    await waitFor(() => expect(previewReads).toBe(1));
    expect(await screen.findByText('Weekly Deals')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /current match preview/i })).toHaveTextContent(
      /2\s*senders would match if this rule were active now/i,
    );
    expect(screen.getByText(/this check is read-only. nothing changed/i)).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /upgrade to pro · \$19\/mo/i })).toHaveAttribute(
      'href',
      '/billing',
    );
    expect(
      screen.queryByRole('button', { name: /pause every autopilot rule/i }),
    ).not.toBeInTheDocument();
  });
});
