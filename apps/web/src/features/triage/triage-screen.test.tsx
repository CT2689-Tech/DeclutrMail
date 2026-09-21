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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import type { Me } from '@/features/auth/api/me-contract';
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

// QA-sync-20260831-01 (Codex adversarial review): the header lives in
// `triage-screen.tsx` itself, reading `useOptionalAuth()` directly — a
// blind spot the child-only `empty-state.test.tsx` coverage can't see.
// Mocked at the module `useOptionalAuth` reads from (not `useMe`/
// `AuthProvider`) so a static render doesn't need a real query result.
const authCell: { me: Me | null } = { me: null };
vi.mock('@/features/auth/auth-provider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useOptionalAuth: () => (authCell.me ? { me: authCell.me } : null),
  };
});

function meWithMailboxReadiness(readiness: 'ready' | 'failed'): Me {
  return {
    user: { id: 'u1', email: 'me@example.com', workspaceId: 'w1', timezone: null },
    mailboxes: [
      { id: 'mb-1', email: 'me@example.com', status: 'active', connectedAt: null, readiness },
    ],
    activeMailboxId: 'mb-1',
    tier: 'plus',
    cleanupRemaining: null,
  };
}

beforeEach(() => {
  resetTriageStore();
  authCell.me = null;
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
  // A static render is the FIRST render, which is focus mode: the
  // per-device list preference is read after mount. The list's own
  // render-shape lives in `triage-focus.test.tsx` (client render).
  it('opens on one decision, not the list', () => {
    const html = renderState({
      kind: 'ready',
      rows: [...TRIAGE_QUEUE],
      stats: TRIAGE_SESSION_STATS,
    });
    expect(html).toContain('aria-label="Current decision"');
    expect(html).not.toContain('aria-label="Triage queue"');
    expect(html).toContain('>See all<');
  });

  it('titles the screen "Triage" and states the queue length once, as the progress total', () => {
    const html = renderState({
      kind: 'ready',
      rows: [...TRIAGE_QUEUE],
      stats: TRIAGE_SESSION_STATS,
    });
    expect(html).toContain('>Triage</h1>');
    expect(html).not.toContain('decisions, one at a time.');
    // "1 of 15" — and the number appears nowhere else as a count.
    expect(html).toContain(`>1 of ${TRIAGE_QUEUE.length}<`);
    expect(html).not.toContain('decisions waiting');
  });

  it('carries no eyebrow, mailbox address or Today strip above the queue', () => {
    authCell.me = meWithMailboxReadiness('ready');
    const html = render(
      <TriageScreen
        state={{ kind: 'ready', rows: [...TRIAGE_QUEUE], stats: TRIAGE_SESSION_STATS }}
      />,
    );
    expect(html).not.toContain('me@example.com');
    expect(html).not.toContain('Today at a glance');
  });
});

