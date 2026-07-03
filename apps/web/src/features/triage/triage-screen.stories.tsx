// Storybook CSF3 stories for the Triage screen (D29, D31, D32, D33,
// D34, D36, D208, D226).
//
// Storybook itself is seeded in PR 3 (D210). Until the seed lands,
// this file uses lightweight local CSF shims so it typechecks
// without `@storybook/react` installed — same pattern as
// `sender-detail-page.stories.tsx` and `privacy-badge.stories.tsx`.
// When the seed lands, swap the shims for the real imports; the
// story shapes do not change.
//
// Variants covered (D210 + D211/D212 + Storybook contract):
//   • Default          — populated queue, 9 rows
//   • Empty            — D33 stats summary + come back tomorrow
//   • EmptyFreeTier    — D33 with the upgrade nudge visible
//   • EmptyQuiet       — D212 resting state (nothing decided today)
//   • Loading          — skeleton stack
//   • RowExpanded      — one row expanded with toolbar visible
//   • ActionSheetOpen  — sheet mounted with embedded preview
//   • InlinePreview    — D34 remember-preference path
//   • KeyboardFocus    — focus-state guard for the row chrome
//   • UnsubNoChannel   — engine recommends U but no channel exists
//                        (W2 — disabled pill states its reason)

import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tokens } from '@declutrmail/shared';
import {
  TRIAGE_QUEUE,
  TRIAGE_SESSION_STATS,
  TRIAGE_SESSION_STATS_FREE,
  TRIAGE_SESSION_STATS_PRO,
  TRIAGE_SESSION_STATS_QUIET,
} from './data';
import { resetTriageStore, useTriageStore } from './store';
import { TriageScreen } from './triage-screen';

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
  // The shim treats `play` as opaque — Storybook itself would run
  // it after render, but until the seed lands it's just a typed
  // attachment that tracks what each variant exercises.
  play?: () => void | Promise<void>;
};

const meta: StoryMeta<typeof TriageScreen> = {
  title: 'Triage/TriageScreen',
  component: TriageScreen,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Triage screen — the V2 daily ritual. Per D29 + D227 the toolbar renders K/A/U/L exactly. Per D226 every destructive action shows a preview before mutation — either via the action sheet (D34 default) or inline (D34 remember-preference path). Per D36 each row is collapse/expand. Per D32 no bulk operations.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type PageArgs = ComponentProps<typeof TriageScreen>;

function frame(children: React.ReactNode) {
  // Each story resets the store so they don't leak state across
  // the Storybook page transitions. The screen mounts TanStack hooks
  // (the D226 mutation wiring), so a fresh QueryClient wraps every
  // variant; the preview/status queries stay disabled until a pending
  // action exists, so no network fires in Storybook.
  resetTriageStore();
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <div style={{ background: color.bg, minHeight: '100vh' }}>{children}</div>
    </QueryClientProvider>
  );
}

/** Default — 8 decisions across all verdict types. */
export const Default: Story<typeof TriageScreen> = {
  args: {
    state: {
      kind: 'ready',
      rows: [...TRIAGE_QUEUE],
      stats: TRIAGE_SESSION_STATS,
    },
  },
  render: (args: PageArgs) => frame(<TriageScreen {...args} />),
};

/** Loading — skeleton stack on first paint. */
export const Loading: Story<typeof TriageScreen> = {
  args: { state: { kind: 'loading' } },
  render: (args: PageArgs) => frame(<TriageScreen {...args} />),
};

/**
 * Error — a failed queue/stats query (D211). Real copy + an explicit
 * "Try again"; never the skeleton (the launch-gap audit's
 * skeleton-forever row).
 */
export const ErrorState: Story<typeof TriageScreen> = {
  args: {
    state: { kind: 'error', error: new Error('500 from /api/triage/queue'), retry: () => {} },
  },
  render: (args: PageArgs) => frame(<TriageScreen {...args} />),
};

/** Empty — D33 stats summary + "come back tomorrow". */
export const Empty: Story<typeof TriageScreen> = {
  args: {
    state: { kind: 'empty', stats: TRIAGE_SESSION_STATS },
  },
  render: (args: PageArgs) => frame(<TriageScreen {...args} />),
};

/** Empty (free tier) — adds the D33 subtle "See Plus" upgrade nudge. */
export const EmptyFreeTier: Story<typeof TriageScreen> = {
  args: {
    state: { kind: 'empty', stats: TRIAGE_SESSION_STATS_FREE },
  },
  render: (args: PageArgs) => frame(<TriageScreen {...args} />),
};

/**
 * Empty (Pro tier) — D33: "Hidden for Pro users (replaced with a
 * streak/momentum graphic)." This story is the contract proof that
 * neither the Plus banner nor the Pro soft-link surfaces for a Pro
 * user; the streak chip carries the empty-state weight on its own.
 */
