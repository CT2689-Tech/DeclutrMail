import type { AnchorHTMLAttributes } from 'react';

/** Synthetic identity only. No provider, mailbox, telemetry or billing request can leave this fixture. */
export function useAuth() {
  return {
    me: {
      user: { id: 'fixture-user', email: 'owner@example.invalid' },
      activeMailboxId: 'fixture-mailbox',
      tier: 'free',
      mailboxes: [
        {
          id: 'fixture-mailbox',
          email: 'owner@example.invalid',
          status: 'active',
          readiness: 'ready',
        },
      ],
    },
  };
}

export function useUpgradeReturnTo() {
  return '/activity';
}

export function useMailboxesHealth() {
  return {};
}

function mutation() {
  return {
    isPending: false,
    mutate: () => {
      throw new Error('Mailbox mutations are unavailable in the isolated overlay fixture');
    },
  };
}

export const useSetActiveMailbox = mutation;
export const useDisconnectMailbox = mutation;
export const useDeleteMailboxIndexedData = mutation;
export const useLogout = mutation;
export const track = async () => undefined;
export const reportPassSecondAccountGate = () => undefined;

export async function loadMailboxDataControls() {
  return { MailboxDataControlsDialog: () => null };
}

/** The real menu's href and onClick are retained, without requiring Next's router context. */
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
