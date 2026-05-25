// Storybook CSF3 stories for the promoted `<EmptyState />` primitive
// (D212).
//
// Mirrors the local-shim pattern used by `privacy-badge.stories.tsx`
// and `undo-tray.stories.tsx` so it typechecks before the PR-3
// Storybook seed lands (D210). Swap the shims for `@storybook/react`
// imports when the seed merges; the story shapes do not change.
//
// Variants covered (D211/D212 + Storybook contract):
//   • Default        — minimal title-only empty state
//   • WithIcon       — icon + title + description
//   • WithAction     — adds a primary CTA
//   • WithUpgradeNudge — tier='free' renders D33-style upgrade copy
//   • SenderEmpty    — Senders new-user empty-state framing
//   • Compact        — short title, no body

import type { ComponentProps } from 'react';
import { Button } from '../button';
import { color } from '../../tokens/tokens';
import { EmptyState } from './empty-state';

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

const meta: StoryMeta<typeof EmptyState> = {
  title: 'Primitives/EmptyState',
  component: EmptyState,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Empty-state primitive (D212). Every list/queue/index surface that can be empty uses this — premium products do not show "0 results" placeholders. Tier-aware: when `tier="free"` and a `tierNudge` is supplied, the D33-style upgrade nudge renders beneath the action.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type EmptyArgs = ComponentProps<typeof EmptyState>;

function frame(child: React.ReactNode) {
  return <div style={{ background: color.bg, padding: 32, maxWidth: 560 }}>{child}</div>;
}

/** Default — title-only, the lightest variant. */
export const Default: Story<typeof EmptyState> = {
  args: { title: 'Nothing queued today' },
  render: (args: EmptyArgs) => frame(<EmptyState {...args} />),
};

/** With icon + description — the typical first-run framing. */
export const WithIcon: Story<typeof EmptyState> = {
  args: {
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
    title: 'No senders yet',
    description: 'Once your mailbox finishes syncing, the senders who mail you will appear here.',
  },
  render: (args: EmptyArgs) => frame(<EmptyState {...args} />),
};

/** With action — surfaces a CTA when the user has a clear next step. */
export const WithAction: Story<typeof EmptyState> = {
  args: {
    title: 'No senders match your filters',
    description: 'Try a different search or clear the filters.',
    action: <Button onClick={() => undefined}>Clear filters</Button>,
  },
  render: (args: EmptyArgs) => frame(<EmptyState {...args} />),
};

/** Free-tier with upgrade nudge — generalisation of the D33 pattern. */
export const WithUpgradeNudge: Story<typeof EmptyState> = {
  args: {
    title: "You cleared today's queue.",
    description: 'The engine refreshes overnight. Come back tomorrow for the next batch.',
    tier: 'free',
    tierNudge: {
      headline: "You're out of free decisions today.",
      body: 'Plus removes the daily cap and unlocks Autopilot rules.',
      cta: (
        <Button tone="primary" size="sm" onClick={() => undefined}>
          See Plus
        </Button>
      ),
    },
  },
  render: (args: EmptyArgs) => frame(<EmptyState {...args} />),
};

/** Senders empty state — the D211 "new user, no senders yet" framing. */
export const SenderEmpty: Story<typeof EmptyState> = {
  args: {
    title: 'No senders yet',
    description:
      "DeclutrMail is watching for new patterns. Once your mailbox finishes syncing, you'll see senders grouped by behaviour.",
  },
  render: (args: EmptyArgs) => frame(<EmptyState {...args} />),
};

/** Compact — title only, used inline beneath a section header. */
export const Compact: Story<typeof EmptyState> = {
  args: {
    title: 'No decisions yet',
  },
  render: (args: EmptyArgs) => frame(<EmptyState {...args} />),
};
