import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Me } from './api/use-me';
import { AuthProvider, getActiveMailboxEmail } from './auth-provider';
import { MailboxActionContext } from './mailbox-action-context';

const me: Me = {
  user: {
    id: 'user-1',
    email: 'owner@example.com',
    workspaceId: 'workspace-1',
    timezone: 'UTC',
  },
  mailboxes: [
    {
      id: 'mailbox-a',
      email: 'first@gmail.com',
      status: 'active',
      connectedAt: null,
      readiness: 'ready',
    },
    {
      id: 'mailbox-b',
      email: 'active@gmail.com',
      status: 'active',
      connectedAt: null,
      readiness: 'ready',
    },
  ],
  activeMailboxId: 'mailbox-b',
  tier: 'pro',
  cleanupRemaining: null,
};

vi.mock('./api/use-me', () => ({
  useMe: () => ({ isLoading: false, error: null, data: me }),
}));

describe('MailboxActionContext', () => {
  it('resolves the active connected Gmail account', () => {
    expect(getActiveMailboxEmail(me)).toBe('active@gmail.com');
  });

  it('shows the active account from AuthProvider before a mutation', () => {
    render(
      <AuthProvider>
        <MailboxActionContext />
      </AuthProvider>,
    );

    expect(screen.getByRole('note', { name: 'Gmail account: active@gmail.com' })).toBeVisible();
  });

  it('supports an explicit account for isolated confirmation stories', () => {
    render(<MailboxActionContext mailboxEmail="story@gmail.com" />);
    expect(screen.getByRole('note', { name: 'Gmail account: story@gmail.com' })).toBeVisible();
  });
});
