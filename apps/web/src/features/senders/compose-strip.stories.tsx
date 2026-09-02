// Storybook CSF3 stories for the ComposeStrip senders filter/sort row
// (D38, D210).
//
// Added after PR #707: the design-system-agent gate flagged 6 new/
// changed visual states shipped with zero story coverage. This file
// closes that gap.
//
// Local CSF shims (no real `@storybook/react`/`StoryObj` import), same
// as most story files in this directory. The real Storybook seed (D210)
// has since landed — `apps/web/.storybook/` exists and a handful of
// files (e.g. `triage/protected-notice.stories.tsx`) already use real
// `Meta`/`StoryObj` — but the shim is still the prevailing convention
// across this directory's siblings (`selection-bar`, `unsub-batch-
// receipt`, `view-toggle`, `keyboard-cheatsheet`, `sender-list-row`,
// `sender-table`), so this file matches them rather than being the one
// file here on a different API. A real-CSF migration is a repo-wide
// sweep, not something to do piecemeal on one new file.
//
// Covers, from `compose-strip.tsx`:
//   1. Negated chips — ActivityChip ("not <bucket>", count shown as
//      "−N") and ToggleChip, both alt-click/right-click exclude forms
//      (QA-senders-filtering-20260901-02).
//   2. `updating` (aria-busy) — background refetch of counts in flight
//      (QA-senders-20260901-01).
//   3. A popover's flip/clamp when it would overflow the viewport edge
//      (QA-senders-filtering-20260901-08).
//   4. Saved-Views empty state, both `canSaveCurrent` branches
//      (QA-senders-filtering-20260901-06).
//   5. Saved-Views armed-delete confirm ("Delete?")
//      (QA-senders-filtering-20260901-06, Codex round-1 review).
//   6. Saved-Views `mutating` — Save/Delete disabled mid-write
//      (Codex round-2 review).
// Plus a `Default`/`Loading` baseline and the Saved-Views cap-reached
// state, so the file isn't all edge cases with nothing to compare them
// against.
//
// Window/Domain/Views popovers hold their own `open` state internally
// with no external control prop. Rather than add a story-only prop to
// the component, the popover-open stories below simulate the trigger
// click on mount via a plain DOM query — and because a click's state
// update doesn't flush synchronously from inside a `useEffect` (the
// popover isn't in the DOM yet on the very next line), any FOLLOW-UP
// interaction (arming a delete, typing a name) happens in a second
// effect gated on a `phase` state, so it only runs once the open has
// actually committed. Every lookup throws if it can't find its target
// instead of `?.`-swallowing a miss into a story that silently renders
// the wrong state.

import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';

import {
  ComposeStrip,
  DEFAULT_COMPOSE,
  EMPTY_COMPOSE,
  type ComposeCounts,
  type ComposeState,
  type ViewsMenuProps,
} from './compose-strip';

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
  globals?: Record<string, unknown>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

