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
//   • Default          — populated queue, 8 rows
//   • Empty            — D33 stats summary + come back tomorrow
//   • EmptyFreeTier    — D33 with the upgrade nudge visible
//   • Loading          — skeleton stack
//   • RowExpanded      — one row expanded with toolbar visible
//   • ActionSheetOpen  — sheet mounted with embedded preview
//   • InlinePreview    — D34 remember-preference path
//   • KeyboardFocus    — focus-state guard for the row chrome

import type { ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';
import { TRIAGE_QUEUE, TRIAGE_SESSION_STATS, TRIAGE_SESSION_STATS_FREE } from './data';
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
  // the Storybook page transitions.
  resetTriageStore();
  return <div style={{ background: color.bg, minHeight: '100vh' }}>{children}</div>;
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

/** Empty — D33 stats summary + "come back tomorrow". */
export const Empty: Story<typeof TriageScreen> = {
  args: {
    state: { kind: 'empty', stats: TRIAGE_SESSION_STATS },
  },
  render: (args: PageArgs) => frame(<TriageScreen {...args} />),
};

/** Empty (free tier) — adds the D33 subtle upgrade nudge. */
export const EmptyFreeTier: Story<typeof TriageScreen> = {
  args: {
    state: { kind: 'empty', stats: TRIAGE_SESSION_STATS_FREE },
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
    return (
      <div style={{ background: color.bg, minHeight: '100vh' }}>{<TriageScreen {...args} />}</div>
    );
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
    return (
      <div style={{ background: color.bg, minHeight: '100vh' }}>{<TriageScreen {...args} />}</div>
    );
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
    return (
      <div style={{ background: color.bg, minHeight: '100vh' }}>{<TriageScreen {...args} />}</div>
    );
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
