// Storybook CSF3 stories for the D104 day-7 observe-window banner.
//
// Same lightweight local CSF shims as the AutopilotScreen stories.
// The banner's honest-copy contract: matches were collected WITHOUT
// acting, and nothing auto-promotes — the user explicitly switches a
// rule to Active (which then goes through the D226 preview modal).

import type { ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';
import { AUTO_ARCHIVE_LOW_ENGAGEMENT, NEWSLETTER_GRAVEYARD } from './fixtures';
import { ObserveWindowBanner } from './observe-window-banner';

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

const meta: StoryMeta<typeof ObserveWindowBanner> = {
  title: 'Autopilot/ObserveWindowBanner',
  component: ObserveWindowBanner,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'D104 day-7 prompt. Listed rules finished their 7-day Observe window — suggestions were collected without touching mail, and the rule keeps observing until the user explicitly switches it to Active (no auto-promote). The CTA opens the D226 ActivateRuleModal preview.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type BannerArgs = ComponentProps<typeof ObserveWindowBanner>;

const ELAPSED_GRAVEYARD = {
  ...NEWSLETTER_GRAVEYARD,
  observeWindowElapsed: true,
};

function frame(children: React.ReactNode) {
  return <div style={{ padding: 16, background: color.bg, maxWidth: 760 }}>{children}</div>;
}

/** One rule finished its window. */
export const OneRule: Story<typeof ObserveWindowBanner> = {
  args: {
    rules: [AUTO_ARCHIVE_LOW_ENGAGEMENT],
    pendingCountByRule: new Map([[AUTO_ARCHIVE_LOW_ENGAGEMENT.id, 2]]),
    pendingApproximate: false,
    onActivate: () => undefined,
  },
  render: (args: BannerArgs) => frame(<ObserveWindowBanner {...args} />),
};

/** Several rules finished at once (typical — presets are seeded together). */
export const MultipleRules: Story<typeof ObserveWindowBanner> = {
  args: {
    rules: [AUTO_ARCHIVE_LOW_ENGAGEMENT, ELAPSED_GRAVEYARD],
    pendingCountByRule: new Map([
      [AUTO_ARCHIVE_LOW_ENGAGEMENT.id, 2],
      [ELAPSED_GRAVEYARD.id, 1],
    ]),
    pendingApproximate: false,
    onActivate: () => undefined,
  },
  render: (args: BannerArgs) => frame(<ObserveWindowBanner {...args} />),
};

/**
 * The buffer hit the BE's 50-row cap — counts are floors, and the
 * copy switches to "in the latest 50" (honest counts, U15 smoke).
 */
export const TruncatedBuffer: Story<typeof ObserveWindowBanner> = {
  args: {
    rules: [AUTO_ARCHIVE_LOW_ENGAGEMENT, ELAPSED_GRAVEYARD],
    pendingCountByRule: new Map([
      [AUTO_ARCHIVE_LOW_ENGAGEMENT.id, 41],
      [ELAPSED_GRAVEYARD.id, 9],
    ]),
    pendingApproximate: true,
    onActivate: () => undefined,
  },
  render: (args: BannerArgs) => frame(<ObserveWindowBanner {...args} />),
};