const meta: StoryMeta<typeof ComposeStrip> = {
  title: 'Senders/ComposeStrip',
  component: ComposeStrip,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Multi-axis faceted filter + sort row for the Senders list (D38). Alt-click/right-click any chip to negate it. Counts are mailbox-wide absolutes per axis, independent of the rest of the compose.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type StripArgs = ComponentProps<typeof ComposeStrip>;

const noop = () => undefined;

/**
 * Activity buckets are mutually exclusive and exhaustive over `total`
 * (`filterCountsQuery`, senders.read-service.ts), so active + quiet +
 * dormant must never exceed it. The other axes (unsubReady / wroteTo /
 * protected / unsubIgnored) are independent, overlapping subsets — each
 * must stay ≤ total but don't need to sum to anything.
 */
const baseCounts: ComposeCounts = {
  total: 508,
  active: 348,
  quiet: 120,
  dormant: 40,
  unsubReady: 210,
  wroteTo: 35,
  protected: 12,
  unsubIgnored: 6,
};

/** Small fixture for the negation stories — mirrors the counts already
 *  established in `compose-strip.test.tsx`'s negation tests. */
const negatedCounts: ComposeCounts = {
  total: 10,
  active: 3,
  quiet: 4,
  dormant: 3,
  unsubReady: 2,
  wroteTo: 1,
  protected: 0,
  unsubIgnored: 0,
};

/** Frame the strip against the page background, matching real usage. */
function frame(child: React.ReactNode, width: number | string = '100%') {
  return <div style={{ background: color.bg, padding: 24, width, maxWidth: '100%' }}>{child}</div>;
}

/** First button whose text contains `matchText` (case-insensitive), or a thrown error. */
function findButtonByText(root: HTMLElement | null, matchText: string): HTMLButtonElement {
  const btn = Array.from(root?.querySelectorAll('button') ?? []).find((b) =>
    b.textContent?.toLowerCase().includes(matchText.toLowerCase()),
  );
  if (!btn) {
    throw new Error(`ComposeStrip story: no button found containing "${matchText}"`);
  }
  return btn;
}

const baseStripArgs: StripArgs = {
  state: EMPTY_COMPOSE,
  counts: baseCounts,
  onChange: noop,
  onClear: noop,
  sort: 'total',
  direction: 'desc',
  onSortChange: noop,
  domainSuggestions: ['amazon.com', 'linkedin.com', 'chase.com'],
};

/* ─── Baseline ──────────────────────────────────────────────────── */

export const Default: Story<typeof ComposeStrip> = {
  args: { ...baseStripArgs, state: DEFAULT_COMPOSE },
  render: (args) => frame(<ComposeStrip {...args} />),
};

/** `counts` undefined — first paint before the mailbox-wide counts query resolves. */
export const Loading: Story<typeof ComposeStrip> = {
  args: { ...baseStripArgs, state: DEFAULT_COMPOSE, counts: undefined },
  render: (args) => frame(<ComposeStrip {...args} />),
};

/* ─── 1. Negated chips ──────────────────────────────────────────── */

export const NegatedChips: Story<typeof ComposeStrip> = {
  args: {
    ...baseStripArgs,
    state: {
      ...EMPTY_COMPOSE,
      activity: 'active',
      activityNegate: true,
      unsubReady: false,
    } satisfies ComposeState,
    counts: negatedCounts,
  },
  render: (args) => frame(<ComposeStrip {...args} />),
};

/* ─── 2. Updating (aria-busy) ───────────────────────────────────── */

/**
 * A background refetch is in flight. The only observable difference is
 * the `aria-busy` attribute on the strip's `role="group"` — chip counts
 * do NOT dim (a whole-strip dim used to compound with an already-dimmed
 * inactive chip's own count opacity). `SenderResultsFreshness`
 * (senders-screen.tsx) is what shows "Updating results…" to the user.
 */
export const Updating: Story<typeof ComposeStrip> = {
  args: {
    ...baseStripArgs,
    state: DEFAULT_COMPOSE,
    updating: true,
  },
  render: (args) => frame(<ComposeStrip {...args} />),
};

/* ─── 3. Popover near a viewport edge (flip/clamp) ─────────────── */

/**
 * The Domain popover anchors `right: 0` to its trigger by default. In a
 * narrow frame the trigger sits close to the left edge, so the 220px
 * popover would run off-screen left without the flip/clamp fix — this
 * opens it on mount to show the corrected position.
 */
function DomainPopoverEdgeDemo() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    findButtonByText(ref.current, 'domain').click();
  }, []);
  return (
    <div ref={ref}>{frame(<ComposeStrip {...baseStripArgs} state={DEFAULT_COMPOSE} />, 320)}</div>
  );
}

export const PopoverNearViewportEdge: Story<typeof ComposeStrip> = {
  globals: { viewport: 'mobile1' },
  render: () => <DomainPopoverEdgeDemo />,
};

/* ─── 4–7. Saved Views popover states ──────────────────────────── */

