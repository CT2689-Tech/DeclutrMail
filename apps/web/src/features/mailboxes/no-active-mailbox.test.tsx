/**
 * Tests for the no-active-mailbox gate (D116) — shown when the user
 * disconnects their last active mailbox. Without it, reads 409 and the
 * dashboard renders broken.
 *
 * The presentational `NoActiveMailboxView` is driven directly by props
 * (no AuthProvider needed); the container wiring is smoke-checked with
 * a stubbed `useAuth` / `useLogout`.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { NoActiveMailboxView } from './no-active-mailbox';

describe('NoActiveMailboxView', () => {
  it('offers reconnect + lists disconnected accounts when some exist', () => {
    const onConnect = vi.fn();
    render(
      <NoActiveMailboxView
        disconnectedEmails={['primary@example.com']}
        signingOut={false}
        onConnect={onConnect}
        onSignOut={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /reconnect gmail/i }));
    expect(onConnect).toHaveBeenCalledOnce();
    expect(screen.getByText(/primary@example\.com/)).toBeInTheDocument();
  });

  it('offers a first-connect CTA when there are no mailboxes at all', () => {
    render(
      <NoActiveMailboxView
        disconnectedEmails={[]}
        signingOut={false}
        onConnect={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /connect a gmail account/i })).toBeInTheDocument();
  });

  it('blocks reconnect while the last mailbox data deletion is in progress', () => {
    render(
      <NoActiveMailboxView
        disconnectedEmails={[]}
        deletionInProgressEmails={['primary@example.com']}
        signingOut={false}
        onConnect={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/reconnect becomes available after deletion completes/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect|reconnect/i })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/primary@example\.com/i);
  });

  it('explains that reconnect after completed deletion builds a fresh index', () => {
    render(
      <NoActiveMailboxView
        disconnectedEmails={['primary@example.com']}
        deletedDataEmails={['primary@example.com']}
        signingOut={false}
        onConnect={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    expect(screen.getByText(/build a new index from Gmail/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reconnect Gmail/i })).toBeEnabled();
  });

  it('always offers account + billing escape hatches (reachable with no mailbox — D216/D121)', () => {
    render(
      <NoActiveMailboxView
        disconnectedEmails={[]}
        signingOut={false}
        onConnect={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: /manage account/i })).toHaveAttribute(
      'href',
      '/settings#account',
    );
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/billing');
  });

  it('calls onSignOut and disables the button while signing out', () => {
    const onSignOut = vi.fn();
    const { rerender } = render(
      <NoActiveMailboxView
        disconnectedEmails={[]}
        signingOut={false}
        onConnect={vi.fn()}
        onSignOut={onSignOut}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledOnce();

    rerender(
      <NoActiveMailboxView
        disconnectedEmails={[]}
        signingOut
        onConnect={vi.fn()}
        onSignOut={onSignOut}
      />,
    );
    expect(screen.getByRole('button', { name: /sign out/i })).toBeDisabled();
  });
});

describe('NoActiveMailbox container', () => {
  it('forwards disconnected mailbox emails from useAuth to the view', async () => {
    vi.resetModules();
    vi.doMock('@/features/auth/auth-provider', () => ({
      useAuth: () => ({
        me: {
          user: { id: 'u', email: 'u@example.com', workspaceId: 'w' },
          activeMailboxId: null,
          mailboxes: [
            {
              id: 'm0',
              email: 'gone@example.com',
              status: 'disconnected',
              connectedAt: null,
              readiness: null,
              indexedDataState: 'retained',
              dataDeletion: null,
            },
          ],
        },
      }),
    }));
    vi.doMock('@/features/auth/api/use-logout', () => ({
      useLogout: () => ({ mutate: vi.fn(), isPending: false }),
    }));
    const { NoActiveMailbox } = await import('./no-active-mailbox');
    render(<NoActiveMailbox />);
    expect(screen.getByText(/gone@example\.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reconnect gmail/i })).toBeInTheDocument();
  });
});
