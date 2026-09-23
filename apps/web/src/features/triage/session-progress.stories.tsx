// Storybook CSF3 stories for the Triage session count (D37, D200).
//
// Storybook itself is seeded in PR 3 (D210). Until the seed lands, this
// file uses the same lightweight local CSF shims as
// `triage-screen.stories.tsx` so it typechecks without
// `@storybook/react` installed.
//
// Variants:
//   • FocusPosition — focus mode: the card's current queue position
//   • ListDecided   — list mode: confirmed decisions + current queue
//   • JustArrived   — nothing decided yet
//   • EmptyQueueRendersNothing — an empty queue renders NOTHING

import { tokens } from '@declutrmail/shared';
import { SessionProgress } from './session-progress';

const { color } = tokens;

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

const meta: StoryMeta<typeof SessionProgress> = {
  title: 'Triage/SessionProgress',
  component: SessionProgress,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Confirmed decisions in this mailbox session and the current rolling queue length. Focus mode also shows the card’s position within that queue. New senders may backfill the queue, so there is no fixed completion percentage.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type Args = Parameters<typeof SessionProgress>[0];

function frame(children: React.ReactNode) {
  return (
    <div
      style={{
        background: color.bg,
        padding: 32,
        display: 'flex',
        justifyContent: 'flex-end',
        minWidth: 320,
      }}
    >
      {children}
    </div>
  );
}

/** Focus mode — two decided, the third sender in the current queue on stage. */
export const FocusPosition: Story<typeof SessionProgress> = {
  args: { decided: 2, queued: 12, focusPosition: 3 },
  render: (args: Args) => frame(<SessionProgress {...args} />),
};

/** List mode — the label counts decisions made. */
export const ListDecided: Story<typeof SessionProgress> = {
  args: { decided: 3, queued: 12 },
  render: (args: Args) => frame(<SessionProgress {...args} />),
};

/** Just arrived — a full queue, no confirmed decisions. */
export const JustArrived: Story<typeof SessionProgress> = {
  args: { decided: 0, queued: 12, focusPosition: 1 },
  render: (args: Args) => frame(<SessionProgress {...args} />),
};

/** An empty queue renders NOTHING — this story proves the null return. */
export const EmptyQueueRendersNothing: Story<typeof SessionProgress> = {
  args: { decided: 3, queued: 0 },
  render: (args: Args) => frame(<SessionProgress {...args} />),
};
