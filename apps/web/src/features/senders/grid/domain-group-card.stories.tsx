// Storybook CSF3 stories for the brand-rollup group card (D51, D210).
//
// `DomainGroupCard` is the header row for a registrable-domain group on
// the Senders grid — it collapses many rows from the same brand (e.g.
// 134 amazon.com rows) into one expandable entry. These stories pin the
// collapsed / expanded chrome so the design-system gate (D210) can catch
// regressions; the group's MEMBERS render as ordinary `SenderCard`s and
// are covered by that component's own stories.

import type { ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';
import { DomainGroupCard } from './domain-group-card';

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

const meta: StoryMeta<typeof DomainGroupCard> = {
  title: 'Senders/DomainGroupCard',
  component: DomainGroupCard,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Brand-rollup group header row (D51 — eTLD+1 grouping). Shows the shared registrable domain + aggregate counts (senders · 30d volume · lifetime total) and an expand control. Group-level actions are deliberately absent in v1 — expansion + per-sender actions only, so every mutation keeps its per-sender D226 preview.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type CardArgs = ComponentProps<typeof DomainGroupCard>;

const noop = () => undefined;

function frame(args: CardArgs) {
  return (
    <div
      style={{
        background: color.bg,
        padding: 24,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
        gap: 12,
        maxWidth: 1180,
      }}
    >
      <DomainGroupCard {...args} />
    </div>
  );
}

/** Collapsed — the default group row: "Show N senders ▾". */
export const Collapsed: Story<typeof DomainGroupCard> = {
  args: {
    domain: 'amazon.com',
    senderCount: 12,
    volume30d: 148,
    totalReceived: 4820,
    expanded: false,
    onToggleExpand: noop,
  },
  render: frame,
};

/** Expanded — inverted control reads "Hide senders ▴"; members render below. */
export const Expanded: Story<typeof DomainGroupCard> = {
  args: {
    domain: 'google.com',
    senderCount: 7,
    volume30d: 63,
    totalReceived: 1290,
    expanded: true,
    onToggleExpand: noop,
  },
  render: frame,
};

/** Large brand — compact-formatted aggregates (12.5k total ever). */
export const LargeBrand: Story<typeof DomainGroupCard> = {
  args: {
    domain: 'linkedin.com',
    senderCount: 34,
    volume30d: 512,
    totalReceived: 12480,
    expanded: false,
    onToggleExpand: noop,
  },
  render: frame,
};

/** Minimum group — exactly the 3-sender rollup threshold, low volume. */
export const MinimumGroup: Story<typeof DomainGroupCard> = {
  args: {
    domain: 'bbc.co.uk',
    senderCount: 3,
    volume30d: 4,
    totalReceived: 96,
    expanded: false,
    onToggleExpand: noop,
  },
  render: frame,
};
