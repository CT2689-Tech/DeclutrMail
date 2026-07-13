import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Me, MeMailbox } from '@/features/auth/api/use-me';
import type { TierEntitlements } from '@/features/auth/api/use-tier';
import type { MailboxHealth } from '@/features/settings/api/use-mailbox-health';
import { AccountMenu } from './account-menu';

const MAILBOX_A: MeMailbox = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'primary@example.com',
  status: 'active',
  connectedAt: '2026-07-01T00:00:00.000Z',
  readiness: 'ready',
};
const MAILBOX_B: MeMailbox = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'other@example.com',
  status: 'active',
  connectedAt: '2026-07-02T00:00:00.000Z',
  readiness: 'ready',
};
const MAILBOX_C: MeMailbox = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'disconnected@example.com',
  status: 'disconnected',
  connectedAt: '2026-07-03T00:00:00.000Z',
  readiness: 'ready',
};

let me: Me;
let healthById: Record<string, MailboxHealth | undefined>;
let entitlements: TierEntitlements;

const startMailboxConnectSpy = vi.fn();
const setActiveMutateSpy = vi.fn();
const disconnectMutateSpy = vi.fn();
const logoutMutateSpy = vi.fn();
const useMailboxesHealthSpy = vi.fn();

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ me }),
}));
vi.mock('@/features/auth/api/use-tier', () => ({
  useTier: () => entitlements,
}));
vi.mock('@/features/settings/api/use-mailbox-health', () => ({
  useMailboxesHealth: (mailboxes: MeMailbox[], opts: { enabled?: boolean }) => {
    useMailboxesHealthSpy(mailboxes, opts);
    return healthById;
  },
}));
vi.mock('./connect-mailbox-url', () => ({
  startMailboxConnect: (mailboxId?: string) => startMailboxConnectSpy(mailboxId),
}));
vi.mock('./api/use-set-active-mailbox', () => ({
  useSetActiveMailbox: () => ({ isPending: false, mutate: setActiveMutateSpy }),
}));
vi.mock('./api/use-disconnect-mailbox', () => ({
  useDisconnectMailbox: () => ({ isPending: false, mutate: disconnectMutateSpy }),
}));
vi.mock('@/features/auth/api/use-logout', () => ({
  useLogout: () => ({ isPending: false, mutate: logoutMutateSpy }),
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn(async () => undefined) }));

function makeMe(mailboxes: MeMailbox[] = [MAILBOX_A, MAILBOX_B]): Me {
  return {
    user: { id: 'u-1', email: 'owner@example.com', workspaceId: 'ws-1' },
    mailboxes,
    activeMailboxId: MAILBOX_A.id,
    tier: 'pro',
    cleanupRemaining: null,
  };
}

async function renderOpenMenu() {
  const user = userEvent.setup();
  render(<AccountMenu />);
  const trigger = screen.getByRole('button', { name: MAILBOX_A.email });
  await user.click(trigger);
  return { user, trigger };
}

