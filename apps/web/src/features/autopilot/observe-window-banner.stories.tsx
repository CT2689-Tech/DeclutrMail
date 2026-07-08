// Storybook CSF3 stories for the D10 day-7 observe-window prompt.
//
// Same lightweight local CSF shims as the AutopilotScreen stories.
// The banner's honest-copy contract: matches were collected WITHOUT
// acting, and nothing auto-promotes — the user explicitly switches a
// rule to Active (which then goes through the D226 preview modal).
// Each row carries the Observe-mode digest ("would have archived N
// emails from M senders in the last 7 days") and a persisted "Not now"
// dismissal (D10).

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
          'D10 day-7 prompt. Listed rules finished their 7-day Observe window with ≥1 pending match — suggestions were collected without touching mail, and the rule keeps observing until the user explicitly switches it to Active (no auto-promote). Each row shows the verb-honest digest, a persisted "Not now" dismissal, and the CTA that opens the D226 ActivateRuleModal preview.',
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

/** One rule finished its window — digest copy + Not now + Switch to Active. */
export const OneRule: Story<typeof ObserveWindowBanner> = {
  args: {
    rules: [AUTO_ARCHIVE_LOW_ENGAGEMENT],
    onActivate: () => undefined,
    onDismiss: () => undefined,
    dismissingRuleId: null,
  },
  render: (args: BannerArgs) => frame(<ObserveWindowBanner {...args} />),
};

/** Several rules finished at once (typical — presets are seeded together). */
export const MultipleRules: Story<typeof ObserveWindowBanner> = {
  args: {
    rules: [AUTO_ARCHIVE_LOW_ENGAGEMENT, ELAPSED_GRAVEYARD],
    onActivate: () => undefined,
    onDismiss: () => undefined,
    dismissingRuleId: null,
  },
  render: (args: BannerArgs) => frame(<ObserveWindowBanner {...args} />),
};

/** A "Not now" PATCH is in flight — that row's buttons disable. */
export const DismissInFlight: Story<typeof ObserveWindowBanner> = {
  args: {
    rules: [AUTO_ARCHIVE_LOW_ENGAGEMENT, ELAPSED_GRAVEYARD],
    onActivate: () => undefined,
    onDismiss: () => undefined,
    dismissingRuleId: AUTO_ARCHIVE_LOW_ENGAGEMENT.id,
  },
  render: (args: BannerArgs) => frame(<ObserveWindowBanner {...args} />),
};
