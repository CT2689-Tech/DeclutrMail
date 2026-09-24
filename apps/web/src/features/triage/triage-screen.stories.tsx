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
//   • Default          — focus mode, one sender on stage
//   • FocusWhyOpen     — the "Why?" disclosure open
//   • FocusProtected   — a Protected sender's card
//   • FocusBatchOffer  — a batch offer as its own card in the stack
//   • ListMode         — "See all": the hairline queue list
//   • Empty            — factual stats summary + calm re-entry
//   • EmptyFreeTier    — D33 with the upgrade nudge visible
//   • EmptyQuiet       — D212 resting state (nothing decided today)
//   • Loading          — one card-sized skeleton
//   • RowExpanded      — list mode, one row expanded with toolbar visible
//   • ActionSheetOpen  — sheet mounted with embedded preview
//   • InlinePreview    — D34 remember-preference path, inside the card
//   • KeyboardFocus    — focus-state guard for the list row chrome
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
import { storeTriageMode } from './test-mode';
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
          'Triage screen — one decision per sender. Focus mode (the default) puts one sender on stage with the engine’s suggestion as the only filled verb; "See all" switches to the list. The toolbar renders K/A/U/L/D; Delete is always explicit and always uses the full preview sheet. Other mail-moving actions show the same mandatory preview either in the sheet or inline. Protected senders stay out of bulk actions.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type PageArgs = ComponentProps<typeof TriageScreen>;

/** Three senders with no shared domain or verdict run — no batch offer leads the stack. */
const SENDER_ROWS = TRIAGE_QUEUE.filter((r) =>
  ['t-linkedin', 't-groupon', 't-sarah'].includes(r.id),
);

function frame(children: React.ReactNode, mode: 'focus' | 'list' = 'focus') {
  // The view mode is a per-device preference, so a story picks it the
  // way a device does.
  storeTriageMode(mode);
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

/** Default — focus mode: one sender, the suggestion filled, "1 of 3". */
export const Default: Story<typeof TriageScreen> = {
  args: { state: { kind: 'ready', rows: SENDER_ROWS, stats: TRIAGE_SESSION_STATS } },
  render: (args: PageArgs) => frame(<TriageScreen {...args} />),
};

/** "Why?" open — reasoning, confidence band, stats and signals in the card. */
export const FocusWhyOpen: Story<typeof TriageScreen> = {
  args: { state: { kind: 'ready', rows: SENDER_ROWS, stats: TRIAGE_SESSION_STATS } },
  render: (args: PageArgs) => {
    const node = frame(<TriageScreen {...args} />);
    useTriageStore.setState({ expandedRowId: SENDER_ROWS[0]!.id });
    return node;
  },
};

/** A Protected sender — the mark and the exact evidence replace the read rate. */
export const FocusProtected: Story<typeof TriageScreen> = {
  args: {
    state: {
      kind: 'ready',
      rows: SENDER_ROWS.filter((r) => r.protectionReason !== null),
      stats: TRIAGE_SESSION_STATS,
    },
  },
  render: (args: PageArgs) => frame(<TriageScreen {...args} />),
};

/** The full fixture queue — a batch offer leads the stack as its own card. */
export const FocusBatchOffer: Story<typeof TriageScreen> = {
  args: { state: { kind: 'ready', rows: [...TRIAGE_QUEUE], stats: TRIAGE_SESSION_STATS } },
  render: (args: PageArgs) => frame(<TriageScreen {...args} />),
};

/** "See all" — the hairline list, batch offers leading it quietly. */
export const ListMode: Story<typeof TriageScreen> = {
  args: { state: { kind: 'ready', rows: [...TRIAGE_QUEUE], stats: TRIAGE_SESSION_STATS } },
  render: (args: PageArgs) => frame(<TriageScreen {...args} />, 'list'),
};

/** Loading — one card-sized skeleton on first paint. */
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

/** Empty — factual stats summary + calm re-entry. */
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
 * shared `<EmptyState>` ("Nothing needs a decision right now.")
 * instead of a completion panel over four zero tiles.
 */
export const EmptyQuiet: Story<typeof TriageScreen> = {
  args: {
    state: { kind: 'empty', stats: TRIAGE_SESSION_STATS_QUIET },
  },
  render: (args: PageArgs) => frame(<TriageScreen {...args} />),
};

/**
 * Row expanded (list mode) — exercises the D36 collapse/expand pattern and the
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
    const node = frame(<TriageScreen {...args} />, 'list');
    // Expand the first row (Groupon — high confidence Archive).
    useTriageStore.setState({ expandedRowId: TRIAGE_QUEUE[0]!.id });
    return node;
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
    // `frame` resets the store, so seed it AFTER.
    const node = frame(<TriageScreen {...args} />);
    useTriageStore.setState({
      expandedRowId: TRIAGE_QUEUE[0]!.id,
      pendingAction: {
        verb: 'Archive',
        rowId: TRIAGE_QUEUE[0]!.id,
        surface: 'sheet',
        wakeAt: null,
      },
    });
    return node;
  },
};

/**
 * Inline preview — the D34 remember-preference path. The sheet is
 * skipped but D226's mandatory preview still renders — inside the
 * focus card, with its explicit Confirm.
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
    // `frame` resets the store, so seed it AFTER.
    const node = frame(<TriageScreen {...args} />);
    useTriageStore.setState({
      expandedRowId: TRIAGE_QUEUE[1]!.id,
      pendingAction: {
        verb: 'Unsubscribe',
        rowId: TRIAGE_QUEUE[1]!.id,
        surface: 'inline',
        wakeAt: null,
      },
      rememberPreference: { Archive: false, Unsubscribe: true, Later: false },
    });
    return node;
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
  render: (args: PageArgs) => frame(<TriageScreen {...args} />, 'list'),
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
    // `frame` resets the store, so seed it AFTER.
    const node = frame(<TriageScreen {...args} />, 'list');
    useTriageStore.setState({ expandedRowId: 't-shipping' });
    return node;
  },
};
