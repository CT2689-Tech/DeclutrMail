// Storybook CSF3 stories for the Settings → Mailboxes card (U23 —
// D114/D115 scoped). Local CSF shims per the existing stories pattern.
//
// Variants covered:
//   • TwoConnected     — both accounts active, one marked Active,
//                        humanized last-synced stamps
//   • Syncing          — second account mid initial-sync
//   • SyncFailed       — readiness failed tag
//   • NeedsReconnect   — OAuth grant gone on an active account
//                        (danger tag + Reconnect affordance)
//   • Disconnected     — one account disconnected (Reconnect)
//   • AtLimit          — connect + reconnect disabled at the tier's
//                        inboxLimit
//   • Empty            — zero mailboxes connected

import type { ComponentProps } from 'react';
import { MailboxesCard } from './mailboxes-card';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  parameters?: Record<string, unknown>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

const meta: StoryMeta<typeof MailboxesCard> = {
  title: 'Settings/MailboxesCard',
  component: MailboxesCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Settings → Mailboxes (D114 "Inboxes" + D115 health, scoped). Connected Gmail accounts with status / readiness / last-synced stamp / active marker, a Reconnect affordance for disconnected or invalid-grant accounts (same OAuth flow as connect-another), and connect-another gated by the tier inboxLimit. Switch / disconnect stay in the header account menu (reuse, not rebuild).',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type CardArgs = ComponentProps<typeof MailboxesCard>;

const noop = () => undefined;

const MAILBOX_A = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'chintan.a.thakkar@gmail.com',
  status: 'active' as const,
  connectedAt: '2026-05-01T00:00:00.000Z',
  readiness: 'ready' as const,
};

const MAILBOX_B = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'chintan.a.thakkar.crypt@gmail.com',
  status: 'active' as const,
  connectedAt: '2026-06-01T00:00:00.000Z',
  readiness: 'ready' as const,
};

/** Health map with fresh last-synced stamps (relative to story render). */
const HEALTHY = {
  [MAILBOX_A.id]: {
    lastSyncedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    needsReconnect: false,
  },
  [MAILBOX_B.id]: {
    lastSyncedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
    needsReconnect: false,
  },
};

const baseArgs: CardArgs = {
  mailboxes: [MAILBOX_A, MAILBOX_B],
  activeMailboxId: MAILBOX_A.id,
  inboxLimit: 2,
  healthById: HEALTHY,
  onConnect: noop,
};

export const TwoConnected: Story<typeof MailboxesCard> = {
  args: { ...baseArgs, inboxLimit: 3 },
};

export const Syncing: Story<typeof MailboxesCard> = {
  args: {
    ...baseArgs,
    inboxLimit: 3,
    mailboxes: [MAILBOX_A, { ...MAILBOX_B, readiness: 'syncing' as const }],
    healthById: { [MAILBOX_A.id]: HEALTHY[MAILBOX_A.id] },
  },
};

export const SyncFailed: Story<typeof MailboxesCard> = {
  args: {
    ...baseArgs,
    inboxLimit: 3,
    mailboxes: [MAILBOX_A, { ...MAILBOX_B, readiness: 'failed' as const }],
    healthById: { [MAILBOX_A.id]: HEALTHY[MAILBOX_A.id] },
  },
};

export const NeedsReconnect: Story<typeof MailboxesCard> = {
  args: {
    ...baseArgs,
    inboxLimit: 3,
    healthById: {
      [MAILBOX_A.id]: HEALTHY[MAILBOX_A.id],
      [MAILBOX_B.id]: {
        lastSyncedAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
        needsReconnect: true,
      },
    },
  },
};

export const Disconnected: Story<typeof MailboxesCard> = {
  args: {
    ...baseArgs,
    inboxLimit: 3,
    mailboxes: [MAILBOX_A, { ...MAILBOX_B, status: 'disconnected' as const }],
    healthById: { [MAILBOX_A.id]: HEALTHY[MAILBOX_A.id] },
  },
};

export const AtLimit: Story<typeof MailboxesCard> = {
  args: baseArgs,
};

export const Empty: Story<typeof MailboxesCard> = {
  args: {
    ...baseArgs,
    mailboxes: [],
    activeMailboxId: null,
    healthById: {},
  },
};
