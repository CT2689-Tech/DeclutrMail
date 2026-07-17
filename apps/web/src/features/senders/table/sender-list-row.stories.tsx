// Storybook CSF3 stories for the Senders row component (D39 #2, D210).
//
// Storybook itself is seeded in PR 3 (D210). Until that seed lands,
// this file uses lightweight local CSF shims so it typechecks
// without `@storybook/react` installed — same pattern as
// `sender-detail-page.stories.tsx`. When the seed lands, swap the
// shims for the real imports; the story shapes do not change.
//
// Acceptance criteria covered (per senders-tightening v2 brief):
//   • Evidence line does NOT wrap on common desktop widths
//   • Mobile (<640px) gracefully truncates recency token first
//   • Action button + chevron always visible regardless of width
//   • Every trend bucket renders deterministically
//   • Long sender / domain strings ellipsis without breaking grid
//   • Protected state renders cleanly
//   • Side-by-side current vs trimmed row variants (founder eyeball)
//
// Each story renders the row inside a column-strip frame so the
// reviewer can scan multiple rows at once without flipping stories.

import type { ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';
import type { VolumeTrend, SenderLastReview } from '../data';
import { makeSender } from '../testing/make-sender';
import { SenderListRow } from './sender-list-row';

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

const meta: StoryMeta<typeof SenderListRow> = {
  title: 'Senders/SenderListRow',
  component: SenderListRow,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'One row on the Senders list (D39 #2). Evidence-line grammar — bounded tokens, single-line clamp, deterministic order (cadence · trend · read-state · recency). Replaces the prior 2-cell numeric stat block. Vocabulary: "marked read", never "opened" — Gmail exposes no open events.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type RowArgs = ComponentProps<typeof SenderListRow>;

/** Build a deterministic sender for the row stories. */
const sender: typeof makeSender = (overrides = {}) =>
  makeSender({
    id: 'story-sender',
    displayName: 'Acme Newsletter',
    gmailCategory: 'updates',
    lastDays: 4,
    firstSeenMo: 18,
    ...overrides,
  });

/** Default row container — gives the row visible chrome at full width. */
function frame(args: RowArgs, width: number | string = '100%') {
  return (
    <div
      style={{
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 8,
        width,
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      <SenderListRow {...args} />
    </div>
  );
}

const noop = () => undefined;
const baseArgs = {
  selected: false,
  onToggleSelect: noop,
  expanded: false,
  onToggleExpand: noop,
  onAction: noop,
};

/** Default — typical sender with a steady trend (chip omitted). */
export const Default: Story<typeof SenderListRow> = {
  args: { ...baseArgs, s: sender() },
  render: (args: RowArgs) => frame(args),
};

/** Trend: Up — current month ≥ 1.3× prior average. */
export const TrendUp: Story<typeof SenderListRow> = {
  args: {
    ...baseArgs,
    s: sender({ displayName: 'Ramping Inc', monthlyVolume: 22, volumeTrend: 'up' }),
  },
  render: (args: RowArgs) => frame(args),
};

/** Trend: Down — current month ≤ 0.7× prior average. */
export const TrendDown: Story<typeof SenderListRow> = {
  args: {
    ...baseArgs,
    s: sender({ displayName: 'Fading Co', monthlyVolume: 5, volumeTrend: 'down' }),
  },
  render: (args: RowArgs) => frame(args),
};

/** Trend: Dormant — current month is 0, prior had volume. */
export const TrendDormant: Story<typeof SenderListRow> = {
  args: {
    ...baseArgs,
    s: sender({
      displayName: 'Gone Silent',
      monthlyVolume: 0,
      lastDays: 95,
      volumeTrend: 'dormant',
    }),
  },
  render: (args: RowArgs) => frame(args),
};

/** Trend: New — fewer than 2 months of history. */
export const TrendNew: Story<typeof SenderListRow> = {
  args: {
    ...baseArgs,
    s: sender({
      displayName: 'Fresh Sender',
      monthlyVolume: 3,
      firstSeenMo: 0,
      lastDays: 2,
      volumeTrend: 'new',
    }),
  },
  render: (args: RowArgs) => frame(args),
};

/** Read-state: "Almost never marked read" — strong unsubscribe candidate. */
export const ReadStateLow: Story<typeof SenderListRow> = {
  args: {
    ...baseArgs,
    s: sender({
      displayName: 'Loud Promotions',
      monthlyVolume: 47,
      readRate: 0,
      volumeTrend: 'steady',
    }),
  },
  render: (args: RowArgs) => frame(args),
};

/** Read-state: high — keep-close signal. */
export const ReadStateHigh: Story<typeof SenderListRow> = {
  args: {
    ...baseArgs,
    s: sender({
      displayName: 'Personal Friend',
      monthlyVolume: 4,
      readRate: 0.92,
      gmailCategory: 'primary',
    }),
  },
  render: (args: RowArgs) => frame(args),
};

/**
 * Volume spike — overrides read-state phrasing. The fixture-only
 * `spike` multiplier is gone; a spike on the wire IS a high cadence +
 * `up` trend bucket.
 */
export const VolumeSpike: Story<typeof SenderListRow> = {
  args: {
    ...baseArgs,
    s: sender({
      displayName: 'BlackFridayDealsCo',
      monthlyVolume: 80,
      readRate: 0.1,
      volumeTrend: 'up',
    }),
  },
  render: (args: RowArgs) => frame(args),
};

/** Protected — bulk actions can't touch this sender; chip + disabled CTA. */
export const Protected: Story<typeof SenderListRow> = {
  args: {
    ...baseArgs,
    s: sender({
      displayName: 'IRS Payments',
      monthlyVolume: 2,
      readRate: 0.9,
      protectionFlags: {
        isProtected: true,
        protectionReason: 'user_defined',
        protectionSetAt: '2026-06-01T00:00:00.000Z',
      },
      gmailCategory: 'updates',
    }),
  },
  render: (args: RowArgs) => frame(args),
};

/**
 * No timeseries history yet — every timeseries-derived wire fact is
 * `null` (never a fabricated 0): the trend chip is omitted, the
 * cadence token drops, and the read-state line stays silent. Mirrors
 * first-sync state.
 */
export const NoHistory: Story<typeof SenderListRow> = {
  args: {
    ...baseArgs,
    s: sender({
      displayName: 'Just-Synced Sender',
      monthlyVolume: null,
      readRate: null,
      sparkline: null,
      lastDays: 1,
      firstSeenMo: 0,
      volumeTrend: null,
    }),
  },
  render: (args: RowArgs) => frame(args),
};

/** Last-reviewed sender — relevant to the row in a future iteration. */
export const RecentlyReviewed: Story<typeof SenderListRow> = {
  args: {
    ...baseArgs,
    s: sender({
      displayName: 'Recently Decided',
      monthlyVolume: 10,
      lastReview: {
        at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        verdict: 'archive',
        generatedBy: 'llm_haiku',
      } satisfies SenderLastReview,
    }),
  },
  render: (args: RowArgs) => frame(args),
};

/**
 * Long name + long domain stress test — both columns should
 * ellipsis-truncate without breaking the row grid or pushing the
 * action cluster off-screen.
 */
export const LongNameAndDomain: Story<typeof SenderListRow> = {
  args: {
    ...baseArgs,
    s: sender({
      displayName: 'Some Very Lengthy Sender Name That Exceeds Typical Length',
      domain: 'mail.subdomain.example-corp-marketing-platform.com',
      monthlyVolume: 14,
      volumeTrend: 'up',
    }),
  },
  render: (args: RowArgs) => frame(args),
};

/** Mobile narrow width — evidence line drops, action + chevron stay. */
export const MobileNarrow: Story<typeof SenderListRow> = {
  args: { ...baseArgs, s: sender({ monthlyVolume: 12, volumeTrend: 'up' }) },
  render: (args: RowArgs) => frame(args, 360),
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

/**
 * Bucket grid — every trend bucket at once, side-by-side.
 * Founder-eyeball aid for the chip vocabulary review.
 */
export const TrendBucketGrid: Story<typeof SenderListRow> = {
  args: { ...baseArgs, s: sender() },
  render: () => {
    const buckets: VolumeTrend[] = ['new', 'up', 'down', 'steady', 'dormant'];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {buckets.map((bucket) => (
          <div key={bucket}>
            <small
              style={{
                fontFamily: 'monospace',
                fontSize: 10,
                color: color.fgMuted,
                paddingLeft: 8,
              }}
            >
              {bucket}
            </small>
            {frame({
              ...baseArgs,
              s: sender({
                id: `bucket-${bucket}`,
                displayName: `Sender (${bucket})`,
                volumeTrend: bucket,
                monthlyVolume: bucket === 'dormant' ? 0 : 12,
              }),
            })}
          </div>
        ))}
      </div>
    );
  },
};
