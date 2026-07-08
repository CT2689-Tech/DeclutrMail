// Storybook CSF3 stories for the Triage session burn-down (D37, D200).
//
// Storybook itself is seeded in PR 3 (D210). Until the seed lands, this
// file uses the same lightweight local CSF shims as
// `triage-screen.stories.tsx` so it typechecks without
// `@storybook/react` installed.
//
// Variants cover the burn-down's whole range:
//   • MidSession   — some decided, more to go (the common case)
//   • JustStarted  — one decided, a full queue behind it
//   • AllDone      — everything decided this session (100% bar, "all done")
//   • FreshArrival — 0 decided → renders NOTHING (a "0 decided" bar is
//                    noise; the burn-down only appears after the first
//                    confirmed decision).

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
          'Session burn-down for the triage header — "X decided · Y to go" plus a thin progress bar. `decided` is the client-session counter (D200 — ephemeral, resets on mount); it increments ONLY on server confirmation (D226), so the bar can never run ahead of reality. Renders nothing until the first confirmed decision.',
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

/** Mid-session — 3 decided, 5 still waiting (the common case). */
export const MidSession: Story<typeof SessionProgress> = {
  args: { decided: 3, remaining: 5 },
  render: (args: Args) => frame(<SessionProgress {...args} />),
};

/** Just started — one decision in, a full queue behind it. */
export const JustStarted: Story<typeof SessionProgress> = {
  args: { decided: 1, remaining: 11 },
  render: (args: Args) => frame(<SessionProgress {...args} />),
};

/** All done — everything decided this session: full bar + "all done". */
export const AllDone: Story<typeof SessionProgress> = {
  args: { decided: 9, remaining: 0 },
  render: (args: Args) => frame(<SessionProgress {...args} />),
};

/**
 * Fresh arrival — 0 decided renders NOTHING. A "0 decided" bar on
 * arrival is noise; the queue legend already carries the waiting count.
 * This story is the contract proof of the null return.
 */
export const FreshArrivalRendersNothing: Story<typeof SessionProgress> = {
  args: { decided: 0, remaining: 8 },
  render: (args: Args) => frame(<SessionProgress {...args} />),
};
