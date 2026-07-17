// Storybook CSF3 stories for the Sender Detail page (D39-D46).
//
// Storybook itself is seeded in PR 3 (D210). Until the seed lands,
// this file uses lightweight local CSF shims so it typechecks
// without `@storybook/react` installed — same pattern as
// `packages/shared/src/components/privacy-badge.stories.tsx`.
// When the seed lands, swap the shims for the real imports; the
// story shapes do not change.
//
// Variants covered (per D211/D212 + Storybook contract):
//   • Default     — promotional sender with engine recommendation
//   • Loading     — skeleton placeholder for fetch in-flight
//   • Error       — fetch failed branch
//   • Empty       — sender exists but has no recent messages
//   • Protected   — Protect-marked, recommendation suppressed
//   • HighConfidence — verdict ≥0.85 — highlighted in the toolbar
//   • MobileNarrow — phone-width reflow regression guard

import type { ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';
import { buildSenderDetail } from '@/mocks/sender-detail-builder';
import { SENDER_FIXTURES } from '@/mocks/sender-fixture-data';
import { SenderDetailPage } from './sender-detail-page';

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

const meta: StoryMeta<typeof SenderDetailPage> = {
  title: 'Senders/SenderDetailPage',
  component: SenderDetailPage,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Sender Detail page (D39-D46). Strict layout order: Header → Recommendation → Action toolbar (K/A/U/L per D227) → Recent messages (Gmail deep-link per D41) → Stats strip → Charts → Decision history. Mandatory action preview per D226. Never renders message bodies per D7.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type PageArgs = ComponentProps<typeof SenderDetailPage>;

const linkedin = SENDER_FIXTURES.find((s) => s.id === 'linkedin');
const sarah = SENDER_FIXTURES.find((s) => s.id === 'sarah');
const stripeSender = SENDER_FIXTURES.find((s) => s.id === 'stripe');
const groupon = SENDER_FIXTURES.find((s) => s.id === 'groupon');

if (linkedin == null || sarah == null || stripeSender == null || groupon == null) {
  throw new Error(
    'Story fixtures expect the demo SENDER_FIXTURES dataset (linkedin / sarah / stripe / groupon).',
  );
}

function frame(children: React.ReactNode) {
  return <div style={{ background: color.bg, minHeight: '100vh' }}>{children}</div>;
}

/** Default — a high-volume promotional sender with a recommendation. */
export const Default: Story<typeof SenderDetailPage> = {
  args: {
    state: { kind: 'ready', detail: buildSenderDetail(linkedin) },
  },
  render: (args: PageArgs) => frame(<SenderDetailPage {...args} />),
};

/** Loading — skeleton block on first paint. */
export const Loading: Story<typeof SenderDetailPage> = {
  args: { state: { kind: 'loading' } },
  render: (args: PageArgs) => frame(<SenderDetailPage {...args} />),
};

/** Error — the API call failed. */
export const ErrorState: Story<typeof SenderDetailPage> = {
  args: {
    state: {
      kind: 'error',
      message: 'The sync worker is reconnecting. Most senders are reachable; retry in a moment.',
    },
  },
  render: (args: PageArgs) => frame(<SenderDetailPage {...args} />),
};

/** Empty — sender exists but no recent messages (fresh add, or gone dark). */
export const Empty: Story<typeof SenderDetailPage> = {
  args: {
    state: {
      kind: 'ready',
      detail: {
        ...buildSenderDetail(sarah, { recentMessages: [], history: [] }),
      },
    },
  },
  render: (args: PageArgs) => frame(<SenderDetailPage {...args} />),
};

/** Protected — auto-protected receipts sender (Stripe). */
export const Protected: Story<typeof SenderDetailPage> = {
  args: {
    state: {
      kind: 'ready',
      detail: buildSenderDetail(stripeSender, {
        isProtected: true,
        protectionReason: 'starred',
      }),
    },
  },
  render: (args: PageArgs) => frame(<SenderDetailPage {...args} />),
};

/** High-confidence verdict — Groupon, daily promo, ≥0.85 confidence. */
export const HighConfidenceVerdict: Story<typeof SenderDetailPage> = {
  args: {
    state: { kind: 'ready', detail: buildSenderDetail(groupon) },
  },
  render: (args: PageArgs) => frame(<SenderDetailPage {...args} />),
};

/**
 * Trend bucket coverage — stats-strip "Trend" cell renders each
 * bucket with its glyph + tone. Founder-eyeball aid for the
 * vocabulary review before stories migrate to real Storybook.
 */
export const TrendBucketUp: Story<typeof SenderDetailPage> = {
  args: {
    state: {
      kind: 'ready',
      detail: {
        ...buildSenderDetail(linkedin),
        stats: {
          ...buildSenderDetail(linkedin).stats,
          volumeTrend: 'up',
        },
      },
    },
  },
  render: (args: PageArgs) => frame(<SenderDetailPage {...args} />),
};

export const TrendBucketDormant: Story<typeof SenderDetailPage> = {
  args: {
    state: {
      kind: 'ready',
      detail: {
        ...buildSenderDetail(groupon),
        stats: {
          ...buildSenderDetail(groupon).stats,
          volumeTrend: 'dormant',
          monthlyVolume: 0,
        },
      },
    },
  },
  render: (args: PageArgs) => frame(<SenderDetailPage {...args} />),
};

/**
 * Last-reviewed eyebrow — verdict + recency on the header. Surfaces
 * "Last reviewed Archive · 3d ago" for the recently-reviewed case,
 * and "Never reviewed" for the unreviewed case.
 */
export const LastReviewedRecently: Story<typeof SenderDetailPage> = {
  args: {
    state: {
      kind: 'ready',
      detail: {
        ...buildSenderDetail({
          ...linkedin,
          lastReview: {
            at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            verdict: 'archive',
            generatedBy: 'llm_haiku',
          },
        }),
      },
    },
  },
  render: (args: PageArgs) => frame(<SenderDetailPage {...args} />),
};

export const NeverReviewed: Story<typeof SenderDetailPage> = {
  args: {
    state: {
      kind: 'ready',
      detail: {
        ...buildSenderDetail({ ...sarah, lastReview: null }),
      },
    },
  },
  render: (args: PageArgs) => frame(<SenderDetailPage {...args} />),
};

/**
 * Mobile-narrow — phone viewport. Verifies the stats strip reflows
 * to a single column, the charts stack vertically, and no fixed-width
 * column overflows the viewport (LEARNINGS 2026-05-19 regression guard).
 */
export const MobileNarrow: Story<typeof SenderDetailPage> = {
  args: {
    state: { kind: 'ready', detail: buildSenderDetail(linkedin) },
  },
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  render: (args: PageArgs) =>
    frame(
      <div style={{ maxWidth: 380, margin: '0 auto' }}>
        <SenderDetailPage {...args} />
      </div>,
    ),
};