/** Sets a native input's value the way a real keystroke would, so React's controlled onChange fires. */
function typeIntoInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function ViewsPopoverDemo({
  state = DEFAULT_COMPOSE,
  views,
  armDeleteFor,
  typeDraft,
}: {
  state?: ComposeState;
  views: ViewsMenuProps;
  /** Name of the view whose delete button should be pre-armed ("Delete?"). */
  armDeleteFor?: string;
  /** Text to type into the "New view name" field once the popover is open. */
  typeDraft?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Two-phase on purpose: opening the Views popover is itself a state
  // update, which doesn't reach the DOM until this effect returns — a
  // second click for the delete button, or typing into the name field,
  // has to wait for a LATER effect pass over the now-open popover.
  const [phase, setPhase] = useState<'init' | 'opened'>('init');

  useEffect(() => {
    if (phase !== 'init') return;
    const trigger = ref.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    if (!trigger) {
      throw new Error('ComposeStrip story: no Views trigger (button[aria-haspopup="menu"]) found');
    }
    trigger.click();
    setPhase('opened');
  }, [phase]);

  useEffect(() => {
    if (phase !== 'opened') return;
    if (armDeleteFor) {
      const del = ref.current?.querySelector<HTMLButtonElement>(
        `button[aria-label="Delete view ${armDeleteFor}"]`,
      );
      if (!del) {
        throw new Error(`ComposeStrip story: no delete button found for view "${armDeleteFor}"`);
      }
      del.click();
    }
    if (typeDraft) {
      const input = ref.current?.querySelector<HTMLInputElement>(
        'input[aria-label="New view name"]',
      );
      if (!input) {
        throw new Error('ComposeStrip story: no "New view name" input found');
      }
      typeIntoInput(input, typeDraft);
    }
  }, [phase, armDeleteFor, typeDraft]);

  return (
    <div ref={ref}>{frame(<ComposeStrip {...baseStripArgs} state={state} views={views} />)}</div>
  );
}

/** Empty Views menu, filter already set — the plain "no saved views" copy. */
export const SavedViewsEmptyCanSave: Story<typeof ComposeStrip> = {
  render: () => (
    <ViewsPopoverDemo
      state={DEFAULT_COMPOSE}
      views={{
        names: [],
        onApply: noop,
        onSave: noop,
        onDelete: noop,
        canSaveCurrent: true,
        capReached: false,
      }}
    />
  ),
};

/** Empty Views menu, no filter set — copy points at what to do first. */
export const SavedViewsEmptyNoFilterSet: Story<typeof ComposeStrip> = {
  render: () => (
    <ViewsPopoverDemo
      state={EMPTY_COMPOSE}
      views={{
        names: [],
        onApply: noop,
        onSave: noop,
        onDelete: noop,
        canSaveCurrent: false,
        capReached: false,
      }}
    />
  ),
};

/** First click on a saved view's "×" arms it — second click actually deletes. */
export const SavedViewsArmedDelete: Story<typeof ComposeStrip> = {
  render: () => (
    <ViewsPopoverDemo
      views={{
        names: ['Weekly digest', 'Needs review'],
        onApply: noop,
        onSave: noop,
        onDelete: noop,
        canSaveCurrent: true,
        capReached: false,
      }}
      armDeleteFor="Weekly digest"
    />
  ),
};

/**
 * A save/delete PATCH is in flight — both mutating controls disable.
 * Types a name into the field first so the Save button's disable is
 * attributable to `mutating` alone, not to the field being empty (the
 * field resets to empty every time the popover opens).
 */
export const SavedViewsMutating: Story<typeof ComposeStrip> = {
  render: () => (
    <ViewsPopoverDemo
      views={{
        names: ['Weekly digest'],
        onApply: noop,
        onSave: noop,
        onDelete: noop,
        canSaveCurrent: true,
        capReached: false,
        mutating: true,
      }}
      typeDraft="Draft view name"
    />
  ),
};

/** At the 10-view cap — save input disables with copy pointing at the fix. */
export const SavedViewsCapReached: Story<typeof ComposeStrip> = {
  render: () => (
    <ViewsPopoverDemo
      views={{
        names: Array.from({ length: 10 }, (_, i) => `View ${i + 1}`),
        onApply: noop,
        onSave: noop,
        onDelete: noop,
        canSaveCurrent: true,
        capReached: true,
      }}
    />
  ),
};
