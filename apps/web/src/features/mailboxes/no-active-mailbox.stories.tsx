// Storybook CSF3 stories for the no-active-mailbox gate (D116, D211).
//
// Storybook is seeded in PR 3 (D210). Until that lands this file uses
// the same lightweight CSF shims as `sync-gate.stories.tsx` so it
// typechecks without `@storybook/react` installed. Swap the shims for
// the real imports when the seed lands; the story shapes don't change.
//
// The presentational `NoActiveMailboxView` is storied (props only) so
// both branches render without mounting AuthProvider.
//
// Variants (D211 edge-state coverage):
//   • Reconnect    — last active mailbox disconnected (history preserved)
//   • FirstConnect — no mailboxes at all (fresh account)

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
          'Full-screen gate (D116) shown when the user has no active mailbox — they disconnected their last (or only) account. Offers the one action that resolves it: reconnect / connect a Gmail account. Without this the dashboard 409s and renders broken.',
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
    disconnectedEmails: ['you@example.com'],
    signingOut: false,
    onConnect: noop,
    onSignOut: noop,
  },
  render: (args: Args) => frame(<NoActiveMailboxView {...args} />),
};

/** First connect — no mailboxes connected at all. */
export const FirstConnect: Story<typeof NoActiveMailboxView> = {
  args: {
    disconnectedEmails: [],
    signingOut: false,
    onConnect: noop,
    onSignOut: noop,
  },
  render: (args: Args) => frame(<NoActiveMailboxView {...args} />),
};
