// Storybook CSF3 stories for the D101 RuleCard (rules management).
//
// Same lightweight local CSF shims as the AutopilotScreen stories.
// Variants cover the rule lifecycle: observing (countdown), observe
// window complete, active, paused (Resume affordance), disabled, and
// the dry-run preview panel in its three states (D103/D192).

import type { ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';
import {
  AUTO_ARCHIVE_LOW_ENGAGEMENT,
  AUTO_UNSUBSCRIBE_NOISY,
  LONG_DORMANT_UNSUBSCRIBE,
  RULE_PREVIEW_RESULT,
} from './fixtures';
import { RuleCard } from './rule-card';

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

const meta: StoryMeta<typeof RuleCard> = {
  title: 'Autopilot/RuleCard',
  component: RuleCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One preset rule in the D101 rules-management list: enabled toggle, confidence-threshold slider (presets 1–2 only), last-run summary, pending-suggestion count, observe-window countdown, dry-run preview (D103 scoped per D192) and Resume for paused rules. Canonical K/A/U/L/D verbs only (D227) — the action pill reads Archives / Unsubscribes / Moves to Later.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type CardArgs = ComponentProps<typeof RuleCard>;

const noop = () => undefined;

const baseArgs: CardArgs = {
  rule: AUTO_ARCHIVE_LOW_ENGAGEMENT,
  pendingCount: 2,
  pendingApproximate: false,
  isSaving: false,
  onToggleEnabled: noop,
  onCommitThreshold: noop,
  onResume: noop,
  previewOpen: false,
  preview: null,
  onTogglePreview: noop,
  onRetryPreview: noop,
};

function frame(children: React.ReactNode) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 16, background: color.bg, maxWidth: 760 }}>
      {children}
    </ul>
  );
}

/** Observe window complete — threshold slider visible (confidence preset). */
export const ObserveWindowComplete: Story<typeof RuleCard> = {
  args: baseArgs,
  render: (args: CardArgs) => frame(<RuleCard {...args} />),
};

/** Mid-window — "Observing · N days left" countdown. */
export const Observing: Story<typeof RuleCard> = {
  args: { ...baseArgs, rule: AUTO_UNSUBSCRIBE_NOISY, pendingCount: 0 },
  render: (args: CardArgs) => frame(<RuleCard {...args} />),
};

/** Active rule — emerald pill; acts automatically on new matches. */
export const Active: Story<typeof RuleCard> = {
  args: {
    ...baseArgs,
    rule: {
      ...AUTO_ARCHIVE_LOW_ENGAGEMENT,
      mode: 'active',
      observeWindowEndsAt: null,
      observeWindowElapsed: false,
      // BE contract: the digest is an Observe-mode surface — null otherwise.
      observeDigest: null,
    },
  },
  render: (args: CardArgs) => frame(<RuleCard {...args} />),
};

/** Paused rule — amber pill + the Resume affordance. */
export const Paused: Story<typeof RuleCard> = {
  args: {
    ...baseArgs,
    rule: {
      ...AUTO_ARCHIVE_LOW_ENGAGEMENT,
      mode: 'paused',
      observeWindowEndsAt: null,
      observeWindowElapsed: false,
      observeDigest: null,
    },
  },
  render: (args: CardArgs) => frame(<RuleCard {...args} />),
};

/** Disabled rule (D101 single toggle off) — matcher produces nothing. */
export const Disabled: Story<typeof RuleCard> = {
  args: { ...baseArgs, rule: LONG_DORMANT_UNSUBSCRIBE, pendingCount: 0 },
  render: (args: CardArgs) => frame(<RuleCard {...args} />),
};

/** Dry-run preview open — ready state with the 10-row sample. */
export const PreviewReady: Story<typeof RuleCard> = {
  args: {
    ...baseArgs,
    previewOpen: true,
    preview: { status: 'ready', result: RULE_PREVIEW_RESULT },
  },
  render: (args: CardArgs) => frame(<RuleCard {...args} />),
};

/** Dry-run preview running. */
export const PreviewLoading: Story<typeof RuleCard> = {
  args: { ...baseArgs, previewOpen: true, preview: { status: 'loading' } },
  render: (args: CardArgs) => frame(<RuleCard {...args} />),
};

/** Dry-run preview failed — retry affordance, no auto-retry. */
export const PreviewError: Story<typeof RuleCard> = {
  args: {
    ...baseArgs,
    previewOpen: true,
    preview: { status: 'error', message: 'Dry-run failed (HTTP 500).' },
  },
  render: (args: CardArgs) => frame(<RuleCard {...args} />),
};

/**
 * D10/D101 — a quiet observe week: the digest is zero-filled, so the
 * "would have…" line stays hidden (no noise when nothing matched).
 */
export const ObserveQuietWeek: Story<typeof RuleCard> = {
  args: {
    ...baseArgs,
    rule: {
      ...AUTO_ARCHIVE_LOW_ENGAGEMENT,
      observeDigest: { pendingTotal: 0, senders7d: 0, messages7d: 0 },
    },
    pendingCount: 0,
  },
  render: (args: CardArgs) => frame(<RuleCard {...args} />),
};
