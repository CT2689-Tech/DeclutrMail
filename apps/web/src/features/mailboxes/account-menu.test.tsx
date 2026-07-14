import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MailboxIndexedDataState } from '@declutrmail/shared/contracts';

import type { Me } from '@/features/auth/api/use-me';

const h = vi.hoisted(() => ({
  me: null as unknown as Me,
  disconnect: vi.fn(),
  deleteIndexedData: vi.fn(),
}));

vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => ({ me: h.me }) }));
vi.mock('@/features/auth/api/use-tier', () => ({
  useTier: () => ({
    tier: 'pro',
    inboxLimit: 2,
    connectedInboxes: 0,
    atInboxLimit: false,
  }),
}));
vi.mock('@/features/auth/api/use-logout', () => ({
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('./api/use-set-active-mailbox', () => ({
  useSetActiveMailbox: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('./api/use-disconnect-mailbox', () => ({
  useDisconnectMailbox: () => ({ mutate: h.disconnect, isPending: false }),
}));
vi.mock('./api/use-delete-mailbox-indexed-data', () => ({
  useDeleteMailboxIndexedData: () => ({ mutate: h.deleteIndexedData, isPending: false }),
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));

import { AccountMenu } from './account-menu';

function meWithState(indexedDataState: MailboxIndexedDataState): Me {
  return {
    user: { id: 'u', email: 'person@example.com', workspaceId: 'w' },
    activeMailboxId: null,
    tier: 'pro',
    cleanupRemaining: null,
    mailboxes: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'person@example.com',
        status: 'disconnected',
        connectedAt: null,
        readiness: null,
        indexedDataState,
        dataDeletion: null,
      },
    ],
  };
}

describe('AccountMenu mailbox-data lifecycle', () => {
  beforeEach(() => {
    h.disconnect.mockReset();
    h.deleteIndexedData.mockReset();
  });

  it.each([
    ['deletion_pending', 'deletion queued'],
    ['deleting', 'deleting data…'],
    ['deletion_delayed', 'deletion delayed'],
  ] as const)('shows %s and blocks reconnect', (state, label) => {
    h.me = meWithState(state);
    render(<AccountMenu />);
    fireEvent.click(screen.getByRole('button', { name: /person@example\.com/i }));

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /delete data/i })).not.toBeInTheDocument();
  });

  it('allows a fresh-index reconnect after deletion completes', () => {
    h.me = meWithState('deleted');
    render(<AccountMenu />);
    fireEvent.click(screen.getByRole('button', { name: /person@example\.com/i }));

    expect(screen.getByText('data deleted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled();
  });

  it('offers indexed-data deletion when a disconnected mailbox retained its history', () => {
    h.me = meWithState('retained');
    render(<AccountMenu />);
    fireEvent.click(screen.getByRole('button', { name: /person@example\.com/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete data/i }));

    expect(
      screen.getByRole('dialog', { name: /manage data for person@example\.com/i }),
    ).toBeInTheDocument();
  });
});
