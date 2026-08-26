import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Me, MeMailbox } from '@/features/auth/api/use-me';
import { MailboxReconnectBanner } from './mailbox-reconnect-banner';

const startMailboxConnectSpy = vi.fn();

vi.mock('@/features/mailboxes/connect-mailbox-url', () => ({
  startMailboxConnect: (id: string) => startMailboxConnectSpy(id),
}));

let me: Me | undefined;
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ me }),
}));

const ACTIVE: MeMailbox = {
  id: 'mb-active',
  email: 'primary@example.com',
  status: 'active',
  connectedAt: '2026-08-01T00:00:00.000Z',
  readiness: 'ready',
};
const SECOND: MeMailbox = {
  id: 'mb-second',
  email: 'second@example.com',
  status: 'active',
  connectedAt: '2026-08-01T00:00:00.000Z',
  readiness: 'ready',
};

function meWith(mailboxes: MeMailbox[]): Me {
  return {
    user: { id: 'u-1', email: 'primary@example.com', workspaceId: 'w-1', timezone: null },
    mailboxes,
    activeMailboxId: 'mb-active',
    tier: 'free',
    cleanupRemaining: 50,
  };
}

/**
 * The gap this closes: a second mailbox whose Gmail grant was revoked was
 * silent on every primary surface, because the only reconnect banner was
 * mounted with `me.activeMailboxId`. Mail stopped arriving for it and
 * nothing said so (2026-08-18).
 */
describe('MailboxReconnectBanner', () => {
  it('names the broken account the user is NOT looking at', () => {
    me = meWith([ACTIVE, { ...SECOND, needsReconnect: true }]);
    render(<MailboxReconnectBanner />);

    const banner = screen.getByTestId('Gmail account-reconnect-banner');
    expect(banner).toHaveTextContent('second@example.com');
    // Naming it is the point — "Reconnect Gmail" is ambiguous with two
    // mailboxes connected.
    expect(banner).not.toHaveTextContent('primary@example.com');
  });

  it('reconnect is bound to that mailbox, not the active one', async () => {
    me = meWith([ACTIVE, { ...SECOND, needsReconnect: true }]);
    render(<MailboxReconnectBanner />);

    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(startMailboxConnectSpy).toHaveBeenCalledWith('mb-second');
  });

  it('stays silent for the ACTIVE mailbox — SyncErrorBanner already owns it', () => {
    me = meWith([{ ...ACTIVE, needsReconnect: true }, SECOND]);
    render(<MailboxReconnectBanner />);
    expect(screen.queryByTestId('Gmail account-reconnect-banner')).toBeNull();
  });

  it('stays silent for a disconnected mailbox — that is a different state', () => {
    me = meWith([ACTIVE, { ...SECOND, status: 'disconnected', needsReconnect: true }]);
    render(<MailboxReconnectBanner />);
    expect(screen.queryByTestId('Gmail account-reconnect-banner')).toBeNull();
  });

  it('stays silent when the field is absent — a stale API mid rolling deploy (D245)', () => {
    me = meWith([ACTIVE, SECOND]);
    render(<MailboxReconnectBanner />);
    expect(screen.queryByTestId('Gmail account-reconnect-banner')).toBeNull();
  });

  it('renders one row per broken mailbox', () => {
    me = meWith([
      ACTIVE,
      { ...SECOND, needsReconnect: true },
      {
        ...SECOND,
        id: 'mb-third',
        email: 'third@example.com',
        needsReconnect: true,
      },
    ]);
    render(<MailboxReconnectBanner />);
    expect(screen.getAllByTestId('Gmail account-reconnect-banner')).toHaveLength(2);
  });
});
