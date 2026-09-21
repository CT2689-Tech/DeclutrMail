// Storybook CSF3 stories for the Triage session burn-down (D37, D200).
//
// Storybook itself is seeded in PR 3 (D210). Until the seed lands, this
// file uses the same lightweight local CSF shims as
// `triage-screen.stories.tsx` so it typechecks without
// `@storybook/react` installed.
//
// Variants:
//   • FocusPosition — focus mode: the card's position, "3 of 12"
//   • ListDecided   — list mode: decisions made, "3 of 12"
//   • JustArrived   — nothing has left the queue yet (empty bar)
//   • EmptyQueueRendersNothing — a zero total renders NOTHING

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
          'The Triage screen’s one count — "3 of 12" plus a thin bar. `total` is the longest the queue has been this session and `done` is how many have left it; both are read off the queue, which only shrinks on a server-confirmed decision (D226), so the bar can never run ahead of reality.',
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

/** Focus mode — two decided, the third sender on stage. */
export const FocusPosition: Story<typeof SessionProgress> = {
  args: { current: 3, done: 2, total: 12, label: 'Decision 3 of 12' },
  render: (args: Args) => frame(<SessionProgress {...args} />),
};

/** List mode — the label counts decisions made. */
export const ListDecided: Story<typeof SessionProgress> = {
  args: { current: 3, done: 3, total: 12, label: '3 of 12 decided' },
  render: (args: Args) => frame(<SessionProgress {...args} />),
};

/** Just arrived — a full queue, an empty bar. */
export const JustArrived: Story<typeof SessionProgress> = {
  args: { current: 1, done: 0, total: 12, label: 'Decision 1 of 12' },
  render: (args: Args) => frame(<SessionProgress {...args} />),
};

/** A zero total renders NOTHING — this story is the contract proof of the null return. */
export const EmptyQueueRendersNothing: Story<typeof SessionProgress> = {
  args: { current: 0, done: 0, total: 0, label: 'Decision 0 of 0' },
  render: (args: Args) => frame(<SessionProgress {...args} />),
};
