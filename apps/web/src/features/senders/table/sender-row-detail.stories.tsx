// Storybook CSF3 stories for the expanded-row detail panel (D210, D211).
//
// Storybook itself is seeded in PR 3 (D210). Until that seed lands,
// this file uses lightweight local CSF shims so it typechecks
// without `@storybook/react` installed — same pattern as
// `sender-list-row.stories.tsx`. When the seed lands, swap the shims
// for the real imports; the story shapes do not change.
//
// Variants covered (per D211 — every chart state is designed):
//   • Ready    — real monthly volumes, peak label, month-range footer
//   • Loading  — skeleton bars while the timeseries fetch is in flight
//   • Error    — fetch failed; calm copy + Retry
//   • Empty    — sender has no `sender_timeseries` rows yet
// plus the same four states for the Recent subjects card (real
// first-page `/api/senders/:id/messages` rows, capped at 3).

import { makeSender } from '../testing/make-sender';
import {
  SenderRowDetail,
  type RowDetailSubjects,
  type RowDetailTimeseries,
} from './sender-row-detail';

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

const meta: StoryMeta<typeof SenderRowDetail> = {
  title: 'Senders/SenderRowDetail',
  component: SenderRowDetail,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "Inline detail panel revealed when a sender row is expanded. The volume chart renders the sender's real 12-month `sender_timeseries` and the Recent subjects card the sender's real recent messages (both fetched on expand by `SenderRowDetailLive`; same query keys as the Sender Detail page). Verbs are canonical K/A/U/L per D227; every action routes through the parent's D226 preview.",
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

const sender: typeof makeSender = (overrides = {}) =>
  makeSender({
    id: 'story-sender',
    gmailCategory: 'updates',
    monthlyVolume: 24,
    readRate: 0.1,
    sparkline: [6, 6, 6, 6],
    lastDays: 2,
    firstSeenMo: 18,
    volumeTrend: 'up',
    ...overrides,
  });

const READY: RowDetailTimeseries = {
  status: 'ready',
  points: [
    { yearMonth: '2025-08-01', volume: 9, readCount: 2 },
    { yearMonth: '2025-09-01', volume: 12, readCount: 1 },
    { yearMonth: '2025-10-01', volume: 11, readCount: 0 },
    { yearMonth: '2025-12-01', volume: 16, readCount: 1 },
    { yearMonth: '2026-01-01', volume: 14, readCount: 2 },
    { yearMonth: '2026-02-01', volume: 18, readCount: 0 },
    { yearMonth: '2026-03-01', volume: 15, readCount: 1 },
    { yearMonth: '2026-04-01', volume: 21, readCount: 0 },
    { yearMonth: '2026-05-01', volume: 19, readCount: 1 },
    { yearMonth: '2026-06-01', volume: 26, readCount: 0 },
    { yearMonth: '2026-07-01', volume: 8, readCount: 0 },
  ],
};

const SUBJECTS: RowDetailSubjects = {
  status: 'ready',
  subjects: [
    'Your July statement is ready',
    'Security alert: new sign-in on Chrome',
    'Weekly digest — 12 new updates',
  ],
};

const noop = () => undefined;

/** Ready — real monthly volumes; note the missing month (2025-11) has no bar. */
export const Ready: Story<typeof SenderRowDetail> = {
  args: { s: sender(), onAction: noop, timeseries: READY, subjects: SUBJECTS },
};

/**
 * Panel variant — the SAME component hosted inside the grid's
 * SenderPeek dialog (grid↔table parity, 2026-07-03): tight padding,
 * no bottom hairline. At sheet width the auto-fit grids stack
 * (stats 2×2, chart above subjects) — resize the canvas to see it.
 */
export const PanelVariant: Story<typeof SenderRowDetail> = {
  args: {
    s: sender(),
    onAction: noop,
    timeseries: READY,
    subjects: SUBJECTS,
    variant: 'panel',
  },
};

/** Loading — both fetches in flight; skeleton bars + lines, no data claims. */
export const Loading: Story<typeof SenderRowDetail> = {
  args: {
    s: sender(),
    onAction: noop,
    timeseries: { status: 'loading' },
    subjects: { status: 'loading' },
  },
};

/** Error — both fetches failed; calm copy + Retry. */
export const ErrorState: Story<typeof SenderRowDetail> = {
  args: {
    s: sender(),
    onAction: noop,
    timeseries: { status: 'error', retry: noop },
    subjects: { status: 'error', retry: noop },
  },
};

/** Empty — sender has no timeseries rows and no messages yet. */
export const Empty: Story<typeof SenderRowDetail> = {
  args: {
    s: sender(),
    onAction: noop,
    timeseries: { status: 'ready', points: [] },
    subjects: { status: 'ready', subjects: [] },
  },
};

/** Subjects still loading while the chart is ready — states are independent. */
export const SubjectsLoading: Story<typeof SenderRowDetail> = {
  args: { s: sender(), onAction: noop, timeseries: READY, subjects: { status: 'loading' } },
};

/** Subjects fetch failed while the chart is ready; calm copy + Retry. */
export const SubjectsError: Story<typeof SenderRowDetail> = {
  args: {
    s: sender(),
    onAction: noop,
    timeseries: READY,
    subjects: { status: 'error', retry: noop },
  },
};

/** Sender has volume history but no messages in the recent window. */
export const SubjectsEmpty: Story<typeof SenderRowDetail> = {
  args: {
    s: sender(),
    onAction: noop,
    timeseries: READY,
    subjects: { status: 'ready', subjects: [] },
  },
};
