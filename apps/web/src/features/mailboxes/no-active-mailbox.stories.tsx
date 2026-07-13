// Storybook CSF3 stories for the no-active-mailbox gate (D116, D211).
//
// Storybook is seeded in PR 3 (D210). Until that lands this file uses
// the same lightweight CSF shims as `sync-gate.stories.tsx` so it
// typechecks without `@storybook/react` installed. Swap the shims for
// the real imports when the seed lands; the story shapes don't change.
//
// The presentational `NoActiveMailboxView` is storied (props only) so
// every recovery branch renders without mounting AuthProvider.
//
// Variants (D211 edge-state coverage):
//   • Reconnect         — one exact disconnected target
//   • ChooseReconnect   — multiple exact disconnected targets
//   • FirstConnect      — no mailboxes at all (fresh account)

import type { ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';
import { NoActiveMailboxView } from './no-active-mailbox';

const { color } = tokens;

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

const meta: StoryMeta<typeof NoActiveMailboxView> = {
  title: 'Mailboxes/NoActiveMailbox',
  component: NoActiveMailboxView,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Full-screen gate (D116) shown when the user has no active mailbox. Disconnected accounts use exact mailbox-bound reactivation, while connecting a different Gmail account remains a separate action.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type Args = ComponentProps<typeof NoActiveMailboxView>;

function frame(children: React.ReactNode) {
  return <div style={{ background: color.bg, minHeight: '100vh' }}>{children}</div>;
}

const noop = () => {};

/** Reconnect — the user disconnected their last active mailbox. */
export const Reconnect: Story<typeof NoActiveMailboxView> = {
  args: {
    disconnectedMailboxes: [
      { id: '11111111-1111-4111-8111-111111111111', email: 'you@example.com' },
    ],
    signingOut: false,
    onConnect: noop,
    onReactivate: noop,
    onSignOut: noop,
  },
  render: (args: Args) => frame(<NoActiveMailboxView {...args} />),
};

/** Choose reconnect — more than one disconnected Gmail account is recoverable. */
export const ChooseReconnect: Story<typeof NoActiveMailboxView> = {
  args: {
    disconnectedMailboxes: [
      { id: '11111111-1111-4111-8111-111111111111', email: 'personal@example.com' },
      { id: '22222222-2222-4222-8222-222222222222', email: 'work@example.com' },
    ],
    signingOut: false,
    onConnect: noop,
    onReactivate: noop,
    onSignOut: noop,
  },
  render: (args: Args) => frame(<NoActiveMailboxView {...args} />),
};

/** First connect — no mailboxes connected at all. */
export const FirstConnect: Story<typeof NoActiveMailboxView> = {
  args: {
    disconnectedMailboxes: [],
    signingOut: false,
    onConnect: noop,
    onReactivate: noop,
    onSignOut: noop,
  },
  render: (args: Args) => frame(<NoActiveMailboxView {...args} />),
};
