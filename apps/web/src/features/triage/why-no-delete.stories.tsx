// Storybook CSF3 stories for the Triage "Where's Delete?" note (D227,
// ADR-0019).
//
// Storybook itself is seeded in PR 3 (D210). Until the seed lands, this
// file uses the same lightweight local CSF shims as
// `triage-screen.stories.tsx` so it typechecks without
// `@storybook/react` installed.
//
// The single variant is the contract proof: Triage keeps to the four
// daily verbs K/A/U/L (D29 + D227); Delete lives on Senders / Sender
// Detail. This note keeps that split from reading as a missing feature.

import { tokens } from '@declutrmail/shared';
import { WhyNoDelete } from './why-no-delete';

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

const meta: StoryMeta<typeof WhyNoDelete> = {
  title: 'Triage/WhyNoDelete',
  component: WhyNoDelete,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'One-line note under the triage queue. Per D227 Triage uses exactly the four daily verbs K/A/U/L — Delete (ADR-0019’s fifth canonical verb) lives on Senders / Sender Detail. The note points there so the four-verb toolbar never reads as a gap.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

function frame(children: React.ReactNode) {
  return <div style={{ background: color.bg, padding: 32, maxWidth: 720 }}>{children}</div>;
}

/** Default — the note as it renders beneath the queue. */
export const Default: Story<typeof WhyNoDelete> = {
  render: () => frame(<WhyNoDelete />),
};
