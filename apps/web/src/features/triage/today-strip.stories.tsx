// Storybook CSF3 stories for the Triage "Today" strip (D214).
//
// Storybook itself is seeded in PR 3 (D210). Until the seed lands, this
// file uses the same lightweight local CSF shims as
// `triage-screen.stories.tsx` so it typechecks without
// `@storybook/react` installed.
//
// The fetching wrapper (`TodayStrip`) mounts a TanStack query, so the
// stories target the presentational `TodayStripView` half directly
// (same split as senders' `CheatsheetPanel`) — every copy variant
// renders without a network. All numbers are BE aggregates in
// production (no fake completion §10); the fixtures below stand in.
//
// Variants cover the strip's rendering rules (D211 — designed states):
//   • FullSummary   — all three lines present, with the noise-% clause
//   • NoNoisePct    — decisions waiting but no 90d volume → "waiting below"
//   • ReceivedOnly  — a fresh sync: mail arrived, nothing handled/queued
//   • HandledOnly   — Autopilot did the work; no decisions left to make
//   • EmptyRendersNothing — nothing received/handled/queued → null

import { tokens } from '@declutrmail/shared';
import { TodayStripView } from './today-strip';
import type { TodaySummary } from './api/use-triage-queue';

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

const meta: StoryMeta<typeof TodayStripView> = {
  title: 'Triage/TodayStrip',
  component: TodayStripView,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'D214 — the "Today" strip atop Triage. Situational awareness rendered INSIDE the Triage screen (no separate /home route). The queue count reads as DECISIONS (D221 canonical phrasing). Each line hides when its number would be a hollow zero; a strip with nothing to say renders nothing.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type Args = Parameters<typeof TodayStripView>[0];

function frame(children: React.ReactNode) {
  return <div style={{ background: color.bg, padding: 24, maxWidth: 1180 }}>{children}</div>;
}

/** Full summary — the three-line D214 worked example. */
export const FullSummary: Story<typeof TodayStripView> = {
  args: {
    summary: {
      receivedToday: 184,
      sendersToday: 63,
      handledAutomatically: 129,
      queuedDecisions: 12,
      noiseReductionPct: 38,
    } satisfies TodaySummary,
  },
  render: (args: Args) => frame(<TodayStripView {...args} />),
};

/**
 * Decisions waiting, but no 90-day volume to take a share of →
 * `noiseReductionPct` null, so the decisions line reads "… waiting
 * below." instead of the noise-reduction clause.
 */
export const NoNoisePct: Story<typeof TodayStripView> = {
  args: {
    summary: {
      receivedToday: 24,
      sendersToday: 9,
      handledAutomatically: 6,
      queuedDecisions: 4,
      noiseReductionPct: null,
    } satisfies TodaySummary,
  },
  render: (args: Args) => frame(<TodayStripView {...args} />),
};

/**
 * Received only — a fresh sync where mail arrived but Autopilot hasn't
 * run and no decisions are queued yet. Only the first line renders.
 */
export const ReceivedOnly: Story<typeof TodayStripView> = {
  args: {
    summary: {
      receivedToday: 41,
      sendersToday: 18,
      handledAutomatically: 0,
      queuedDecisions: 0,
      noiseReductionPct: null,
    } satisfies TodaySummary,
  },
  render: (args: Args) => frame(<TodayStripView {...args} />),
};

/**
 * Handled only — Autopilot cleared the inbox and left nothing to
 * decide. The "handled" line stands alone (received also shown here).
 */
export const HandledOnly: Story<typeof TodayStripView> = {
  args: {
    summary: {
      receivedToday: 88,
      sendersToday: 30,
      handledAutomatically: 88,
      queuedDecisions: 0,
      noiseReductionPct: null,
    } satisfies TodaySummary,
  },
  render: (args: Args) => frame(<TodayStripView {...args} />),
};

/**
 * Empty — nothing received, handled, or queued renders NOTHING (the
 * D212 empty state below the strip owns that moment). Contract proof of
 * the null return.
 */
export const EmptyRendersNothing: Story<typeof TodayStripView> = {
  args: {
    summary: {
      receivedToday: 0,
      sendersToday: 0,
      handledAutomatically: 0,
      queuedDecisions: 0,
      noiseReductionPct: null,
    } satisfies TodaySummary,
  },
  render: (args: Args) => frame(<TodayStripView {...args} />),
};
