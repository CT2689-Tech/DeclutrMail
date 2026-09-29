// Storybook CSF3 stories for the post-sync first-cleanup nudge (D210).
//
// The states that matter are the two the Senders screen actually reaches:
// the nudge itself, and (by omission) the "already cleaned up" case,
// which is simply not rendering this component.

import type { ComponentProps } from 'react';
import { FirstCleanupNudge } from './first-cleanup-nudge';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  parameters?: Record<string, unknown>;
};

const meta: StoryMeta<typeof FirstCleanupNudge> = {
  title: 'Senders/FirstCleanupNudge',
  component: FirstCleanupNudge,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Post-sync nudge on Senders when the mailbox is ready, senders are visible, and no action_jobs row is done. Independent of onboarded_at (D113).',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type Args = ComponentProps<typeof FirstCleanupNudge>;

export const Default: Story<typeof FirstCleanupNudge> = {
  args: { href: '/senders/a' } satisfies Args,
};
