// Storybook CSF3 stories for `RoutePlaceholder` (D211 edge-state
// inventory + D212 empty-state primitive).
//
// Mirrors the local-shim pattern used by sibling stories so the file
// typechecks before the PR-3 Storybook seed merges (D210). Swap the
// shims for `@storybook/react` imports once the seed lands; the story
// shapes do not change.
//
// Variants covered:
//   • Brief        — single primary CTA back to Triage
//   • Snoozed      — primary + secondary CTA (Senders fallback)
//   • Screener     — references the feature name (D227-allowed noun)
//   • SettingsRoot — placeholder with a real next-step (open sub-page)
//   • NoDecisions  — pin the trace-line-omitted branch

import type { ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';

import { RoutePlaceholder } from './route-placeholder';

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

const meta: StoryMeta<typeof RoutePlaceholder> = {
  title: 'Features/RoutePlaceholder',
  component: RoutePlaceholder,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Calm "coming soon" surface used by stub routes whose feature build is queued. Prefer this over a 404 when the sidebar advertises the route.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type Args = ComponentProps<typeof RoutePlaceholder>;

function frame(child: React.ReactNode) {
  return <div style={{ background: tokens.color.bg, minHeight: 480, padding: 24 }}>{child}</div>;
}

export const Brief: Story<typeof RoutePlaceholder> = {
  args: {
    status: 'Planned for V2.1',
    title: 'Daily Brief',
    description:
      "A 60-second summary of yesterday's mail — Reply, FYI, and Noise — ready every morning at 8am local.",
    decisions: ['D61', 'D62', 'D63', 'D67', 'D69', 'D70'],
    primaryCta: { href: '/triage', label: 'Open Triage' },
  },
  render: (args: Args) => frame(<RoutePlaceholder {...args} />),
};

export const Snoozed: Story<typeof RoutePlaceholder> = {
  args: {
    status: 'Planned for V2.1',
    title: 'Snoozed senders',
    description:
      'Hide senders until a wake-time you choose. Future messages from them skip the queue until then.',
    decisions: ['D78', 'D79', 'D80'],
    primaryCta: { href: '/senders', label: 'Open Senders' },
    secondaryCta: { href: '/triage', label: 'Back to Triage' },
  },
  render: (args: Args) => frame(<RoutePlaceholder {...args} />),
};

export const Screener: Story<typeof RoutePlaceholder> = {
  args: {
    status: 'Planned for V2.1',
    title: 'Screener',
    description:
      'A soft-quarantine queue for new senders. Decide once, then they route automatically next time.',
    decisions: ['D71', 'D72', 'D73', 'D74', 'D75', 'D76', 'D77'],
    primaryCta: { href: '/triage', label: 'Open Triage' },
  },
  render: (args: Args) => frame(<RoutePlaceholder {...args} />),
};

export const SettingsRoot: Story<typeof RoutePlaceholder> = {
  args: {
    status: 'Settings',
    title: 'Account preferences',
    description: 'Sender policies are live. Other preferences land soon.',
    decisions: [],
    primaryCta: { href: '/settings/senders', label: 'Open sender policies' },
  },
  render: (args: Args) => frame(<RoutePlaceholder {...args} />),
};

export const NoDecisions: Story<typeof RoutePlaceholder> = {
  args: {
    status: 'Coming soon',
    title: 'A view that is not yet wired to the plan',
    description: 'Trace footer is omitted when no D-numbers are supplied.',
    decisions: [],
    primaryCta: { href: '/triage', label: 'Open Triage' },
  },
  render: (args: Args) => frame(<RoutePlaceholder {...args} />),
};