export const EmptyProTier: Story<typeof TriageScreen> = {
  args: {
    state: { kind: 'empty', stats: TRIAGE_SESSION_STATS_PRO },
  },
  render: (args: PageArgs) => frame(<TriageScreen {...args} />),
};

/**
 * Empty (quiet) — the D212 resting state: queue empty AND nothing
 * decided today (fresh morning visit / new mailbox). Renders the
 * shared `<EmptyState>` ("Nothing needs a decision.") instead of the
 * D33 celebration, which would otherwise claim "You cleared today's
 * queue." over four zero tiles.
 */
export const EmptyQuiet: Story<typeof TriageScreen> = {
  args: {
    state: { kind: 'empty', stats: TRIAGE_SESSION_STATS_QUIET },
  },
  render: (args: PageArgs) => frame(<TriageScreen {...args} />),
};

/**
 * Row expanded — exercises the D36 collapse/expand pattern and the
 * D29/D227 toolbar visibility. The Storybook play hook expands the
 * first row before the story renders so the screenshot is stable.
 */
export const RowExpanded: Story<typeof TriageScreen> = {
  args: {
    state: {
      kind: 'ready',
      rows: [...TRIAGE_QUEUE],
      stats: TRIAGE_SESSION_STATS,
    },
  },
  render: (args: PageArgs) => {
    resetTriageStore();
    // Expand the first row (Groupon — high confidence Archive).
    useTriageStore.setState({ expandedRowId: TRIAGE_QUEUE[0]!.id });
    return frame(<TriageScreen {...args} />);
  },
};

/**
 * Action sheet open with preview — the D226 mandatory modal preview.
 * Shows the embedded `<ActionPreview mode="modal">` plus the D34
 * remember-preference toggle.
 */
export const ActionSheetOpen: Story<typeof TriageScreen> = {
  args: {
    state: {
      kind: 'ready',
      rows: [...TRIAGE_QUEUE],
      stats: TRIAGE_SESSION_STATS,
    },
  },
  render: (args: PageArgs) => {
    resetTriageStore();
    useTriageStore.setState({
      expandedRowId: TRIAGE_QUEUE[0]!.id,
      pendingAction: { verb: 'Archive', rowId: TRIAGE_QUEUE[0]!.id, surface: 'sheet' },
    });
    return frame(<TriageScreen {...args} />);
  },
};

/**
 * Inline preview — the D34 remember-preference path. The sheet is
 * skipped but D226's mandatory preview still renders as an inline
 * strip beneath the expanded row's toolbar.
 */
export const InlinePreview: Story<typeof TriageScreen> = {
  args: {
    state: {
      kind: 'ready',
      rows: [...TRIAGE_QUEUE],
      stats: TRIAGE_SESSION_STATS,
    },
  },
  render: (args: PageArgs) => {
    resetTriageStore();
    useTriageStore.setState({
      expandedRowId: TRIAGE_QUEUE[1]!.id,
      pendingAction: { verb: 'Unsubscribe', rowId: TRIAGE_QUEUE[1]!.id, surface: 'inline' },
      rememberPreference: { Archive: false, Unsubscribe: true, Later: false },
    });
    return frame(<TriageScreen {...args} />);
  },
};

/**
 * Keyboard navigation focus state — visual guard for the row's
 * focus ring. The play hook would Tab into the queue and then onto
 * the first row's chevron in a real Storybook env; here we just
 * render the default state and rely on the Default variant's focus
 * styles being live in the static HTML.
 */
export const KeyboardFocus: Story<typeof TriageScreen> = {
  args: {
    state: {
      kind: 'ready',
      rows: [...TRIAGE_QUEUE].slice(0, 3),
      stats: TRIAGE_SESSION_STATS,
    },
  },
  render: (args: PageArgs) => frame(<TriageScreen {...args} />),
};

/**
 * Unsubscribe recommended, no channel (W2 — 2026-07-02 audit). The
 * engine chip says "Unsubscribe · 95%" but the sender advertises no
 * List-Unsubscribe header, so the U pill is disabled — and must say
 * why: title attr on the pill + the visible reason line under the
 * toolbar ("No unsubscribe channel found — Archive handles senders
 * like this.").
 */
export const UnsubNoChannel: Story<typeof TriageScreen> = {
  args: {
    state: {
      kind: 'ready',
      rows: TRIAGE_QUEUE.filter((r) => r.id === 't-shipping'),
      stats: TRIAGE_SESSION_STATS,
    },
  },
  render: (args: PageArgs) => {
    resetTriageStore();
    useTriageStore.setState({ expandedRowId: 't-shipping' });
    return frame(<TriageScreen {...args} />);
  },
};
