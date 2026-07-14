// Storybook CSF3 stories for the Senders grid card (D49, D210).
//
// D49 makes grid the default view — these stories pin the card
// layout used by `SenderGrid` so the design-system gate (D210) can
// catch regressions.

import type { ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';
import type { Sender } from '../data';
import { SenderCard } from './sender-card';

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

const meta: StoryMeta<typeof SenderCard> = {
  title: 'Senders/SenderCard',
  component: SenderCard,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'One sender card on the grid view (D49). Renders avatar + name + domain + single-line stats + K/A/U/L verbs (D227). Per-card width is min(100%, 280px) inside the auto-fit grid.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type CardArgs = ComponentProps<typeof SenderCard>;

const noop = () => undefined;

function sender(overrides: Partial<Sender> = {}): Sender {
  return {
    id: 'story-card',
    name: 'Acme Newsletter',
    domain: 'acme.com',
    monthly: 12,
    group: 'updates',
    read: 0.18,
    spark: [3, 3, 3, 3],
    lastDays: 4,
    unread: 0,
    firstSeenMo: 18,
    volumeTrend: 'steady',
    lastReview: null,
    ...overrides,
  };
}

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
      <SenderCard {...args} />
    </div>
  );
}

/** Default card — eligible for every action. */
export const Default: Story<typeof SenderCard> = {
  args: {
    sender: sender(),
    selected: false,
    onToggleSelect: noop,
    onAction: noop,
    globalMaxTotal: 1000,
  },
  render: frame,
};

/** Selected — primary border highlights the row. */
export const Selected: Story<typeof SenderCard> = {
  args: {
    sender: sender({ name: 'Selected Sender' }),
    selected: true,
    onToggleSelect: noop,
    onAction: noop,
    globalMaxTotal: 1000,
  },
  render: frame,
};

/** Protected — Unsubscribe + Archive disabled. */
export const Protected: Story<typeof SenderCard> = {
  args: {
    sender: sender({ name: 'Protected Sender', protected: true }),
    selected: false,
    onToggleSelect: noop,
    onAction: noop,
    globalMaxTotal: 1000,
  },
  render: frame,
};