describe('AccountMenu Gmail reconnect health', () => {
  beforeEach(() => {
    me = makeMe();
    healthById = {};
    entitlements = {
      tier: 'pro',
      cleanupRemaining: null,
      inboxLimit: 2,
      connectedInboxes: 2,
      atInboxLimit: true,
    };
    startMailboxConnectSpy.mockClear();
    setActiveMutateSpy.mockClear();
    disconnectMutateSpy.mockClear();
    logoutMutateSpy.mockClear();
    useMailboxesHealthSpy.mockClear();
  });

  it('shows selected revoked health, target reconnect at 2/2, and keeps Disconnect reachable', async () => {
    me = makeMe([{ ...MAILBOX_A, readiness: 'failed' }, MAILBOX_B]);
    healthById[MAILBOX_A.id] = { lastSyncedAt: null, needsReconnect: true };
    const { user } = await renderOpenMenu();
    const row = screen.getByTestId(`account-mailbox-${MAILBOX_A.id}`);

    expect(within(row).getByText('Selected')).toBeInTheDocument();
    expect(within(row).getByText('Needs reconnect')).toBeInTheDocument();
    expect(within(row).queryByText('Active')).not.toBeInTheDocument();
    expect(within(row).queryByText('Sync failed')).not.toBeInTheDocument();
    expect(
      within(row).getByRole('button', {
        name: `Selected mailbox ${MAILBOX_A.email}, needs reconnect`,
      }),
    ).toBeEnabled();

    const reconnect = within(row).getByRole('button', { name: `Reconnect ${MAILBOX_A.email}` });
    expect(reconnect).toBeEnabled();
    await user.click(reconnect);
    expect(startMailboxConnectSpy).toHaveBeenCalledWith(MAILBOX_A.id);

    await user.click(within(row).getByRole('button', { name: `Disconnect ${MAILBOX_A.email}` }));
    expect(
      within(row).getByRole('button', { name: `Confirm disconnect ${MAILBOX_A.email}` }),
    ).toBeInTheDocument();
  });

  it('keeps another revoked mailbox selectable and reconnects its exact target at the limit', async () => {
    me = makeMe([MAILBOX_A, { ...MAILBOX_B, readiness: 'failed' }]);
    healthById[MAILBOX_B.id] = { lastSyncedAt: null, needsReconnect: true };
    const { user, trigger } = await renderOpenMenu();
    const row = screen.getByTestId(`account-mailbox-${MAILBOX_B.id}`);

    expect(within(row).getByText('Needs reconnect')).toBeInTheDocument();
    expect(within(row).queryByText('Active')).not.toBeInTheDocument();
    expect(within(row).queryByText('Sync failed')).not.toBeInTheDocument();
    const selector = within(row).getByRole('button', {
      name: `Switch to mailbox ${MAILBOX_B.email}, needs reconnect`,
    });
    expect(selector).toBeEnabled();
    const reconnect = within(row).getByRole('button', { name: `Reconnect ${MAILBOX_B.email}` });
    expect(reconnect).toBeEnabled();
    await user.click(reconnect);
    expect(startMailboxConnectSpy).toHaveBeenCalledWith(MAILBOX_B.id);

    await user.click(selector);
    expect(setActiveMutateSpy).toHaveBeenCalledWith(
      MAILBOX_B.id,
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    const onSuccess = setActiveMutateSpy.mock.calls[0]?.[1]?.onSuccess as (() => void) | undefined;
    act(() => onSuccess?.());
    expect(screen.queryByRole('dialog', { name: 'Gmail accounts' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps disconnected reactivation disabled at 2/2 with persistent limit context', async () => {
    me = makeMe([MAILBOX_A, MAILBOX_B, MAILBOX_C]);
    await renderOpenMenu();
    const row = screen.getByTestId(`account-mailbox-${MAILBOX_C.id}`);
    const reconnect = within(row).getByRole('button', {
      name: `Reconnect ${MAILBOX_C.email}`,
    });

    expect(reconnect).toBeDisabled();
    expect(reconnect).toHaveAttribute('aria-describedby', 'account-menu-inbox-limit-gate');
    expect(screen.getByTestId('inbox-limit-gate')).toHaveTextContent(/2 of 2 inboxes connected/i);
    expect(startMailboxConnectSpy).not.toHaveBeenCalled();
  });

  it('keeps healthy state and normal connect/reactivation behavior unchanged under the limit', async () => {
    me = makeMe([MAILBOX_A, MAILBOX_C]);
    entitlements = {
      ...entitlements,
      connectedInboxes: 1,
      atInboxLimit: false,
    };
    const { user } = await renderOpenMenu();
    const healthyRow = screen.getByTestId(`account-mailbox-${MAILBOX_A.id}`);
    const disconnectedRow = screen.getByTestId(`account-mailbox-${MAILBOX_C.id}`);

    expect(within(healthyRow).getByText('Active')).toBeInTheDocument();
    expect(within(healthyRow).queryByText('Needs reconnect')).not.toBeInTheDocument();
    expect(
      within(healthyRow).queryByRole('button', { name: `Reconnect ${MAILBOX_A.email}` }),
    ).not.toBeInTheDocument();

    await user.click(
      within(disconnectedRow).getByRole('button', { name: `Reconnect ${MAILBOX_C.email}` }),
    );
    expect(startMailboxConnectSpy).toHaveBeenLastCalledWith(undefined);

    await user.click(screen.getByRole('button', { name: '+ Connect another Gmail account' }));
    expect(startMailboxConnectSpy).toHaveBeenLastCalledWith(undefined);
    expect(startMailboxConnectSpy).toHaveBeenCalledTimes(2);
  });

  it('opens as a focus-managed dialog, enables health reads, tabs normally, and Escape restores focus', async () => {
    const user = userEvent.setup();
    render(<AccountMenu />);
    const trigger = screen.getByRole('button', { name: MAILBOX_A.email });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(useMailboxesHealthSpy).toHaveBeenLastCalledWith(me.mailboxes, { enabled: false });

    trigger.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Gmail accounts' });
    expect(dialog).toHaveFocus();
    expect(useMailboxesHealthSpy).toHaveBeenLastCalledWith(me.mailboxes, { enabled: true });
    expect(dialog.getAttribute('style')).toContain('width: 300px');
    expect(dialog.getAttribute('style')).toContain('max-width: calc(100vw - 24px)');
    expect(dialog.getAttribute('style')).toContain('max-height: calc(100vh - 72px)');
    expect(dialog.getAttribute('style')).toContain('overflow-y: auto');
    expect(dialog.getAttribute('style')).toContain('overscroll-behavior: contain');

    await user.tab();
    expect(
      screen.getByRole('button', { name: `Selected mailbox ${MAILBOX_A.email}` }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: `Disconnect ${MAILBOX_A.email}` })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Gmail accounts' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
