// Storybook CSF3 stories for the MailboxReconnectBanner (D224 reconnect
// gate for NON-active mailboxes; D210/D211 hidden + visible states).
//
// The banner reads only `useAuth()` — `me.mailboxes[].needsReconnect` is
// server-computed — so a story is just a seeded `me`, with no sync-status
// cache to prime. That is the point of the surface: it costs no reads.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { tokens } from '@declutrmail/shared';

import { AuthProvider } from '@/features/auth/auth-provider';
import { ME_QUERY_KEY, type Me, type MeMailbox } from '@/features/auth/api/use-me';

import { MailboxReconnectBanner } from './mailbox-reconnect-banner';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

const { color, font } = tokens;

const ACTIVE: MeMailbox = {
  id: 'mb-1',
  email: 'primary@example.com',
  status: 'active',
  connectedAt: null,
  readiness: 'ready',
};
const SECOND: MeMailbox = {
  id: 'mb-2',
  email: 'second@example.com',
  status: 'active',
  connectedAt: null,
  readiness: 'ready',
};
const THIRD: MeMailbox = {
  id: 'mb-3',
  email: 'third@example.com',
  status: 'active',
  connectedAt: null,
  readiness: 'ready',
};

function meWith(mailboxes: MeMailbox[]): Me {
  return {
    user: { id: 'u-1', email: 'primary@example.com', workspaceId: 'w-1', timezone: null },
    activeMailboxId: 'mb-1',
    mailboxes,
    tier: 'pro',
    cleanupRemaining: null,
  };
}

function frame(mailboxes: MeMailbox[], note: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ME_QUERY_KEY, meWith(mailboxes));
  return (
    <div style={{ background: color.bg, minHeight: 200 }}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <MailboxReconnectBanner />
        </AuthProvider>
      </QueryClientProvider>
      <p
        style={{ fontFamily: font.sans, fontSize: 12, color: color.fgMuted, padding: '12px 20px' }}
      >
        {note}
      </p>
    </div>
  );
}

const meta: StoryMeta<typeof MailboxReconnectBanner> = {
  title: 'Mailboxes/MailboxReconnectBanner',
  component: MailboxReconnectBanner,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Reconnect gate for broken mailboxes the user is NOT currently viewing (D224). ' +
          'SyncErrorBanner covers the active mailbox; before this, a second mailbox whose ' +
          'Gmail grant had been revoked was silent everywhere except the account-switcher ' +
          'dialog and Settings, so its mail stopped arriving with no visible signal. Each row ' +
          'names its account and its reconnect is bound to that mailbox id.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Visible — a second mailbox needs reconnecting. */
export const Visible: Story<typeof MailboxReconnectBanner> = {
  render: () =>
    frame(
      [ACTIVE, { ...SECOND, needsReconnect: true }],
      'The non-active mailbox is named, because "Reconnect Gmail" is ambiguous with two connected.',
    ),
};

/** Visible — every broken mailbox gets its own row. */
export const MultipleBroken: Story<typeof MailboxReconnectBanner> = {
  render: () =>
    frame(
      [ACTIVE, { ...SECOND, needsReconnect: true }, { ...THIRD, needsReconnect: true }],
      'One row per broken mailbox — each reconnect is target-bound to its own account.',
    ),
};

/** Hidden — the ACTIVE mailbox is SyncErrorBanner’s job, not this one. */
export const HiddenForActiveMailbox: Story<typeof MailboxReconnectBanner> = {
  render: () =>
    frame(
      [{ ...ACTIVE, needsReconnect: true }, SECOND],
      'SyncErrorBanner already gates the active mailbox with status-aware copy — rendering ' +
        'both would double the same alarm.',
    ),
};

/** Hidden — nothing is broken. */
export const HiddenWhenHealthy: Story<typeof MailboxReconnectBanner> = {
  render: () => frame([ACTIVE, SECOND], 'No mailbox needs reconnecting — nothing renders.'),
};

/** Hidden — a stale API mid rolling deploy omits the field entirely (D245). */
export const HiddenOnStaleApi: Story<typeof MailboxReconnectBanner> = {
  render: () =>
    frame(
      // SECOND carries no `needsReconnect` at all — exactly the shape an
      // older API serves mid-deploy.
      [ACTIVE, SECOND],
      'Field absent reads as "no reconnect needed" — the banner fails quiet rather than ' +
        'false-alarming against an older API during a rolling deploy.',
    ),
};
