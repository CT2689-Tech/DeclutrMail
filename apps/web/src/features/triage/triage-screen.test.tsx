// Tests for the Triage screen wrapper (D29, D32, D33, D36, D226).
//
// SSR-only — see the note in `action-toolbar.test.tsx`. The screen
// itself is mostly orchestration, so the tests here are render-shape
// assertions:
//
//   - The default state renders the populated queue (every fixture row
//     surfaces by sender name).
//   - The empty state renders D33's stats summary + "come back
//     tomorrow" copy.
//   - The free-tier empty state surfaces the upgrade nudge.
//   - The header copy never uses "Screen" anywhere (D227 hard rule).
//   - No bulk-action chrome leaks into the screen (D32 — no select-all,
//     no multi-select bar).

import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import {
  TRIAGE_QUEUE,
  TRIAGE_SESSION_STATS,
  TRIAGE_SESSION_STATS_FREE,
  TRIAGE_SESSION_STATS_PRO,
  TRIAGE_SESSION_STATS_QUIET,
  type TriageScreenState,
} from './data';
import { resetTriageStore } from './store';
import { TriageScreen } from './triage-screen';

beforeEach(() => {
  resetTriageStore();
});

/**
 * The screen mounts TanStack hooks (the D226 mutation wiring), so the
 * SSR renders need a QueryClientProvider. All queries inside are
 * disabled until an action is pending, so no fetch fires during a
 * static render.
 */
function render(el: ReactElement): string {
  return renderToStaticMarkup(<QueryWrapper client={createTestQueryClient()}>{el}</QueryWrapper>);
}

function renderState(state: TriageScreenState): string {
  return render(<TriageScreen state={state} />);
}

describe('TriageScreen — populated queue', () => {
  it('renders every fixture row by sender name', () => {
    const html = renderState({
      kind: 'ready',
      rows: [...TRIAGE_QUEUE],
      stats: TRIAGE_SESSION_STATS,
    });
    for (const row of TRIAGE_QUEUE) {
      expect(html).toContain(row.senderName);
    }
  });

  it('surfaces the queue length in the header copy', () => {
    const html = renderState({
      kind: 'ready',
      rows: [...TRIAGE_QUEUE],
      stats: TRIAGE_SESSION_STATS,
    });
    expect(html).toContain(`${TRIAGE_QUEUE.length} decisions, one at a time.`);
  });

  it('renders K, A, U, L shortcut chips somewhere in the toolbar (per row)', () => {
    // When the screen renders with rows the toolbars only mount under
    // expanded rows — and the row is collapsed by default. So the
    // shortcut chips appear in the queue legend (K · A · U · L)
    // even when no row is expanded. That legend is the screen's
    // global cue.
    const html = renderState({
      kind: 'ready',
      rows: [...TRIAGE_QUEUE],
      stats: TRIAGE_SESSION_STATS,
    });
    expect(html).toContain('K · A · U · L');
  });
});

