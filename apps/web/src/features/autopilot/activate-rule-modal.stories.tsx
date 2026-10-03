// Storybook CSF3 stories for the D226 ActivateRuleModal — the
// Observe → Active confirm sheet with the embedded first-sweep
// dry-run (D10/D103). Same lightweight local CSF shims as the
// AutopilotScreen stories.
//
// The gating contract on display: Confirm ("Switch to Active") is
// DISABLED until the preview resolves — loading and error states keep
// the mutation locked, error offers retry. Canonical K/A/U/L/D verbs
// only (D227).

import { useMemo, useRef, useState, type ComponentProps } from 'react';
import type { AutopilotPreviewSenderPageDto } from '@/lib/api/autopilot';
import { tokens } from '@declutrmail/shared';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { ActivateRuleModal } from './activate-rule-modal';
import { AUTO_ARCHIVE_LOW_ENGAGEMENT, NEWSLETTER_GRAVEYARD, RULE_PREVIEW_RESULT } from './fixtures';

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
  undoWindowDays: TIER_MANIFEST.plus.undoWindowDays,
  onRetryPreview: noop,
  isActivating: false,
  error: null,
  onCancel: noop,
  onConfirm: noop,
};

function frame(children: React.ReactNode) {
  return <div style={{ minHeight: 480, background: color.bg }}>{children}</div>;
}

/**
 * The ENABLE entry point — the rule is off and the toggle opened this.
 * Two commit paths: run it, or watch first. Both gate on the dry-run.
 */
export const EnableWithWatchFirst: Story<typeof ActivateRuleModal> = {
  args: { ...baseArgs, rule: NEWSLETTER_GRAVEYARD, intent: 'enable', onWatchFirst: noop },
  render: (args: ModalArgs) => frame(<ActivateRuleModal {...args} />),
};

/** Long sender evidence must scroll inside the sheet, above persistent actions. */
export const NewsletterLongDetails: Story<typeof ActivateRuleModal> = {
  args: {
    ...baseArgs,
    rule: { ...NEWSLETTER_GRAVEYARD, enabled: false },
    intent: 'enable',
    onWatchFirst: noop,
    mailboxEmail: 'alex@example.com',
    pendingCount: 0,
    preview: {
      status: 'ready',
      result: {
        ...RULE_PREVIEW_RESULT,
        ruleId: NEWSLETTER_GRAVEYARD.id,
        wouldMatchCount: 23,
        actionableSenderCount: 23,
        actionableMessageCount: 189,
        protectedWouldMatchCount: 0,
        evaluatedSenders: 3259,
        dailyActionCap: 25,
        weeklyVolume: {
          observedMatches: 0,
          observedDays: 7,
          estimatedMatches: 0,
          basis: 'observed_7d',
        },
        sample: [],
      },
    },
  },
  render: (args: ModalArgs) => frame(<SenderPreviewDemo args={args} total={23} />),
};

const newsletterNames = [
  'Bargain Bulletin',
  'Field Notes',
  'Weekend Journal',
  'Travel Dispatch',
  'The Daily Edit',
  'Studio Updates',
  'Design Digest',
  'Home & Garden',
  'City Guide',
  'Morning Brief',
  'Market Notes',
  'The Sunday Read',
  'Kitchen Dispatch',
  'Culture Weekly',
  'Science Digest',
  'Book Club',
  'Outdoor Journal',
  'Style Edit',
  'Film Notes',
  'Tech Bulletin',
  'Wellness Weekly',
  'Craft Journal',
  'Evening Dispatch',
];
const inboxCounts = [42, 0, 15, 8, 3, 5, 4, 1, 2, 6, 8, 7, 9, 6, 10, 5, 9, 8, 7, 9, 6, 10, 9];

function demoPage(
  total: number,
  page: number,
  revision: number,
  expired: boolean,
): AutopilotPreviewSenderPageDto {
  const start = (page - 1) * 25;
  return {
    previewId: `11111111-1111-4111-8111-${revision.toString(16).padStart(12, '0')}`,
    expiresAt: new Date(Date.now() + (expired ? -1000 : 300_000)).toISOString(),
    page,
    pageSize: 25,
    total,
    senders: Array.from({ length: Math.min(25, total - start) }, (_, offset) => {
      const index = start + offset;
      return {
        senderKey: index.toString(16).padStart(64, '0'),
        senderName: newsletterNames[index] ?? `Newsletter ${index + 1}`,
        senderEmail: `newsletter-${index + 1}@example.com`,
        inboxCount: inboxCounts[index] ?? index % 12,
        reason: `Read rate ${index % 5}% across all ${586 + index * 37} messages, last seen ${128 + (index % 23) * 2}d ago`,
      };
    }),
  };
}

function SenderPreviewDemo({
  args,
  total,
  failFirst = false,
  expired = false,
}: {
  args: ModalArgs;
  total: number;
  failFirst?: boolean;
  expired?: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const attempts = useRef(0);
  const first = useMemo(
    () => demoPage(total, 1, revision, expired && revision === 0),
    [total, revision, expired],
  );
  let inboxTotal = 0;
  for (let index = 0; index < total; index++) inboxTotal += inboxCounts[index] ?? index % 12;
  const result = {
    ...(args.preview.status === 'ready' ? args.preview.result : RULE_PREVIEW_RESULT),
    ruleId: NEWSLETTER_GRAVEYARD.id,
    wouldMatchCount: total,
    actionableSenderCount: total,
    actionableMessageCount: inboxTotal,
    evaluatedSenders: Math.max(3259, total),
    sample: first.senders.slice(0, 10),
    senderPage: first,
  };
  return (
    <ActivateRuleModal
      {...args}
      preview={{ status: 'ready', result }}
      onRetryPreview={() => {
        attempts.current = 0;
        setRevision((value) => value + 1);
      }}
      loadPreviewPage={async (_ruleId, _previewId, page) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (failFirst && attempts.current++ === 0) throw new Error('Synthetic page failure');
        return { ...demoPage(total, page, revision, false), expiresAt: first.expiresAt };
      }}
    />
  );
}

export const LargeSenderList: Story<typeof ActivateRuleModal> = {
  args: { ...NewsletterLongDetails.args },
  render: (args: ModalArgs) => frame(<SenderPreviewDemo args={args} total={5000} />),
};

export const SenderPageError: Story<typeof ActivateRuleModal> = {
  args: { ...NewsletterLongDetails.args },
  render: (args: ModalArgs) => frame(<SenderPreviewDemo args={args} total={53} failFirst />),
};

export const SenderPreviewExpired: Story<typeof ActivateRuleModal> = {
  args: { ...NewsletterLongDetails.args },
  render: (args: ModalArgs) => frame(<SenderPreviewDemo args={args} total={53} expired />),
};

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

/** No matches: the rule can still be enabled for future arrivals. */
export const PreviewEmpty: Story<typeof ActivateRuleModal> = {
  args: {
    ...baseArgs,
    preview: {
      status: 'ready',
      result: {
        ...RULE_PREVIEW_RESULT,
        wouldMatchCount: 0,
        actionableSenderCount: 0,
        actionableMessageCount: 0,
        protectedWouldMatchCount: 0,
        sample: [],
      },
    },
  },
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