describe('TriageScreen — empty / loading branches', () => {
  it('renders the empty state with stats summary when state.kind=empty', () => {
    const html = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS });
    // Calm completion copy markers
    expect(html).toContain('You’re done for now.');
    expect(html).toContain('New decisions appear');
    // The tally — one quiet line, not four tiles.
    expect(html).toContain(' decided');
    expect(html).toContain(' archived');
    expect(html).toContain(' unsubscribes');
    expect(html).toContain(' to Later');
    // The actual values appear
    expect(html).toContain(String(TRIAGE_SESSION_STATS.decidedToday));
  });

  it('renders the empty state when state.kind=ready but rows is []', () => {
    const html = renderState({ kind: 'ready', rows: [], stats: TRIAGE_SESSION_STATS });
    expect(html).toContain('New decisions appear');
  });

  it('says the scan failed once, in the body — the header makes no claim to contradict it (QA-sync-20260831-01)', () => {
    // The header used to compose a state sentence ("Nothing waiting.")
    // that could sit above the child's "last scan didn't finish". The h1
    // is now just the screen name, so the body is the only voice.
    authCell.me = meWithMailboxReadiness('failed');
    const html = render(
      <TriageScreen state={{ kind: 'empty', stats: TRIAGE_SESSION_STATS_QUIET }} />,
    );
    expect(html).toContain('>Triage</h1>');
    expect(html).not.toContain('Nothing waiting.');
    // `renderToStaticMarkup` HTML-escapes the straight apostrophe.
    expect(html).toContain('This mailbox&#x27;s last scan didn&#x27;t finish.');
    expect(html).not.toContain('Nothing needs a decision');
  });

  it('renders the resting state when the mailbox synced fine', () => {
    authCell.me = meWithMailboxReadiness('ready');
    const html = render(
      <TriageScreen state={{ kind: 'empty', stats: TRIAGE_SESSION_STATS_QUIET }} />,
    );
    expect(html).toContain('Nothing needs a decision right now.');
    expect(html).not.toContain('last scan didn&#x27;t finish');
    // No progress and no mode toggle over an empty queue.
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('>See all<');
  });

  it('surfaces the Plus upgrade nudge only when free tier and freeRemaining <= 5 (D33)', () => {
    const free = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS_FREE });
    expect(free).toContain('See Plus');
    // D19 — freeRemaining is the LIFETIME cleanup remainder (5 total),
    // not a daily counter; the copy must say so.
    expect(free).toContain('free cleanup actions left');

    const paid = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS });
    expect(paid).not.toContain('See Plus');
  });

  it('surfaces the Pro nudge for Plus users only — single soft link (D33)', () => {
    // Plus user → soft "See Pro automation" link.
    const plus = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS });
    expect(plus).toContain('See Pro automation');

    // Free user → Plus banner only; NO Pro link (the funnel is
    // Free → Plus → Pro, not Free → Pro).
    const free = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS_FREE });
    expect(free).not.toContain('See Pro automation');

    // Pro user → no nudge at all (D33 explicit: hidden for Pro).
    const pro = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS_PRO });
    expect(pro).not.toContain('See Pro automation');
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
      freeRemaining: null,
      tier: 'plus' as const,
    };
    const html = renderState({ kind: 'empty', stats: empty });
    expect(html).not.toContain('Estimated impact');
  });

  it('renders the D212 resting state when the queue is empty and nothing was decided today (W5)', () => {
    // The inbox-zero moment for a user who cleared nothing today —
    // a fresh morning visit or a new mailbox. The D33 celebration
    // A completion panel over four zero tiles would be a false claim
    // here, so the shared EmptyState renders instead.
    const html = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS_QUIET });
    expect(html).toContain('Nothing needs a decision right now.');
    expect(html).toContain('New decisions appear');
    // Next-step framing (D212): a real link to Senders.
    expect(html).toContain('href="/senders"');
    expect(html).toContain('Browse senders');
    // Never the false celebration, never its zero tiles.
    expect(html).not.toContain('cleared today');
    expect(html).not.toContain('tomorrow');
    expect(html).not.toContain('consecutive');
    expect(html).not.toContain('Decided');
    // Must not look like an error state (D212).
    expect(html).not.toContain('Try again');
    expect(html).not.toContain('Loading triage queue');
  });

  it('renders the resting state for kind=ready with [] rows and no decisions today (W5)', () => {
    const html = renderState({ kind: 'ready', rows: [], stats: TRIAGE_SESSION_STATS_QUIET });
    expect(html).toContain('Nothing needs a decision right now.');
  });

  it('keeps the D33 celebration when the user DID decide today', () => {
    const html = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS });
    expect(html).toContain('You’re done for now.');
    expect(html).toContain('New decisions appear');
    expect(html).not.toContain('consecutive');
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
    expect(html).toContain('role="alert"');
    // The error's visual signature is the shared ErrorState's amber mark
    // (the amber/dashed borders are gone by design — ADR-0042).
    expect(html).toContain('data-dm-error-mark');
    // Never the skeleton alongside the error.
    expect(html).not.toContain('Loading triage queue');
  });

  it('keeps the successful resting state visually distinct from a failed fetch', () => {
    const html = renderState({ kind: 'empty', stats: TRIAGE_SESSION_STATS_QUIET });
    // Distinct by construction: no alert role and no error mark.
    expect(html).toContain('Nothing needs a decision right now.');
    expect(html).not.toContain('data-dm-error-mark');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('Needs attention');
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
