// Storybook CSF3 stories for the D226 ActivateRuleModal — the
// Observe → Active confirm sheet with the embedded first-sweep
// dry-run (D10/D103). Same lightweight local CSF shims as the
// AutopilotScreen stories.
//
// The gating contract on display: Confirm ("Switch to Active") is
// DISABLED until the preview resolves — loading and error states keep
// the mutation locked, error offers retry. Canonical K/A/U/L/D verbs
// only (D227).

import type { ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';
import { ActivateRuleModal } from './activate-rule-modal';
import { AUTO_ARCHIVE_LOW_ENGAGEMENT, RULE_PREVIEW_RESULT } from './fixtures';

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

const meta: StoryMeta<typeof ActivateRuleModal> = {
  title: 'Autopilot/ActivateRuleModal',
  component: ActivateRuleModal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'D226 mandatory preview for the Observe → Active switch. The sheet spells out what changes going forward AND embeds the first-sweep dry-run (the same POST /rules/:id/preview the rule card uses). Confirm is gated on the preview resolving — never activate blind.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type ModalArgs = ComponentProps<typeof ActivateRuleModal>;

const noop = () => undefined;

const baseArgs: ModalArgs = {
  rule: AUTO_ARCHIVE_LOW_ENGAGEMENT,
  pendingCount: 2,
  pendingApproximate: false,
  preview: { status: 'ready', result: RULE_PREVIEW_RESULT },
  onRetryPreview: noop,
  isActivating: false,
  error: null,
  onCancel: noop,
  onConfirm: noop,
};

function frame(children: React.ReactNode) {
  return <div style={{ minHeight: 480, background: color.bg }}>{children}</div>;
}

/** Preview resolved — sample senders listed, Confirm enabled. */
export const PreviewReady: Story<typeof ActivateRuleModal> = {
  args: baseArgs,
  render: (args: ModalArgs) => frame(<ActivateRuleModal {...args} />),
};

/** Dry-run still running — Confirm stays disabled (the D226 gate). */
export const PreviewLoading: Story<typeof ActivateRuleModal> = {
  args: { ...baseArgs, preview: { status: 'loading' } },
  render: (args: ModalArgs) => frame(<ActivateRuleModal {...args} />),
};

/** Dry-run failed — retry offered, Confirm stays disabled. */
export const PreviewError: Story<typeof ActivateRuleModal> = {
  args: {
    ...baseArgs,
    preview: { status: 'error', message: 'Dry-run failed (HTTP 500).' },
  },
  render: (args: ModalArgs) => frame(<ActivateRuleModal {...args} />),
};

/** Confirm clicked — PATCH in flight. */
export const Activating: Story<typeof ActivateRuleModal> = {
  args: { ...baseArgs, isActivating: true },
  render: (args: ModalArgs) => frame(<ActivateRuleModal {...args} />),
};