describe('TriageScreen — empty / loading branches', () => {
  it('renders the empty state with stats summary when state.kind=empty', () => {
    const html = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS });
    // D33 copy markers
    expect(html).toContain('cleared today');
    expect(html).toContain('New decisions appear after a sync');
    // Stats tile labels
    expect(html).toContain('Decided');
    expect(html).toContain('Archived');
    expect(html).toContain('Unsubscribes');
    expect(html).toContain('To Later');
    // The actual values appear
    expect(html).toContain(String(TRIAGE_SESSION_STATS.decidedToday));
  });

  it('renders the empty state when state.kind=ready but rows is []', () => {
    const html = renderState({ kind: 'ready', rows: [], stats: TRIAGE_SESSION_STATS });
    expect(html).toContain('New decisions appear after a sync');
  });

  it('surfaces the Plus upgrade nudge only when free tier and freeRemaining <= 5 (D33)', () => {
    const free = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS_FREE });
    expect(free).toContain('See Plus');
    // D19 — freeRemaining is the LIFETIME cleanup remainder (5 total),
    // not a daily counter; the copy must say so.
    expect(free).toContain('free cleanup actions left');
    expect(free).toContain('Plus removes the cap');

    const paid = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS });
    expect(paid).not.toContain('See Plus');
  });

  it('surfaces the Pro nudge for Plus users only — single soft link (D33)', () => {
    // Plus user → soft "Pro could do this for you automatically" link.
    const plus = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS });
    expect(plus).toContain('Pro could do this for you automatically');

    // Free user → Plus banner only; NO Pro link (the funnel is
    // Free → Plus → Pro, not Free → Pro).
    const free = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS_FREE });
    expect(free).not.toContain('Pro could do this for you automatically');

    // Pro user → no nudge at all (D33 explicit: hidden for Pro).
    const pro = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS_PRO });
    expect(pro).not.toContain('Pro could do this for you automatically');
    expect(pro).not.toContain('See Plus');
  });

  it('does not claim decisions prevented future mail or saved unmeasured time', () => {
    const html = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS });
    expect(html).not.toContain('Estimated impact');
    expect(html).not.toContain('future emails will skip your inbox');
    expect(html).not.toContain('min/week saved on email triage');
  });

  it('hides the impact card when the user decided nothing today (no hollow brag)', () => {
    const empty = {
      decidedToday: 0,
      archivedToday: 0,
      unsubscribedToday: 0,
      laterToday: 0,
      streakDays: 0,
      freeRemaining: null,
      futureEmailsSkipped: 0,
      minutesSavedPerWeek: 0,
      tier: 'plus' as const,
    };
    const html = renderState({ kind: 'empty', stats: empty });
    expect(html).not.toContain('Estimated impact');
  });

  it('renders the D212 resting state when the queue is empty and nothing was decided today (W5)', () => {
    // The inbox-zero moment for a user who cleared nothing today —
    // a fresh morning visit or a new mailbox. The D33 celebration
    // ("You cleared today's queue." over four zero tiles) would be a
    // false claim here, so the shared EmptyState renders instead.
    const html = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS_QUIET });
    expect(html).toContain('No decisions today.');
    expect(html).toContain('repeated noise');
    // Next-step framing (D212): a real link to Senders.
    expect(html).toContain('href="/senders"');
    expect(html).toContain('Browse senders');
    // Never the false celebration, never its zero tiles.
    expect(html).not.toContain('cleared today');
    expect(html).not.toContain('Come back tomorrow');
    expect(html).not.toContain('Decided');
    // Must not look like an error state (D212).
    expect(html).not.toContain('Try again');
    expect(html).not.toContain('Loading triage queue');
  });

  it('renders the resting state for kind=ready with [] rows and no decisions today (W5)', () => {
    const html = renderState({ kind: 'ready', rows: [], stats: TRIAGE_SESSION_STATS_QUIET });
    expect(html).toContain('No decisions today.');
  });

  it('keeps the D33 celebration when the user DID decide today', () => {
    const html = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS });
    expect(html).toContain('cleared today');
    expect(html).not.toContain('Nothing needs a decision.');
  });

  it('renders the skeleton when state.kind=loading', () => {
    const html = renderState({ kind: 'loading' });
    expect(html).toContain('Loading triage queue');
  });

  it('renders a real error state with a retry affordance when state.kind=error (D211)', () => {
    // The launch-gap audit's row: a failed query used to render the
    // skeleton forever. The error kind must surface real copy + an
    // explicit "Try again" (reads never auto-retry 4xx — the
    // makeQueryClient invariant).
    const html = renderState({
      kind: 'error',
      error: new Error('network down'),
      retry: () => {},
    });
    expect(html).toContain('Your queue didn');
    expect(html).toContain('Try again');
    // Never the skeleton alongside the error.
    expect(html).not.toContain('Loading triage queue');
  });
});

describe('TriageScreen — D227 hard rule + D32 no-bulk', () => {
  it('never uses the word "Screen" in any rendered surface (D227)', () => {
    // D227 reserves "Screen" / "Screener" for the Screener feature
    // ONLY — the triage screen, its toolbar, its action sheet, and
    // its empty state must not surface that word.
    const states: TriageScreenState[] = [
      { kind: 'ready', rows: [...TRIAGE_QUEUE], stats: TRIAGE_SESSION_STATS },
      { kind: 'empty', stats: TRIAGE_SESSION_STATS },
      { kind: 'empty', stats: TRIAGE_SESSION_STATS_QUIET },
      { kind: 'loading' },
      { kind: 'error', error: new Error('boom'), retry: () => {} },
    ];
    for (const el of states) {
      const html = renderState(el).toLowerCase();
      // "screen" is allowed only in the css class for SR-only
      // text — but our screen uses positional CSS, not classes.
      // Still, the word "screen" might appear in aria-label or
      // class names; we look for it as a substring of user-facing
      // copy. The hard check: "screened" / "screener" / "screen"
      // as standalone words.
      expect(html).not.toMatch(/\bscreen\b/);
      expect(html).not.toMatch(/\bscreened\b/);
      expect(html).not.toMatch(/\bscreener\b/);
    }
  });

  it('renders no bulk-selection UI on the screen (D32)', () => {
    // D32 — no bulk operations in Triage. The screen must not render
    // a select-all checkbox or a multi-action bar. The senders feature
    // has those (`SelectionBar`, `RowCheckbox`); the triage feature
    // does not import them and never should.
    const html = renderState({
      kind: 'ready',
      rows: [...TRIAGE_QUEUE],
      stats: TRIAGE_SESSION_STATS,
    });
    expect(html.toLowerCase()).not.toContain('select all');
    expect(html.toLowerCase()).not.toContain('selectionbar');
  });
});
