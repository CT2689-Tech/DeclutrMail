/**
 * Tests for the no-active-mailbox gate (D116) — shown when the user
 * disconnects their last active mailbox. Recovery must bind OAuth to the
 * exact mailbox selected while keeping normal account-add available.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import type { Me } from '@/features/auth/api/use-me';
import {
  NoActiveMailbox,
  NoActiveMailboxView,
  type NoActiveMailboxViewProps,
} from './no-active-mailbox';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  logoutMutate: vi.fn(),
  startMailboxConnect: vi.fn(),
  startMailboxReactivation: vi.fn(),
}));

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => mocks.useAuth(),
}));

vi.mock('@/features/auth/api/use-logout', () => ({
  useLogout: () => ({ mutate: mocks.logoutMutate, isPending: false }),
}));

vi.mock('./connect-mailbox-url', () => ({
  startMailboxConnect: () => mocks.startMailboxConnect(),
  startMailboxReactivation: (mailboxId: string) => mocks.startMailboxReactivation(mailboxId),
}));

const MAILBOX_A = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'primary@example.com',
};
const MAILBOX_B = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'other@example.com',
};

function viewProps(overrides: Partial<NoActiveMailboxViewProps> = {}): NoActiveMailboxViewProps {
  return {
    disconnectedMailboxes: [],
    signingOut: false,
    onConnect: vi.fn(),
    onReactivate: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };
}

describe('NoActiveMailboxView', () => {
  it('offers normal account add when no disconnected mailbox exists', () => {
    const onConnect = vi.fn();
    render(<NoActiveMailboxView {...viewProps({ onConnect })} />);

    const connect = screen.getByRole('button', { name: /connect a gmail account/i });
    expect(connect).toHaveStyle({ minHeight: '44px' });
    fireEvent.click(connect);

    expect(onConnect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('list', { name: /disconnected gmail accounts/i })).toBeNull();
    expect(screen.getByText('Need something else?')).toBeInTheDocument();
    expect(screen.queryByText('Not reconnecting?')).toBeNull();
  });

  it('reactivates the exact sole mailbox and keeps normal account add separate', () => {
    const onConnect = vi.fn();
    const onReactivate = vi.fn();
    render(
      <NoActiveMailboxView
        {...viewProps({
          disconnectedMailboxes: [MAILBOX_A],
          onConnect,
          onReactivate,
        })}
      />,
    );

    const reconnect = screen.getByRole('button', { name: `Reconnect ${MAILBOX_A.email}` });
    expect(reconnect).toHaveStyle({ minHeight: '44px' });
    fireEvent.click(reconnect);
    expect(onReactivate).toHaveBeenCalledWith(MAILBOX_A.id);
    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.queryByText(MAILBOX_A.id)).toBeNull();
    expect(screen.getByText('Not reconnecting?')).toBeInTheDocument();

    const connectDifferent = screen.getByRole('button', {
      name: /connect a different gmail account/i,
    });
    expect(connectDifferent).toHaveStyle({ minHeight: '44px' });
    fireEvent.click(connectDifferent);
    expect(onConnect).toHaveBeenCalledOnce();
    expect(onReactivate).toHaveBeenCalledOnce();
  });

  it('renders multiple disconnected mailboxes as a semantic list with exact actions', () => {
    const onReactivate = vi.fn();
    render(
      <NoActiveMailboxView
        {...viewProps({
          disconnectedMailboxes: [MAILBOX_A, MAILBOX_B],
          onReactivate,
        })}
      />,
    );

    const list = screen.getByRole('list', { name: 'Disconnected Gmail accounts' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText(MAILBOX_A.email)).toBeInTheDocument();
    expect(within(list).getByText(MAILBOX_B.email)).toBeInTheDocument();

    const reconnectOther = within(list).getByRole('button', {
      name: `Reconnect ${MAILBOX_B.email}`,
    });
    expect(reconnectOther).toHaveStyle({ minHeight: '44px' });
    fireEvent.click(reconnectOther);
    expect(onReactivate).toHaveBeenCalledWith(MAILBOX_B.id);
    expect(onReactivate).not.toHaveBeenCalledWith(MAILBOX_A.id);
    expect(screen.queryByText(MAILBOX_A.id)).toBeNull();
    expect(screen.queryByText(MAILBOX_B.id)).toBeNull();
  });

  it('always offers account and billing escape hatches', () => {
    render(<NoActiveMailboxView {...viewProps()} />);

    const manageAccount = screen.getByRole('link', { name: /manage account/i });
    const billing = screen.getByRole('link', { name: 'Billing' });
    expect(manageAccount).toHaveAttribute('href', '/settings#account');
    expect(billing).toHaveAttribute('href', '/billing');
    expect(manageAccount).toHaveStyle({ minHeight: '44px' });
    expect(billing).toHaveStyle({ minHeight: '44px' });
  });

  it('calls onSignOut and disables the button while signing out', () => {
    const onSignOut = vi.fn();
    const { rerender } = render(<NoActiveMailboxView {...viewProps({ onSignOut })} />);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledOnce();

    rerender(<NoActiveMailboxView {...viewProps({ signingOut: true, onSignOut })} />);
    const signOut = screen.getByRole('button', { name: /sign out/i });
    expect(signOut).toBeDisabled();
    expect(signOut).toHaveStyle({ minHeight: '44px' });
  });
});

describe('NoActiveMailbox container', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const me: Me = {
      user: { id: 'u', email: 'u@example.com', workspaceId: 'w' },
      activeMailboxId: null,
      mailboxes: [
        {
          ...MAILBOX_A,
          status: 'disconnected',
          connectedAt: null,
          readiness: null,
        },
      ],
      tier: 'plus',
      cleanupRemaining: null,
    };
    mocks.useAuth.mockReturnValue({ me });
  });

  it('binds sole-mailbox recovery to reactivation and keeps add-account unbound', () => {
    render(<NoActiveMailbox />);

    fireEvent.click(screen.getByRole('button', { name: `Reconnect ${MAILBOX_A.email}` }));
    expect(mocks.startMailboxReactivation).toHaveBeenCalledWith(MAILBOX_A.id);
    expect(mocks.startMailboxConnect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /connect a different gmail account/i }));
    expect(mocks.startMailboxConnect).toHaveBeenCalledWith();
    expect(mocks.startMailboxReactivation).toHaveBeenCalledOnce();
  });
});
