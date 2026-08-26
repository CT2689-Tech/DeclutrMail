// Tests for step 5 under the `protect_important` goal — the D245
// protection review.
//
// The copy IS the feature here: the screen's job is to state what
// automatic protection already did, so what it claims (and what it
// refuses to claim) is the thing worth locking in. Three shapes come
// straight from real mailboxes:
//
//   - 460 replied / 55 weak  — the founder's 98k account
//   -   0 replied /  2 weak  — the second connected account, where a
//                              "we protected 0" headline would read as
//                              failure for a screen that has something
//                              real to show
//   -   N replied /  0 weak  — the reassurance IS the win; there is
//                              nothing to review and saying so is not
//                              an empty state

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { TRIAGE_QUEUE } from '@/features/triage/data';
import { StepProtectionReview } from './step-protection-review';

const onboarding = vi.hoisted(() => ({
  firstTriage: {
    isError: false,
    error: null as unknown,
    isLoading: false,
    data: {
      rows: [] as typeof TRIAGE_QUEUE,
      meta: {
        pinned: 0,
        decided: 0,
        protection: undefined as
          { strong: number; unsupported?: number; weak: number; manual: number } | undefined,
      },
    },
    refetch: vi.fn(),
  },
}));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
const triageStats = vi.hoisted(() => ({
  isError: false,
  isLoading: false,
  data: null as { tier: 'free' | 'plus' | 'pro' } | null,
}));

vi.mock('./api/use-onboarding', () => ({
  useFirstTriage: () => onboarding.firstTriage,
}));
vi.mock('@/features/triage/api/use-triage-queue', () => ({
  useTriageStats: () => triageStats,
}));
vi.mock('@/features/triage/triage-screen', () => ({
  TriageScreen: ({ journey, offerUnprotect }: { journey?: string; offerUnprotect?: boolean }) => (
    <div
      data-testid="triage-screen"
      data-journey={journey}
      data-offer-unprotect={String(offerUnprotect)}
    />
  ),
}));
vi.mock('@/features/triage/triage-undo-tray', () => ({
  TriageUndoTray: () => <div data-testid="undo-tray" />,
}));
vi.mock('@/lib/posthog', () => ({ track: analytics.track }));

/** Two weak rows still awaiting review. */
const PENDING_ROWS = TRIAGE_QUEUE.slice(0, 2);

beforeEach(() => {
  onboarding.firstTriage.isError = false;
  onboarding.firstTriage.error = null;
  onboarding.firstTriage.isLoading = false;
  onboarding.firstTriage.data = {
    rows: [] as typeof TRIAGE_QUEUE,
    meta: { pinned: 0, decided: 0, protection: undefined },
  };
  triageStats.data = null;
  analytics.track.mockReset();
});

function renderReview(over: { onComplete?: () => void; completing?: boolean } = {}) {
  // The component calls `useQueryClient()` (the 409 designed state
  // resets the mailbox-scoped cache), so it needs a provider — the same
  // one it has in the app.
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <StepProtectionReview
        onComplete={over.onComplete ?? (() => {})}
        completing={over.completing ?? false}
      />
    </QueryWrapper>,
  );
}

describe('StepProtectionReview — the review', () => {
  it('leads with the reassurance and names the weak half as the thing to look at', () => {
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS,
      meta: { pinned: 2, decided: 0, protection: { strong: 460, weak: 55, manual: 0 } },
    };

    renderReview();

    expect(screen.getByText(/We protected 460 senders you write back to\./)).toBeInTheDocument();
    expect(screen.getByText(/55 senders are protected by one star or a Gmail/)).toBeInTheDocument();
    // The ordering is stated, because otherwise the row order is
    // arbitrary to the reader.
    expect(screen.getByText(/shielding the most unread email/)).toBeInTheDocument();
  });

  it('names the stale shields, and says they are still protected (F010)', () => {
    // The real shape after mig 0063 on the founder's mailbox: 361
    // correspondence shields still hold, 99 rest on a count that
    // credited any mail in a shared thread.
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS,
      meta: {
        pinned: 2,
        decided: 0,
        protection: { strong: 361, unsupported: 99, weak: 45, manual: 0 },
      },
    };

    renderReview();

    expect(screen.getByText(/99 senders/)).toBeInTheDocument();
    // The reassurance comes BEFORE the correction: the alarming reading
    // of "we can no longer confirm this" is that we already acted on it.
    expect(
      screen.getByText(/They are still protected; we have not changed anything/),
    ).toBeInTheDocument();
  });

  it('never claims a check ran when the field is absent from the wire', () => {
    // `unsupported` is optional — an API pod predating it omits the key.
    // Absent reads as 0, which is the honest default for a COUNT, but no
    // sentence may then assert that we looked and found none.
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS,
      meta: { pinned: 2, decided: 0, protection: { strong: 460, weak: 55, manual: 0 } },
    };

    renderReview();

    expect(screen.queryByText(/no longer confirm/)).not.toBeInTheDocument();
    expect(screen.queryByText(/we have not changed anything/)).not.toBeInTheDocument();
    expect(screen.getByText(/We protected 460 senders you write back to/)).toBeInTheDocument();
  });

  it('renders the real triage rows with all five verbs and a direct Unprotect', () => {
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS,
      meta: { pinned: 2, decided: 0, protection: { strong: 3, weak: 2, manual: 0 } },
    };

    renderReview();

    // ADR-0019 forbids per-surface verb hand-rolling, so the rows are
    // the REAL TriageScreen (K/A/U/L/D + the D226 lifecycle). What this
    // screen adds is the separate safety-state control.
    const rows = screen.getByTestId('triage-screen');
    expect(rows).toHaveAttribute('data-journey', 'first_relief');
    expect(rows).toHaveAttribute('data-offer-unprotect', 'true');
  });

  it('claims the shielded ordering only when something is shielded', () => {
    // A protection over a fully-read inbox is still worth reviewing —
    // the read deliberately keeps those, ranked last — but "the 2
    // shielding the most unread mail" describes nothing when every one
    // of them shields zero.
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS.map((r) => ({ ...r, unreadInboxCount: 0 })),
      meta: { pinned: 2, decided: 0, protection: { strong: 3, weak: 2, manual: 0 } },
    };

    renderReview();

    expect(screen.queryByText(/shielding the most unread email/)).toBeNull();
    expect(screen.getByText(/Here are 2 to look at\./)).toBeInTheDocument();
  });

  it('claims it when the data supports it', () => {
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS.map((r, i) => ({ ...r, unreadInboxCount: i === 0 ? 145 : 0 })),
      meta: { pinned: 2, decided: 0, protection: { strong: 3, weak: 2, manual: 0 } },
    };

    renderReview();

    expect(screen.getByText(/shielding the most unread email/)).toBeInTheDocument();
  });

  it('never reads as failure when nothing was protected by a reply', () => {
    // The second connected account: 0 strong / 2 weak. "We protected 0
    // senders you write back to" would be both true and useless, so the
    // headline states the fact that exists instead.
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS,
      meta: { pinned: 2, decided: 0, protection: { strong: 0, weak: 2, manual: 0 } },
    };

    renderReview();

    expect(screen.getByText(/2 senders are protected by a single signal\./)).toBeInTheDocument();
    expect(screen.queryByText(/We protected 0/)).toBeNull();
    // The rows are still there — zero strong is not an empty review.
    expect(screen.getByTestId('triage-screen')).toBeInTheDocument();
  });

  it('opens the funnel session against the protection goal', () => {
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS,
      meta: { pinned: 2, decided: 0, protection: { strong: 1, weak: 2, manual: 0 } },
    };

    renderReview();

    expect(analytics.track).toHaveBeenCalledWith('first_relief_session_started', {
      goal: 'protect_important',
      target: 2,
    });
  });

  it('stays retryable when the completion POST fails', () => {
    // The trap: `finished` latched BEFORE the completion mutation ran,
    // so a transient failure left the user on a terminal screen being
    // told "Couldn't finish onboarding — try again" by a button that
    // could never do anything again. Onboarding is the one flow with no
    // way back, so a dead exit is a permanent trap.
    const onComplete = vi.fn();
    onboarding.firstTriage.data = {
      rows: [] as typeof TRIAGE_QUEUE,
      meta: { pinned: 0, decided: 0, protection: { strong: 12, weak: 0, manual: 0 } },
    };

    renderReview({ onComplete });
    const exit = screen.getByRole('button', { name: /Continue to Senders/i });

    fireEvent.click(exit); // first attempt — the server 500s
    fireEvent.click(exit); // the user takes the toast's advice

    expect(onComplete).toHaveBeenCalledTimes(2);
    // The funnel event is still counted ONCE — one session, one
    // completion, however many times the write had to be retried.
    expect(
      analytics.track.mock.calls.filter(([n]) => n === 'first_relief_session_completed'),
    ).toHaveLength(1);
  });

  it('lets the user stop without manufacturing completion', () => {
    const onComplete = vi.fn();
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS,
      meta: { pinned: 5, decided: 2, protection: { strong: 460, weak: 55, manual: 0 } },
    };

    renderReview({ onComplete });
    fireEvent.click(screen.getByRole('button', { name: /Finish for today/i }));

    expect(analytics.track).toHaveBeenCalledWith('first_relief_session_completed', {
      goal: 'protect_important',
      target: 5,
      decided: 2,
      outcome: 'stopped',
    });
    expect(onComplete).toHaveBeenCalledOnce();
  });
});

describe('StepProtectionReview — the edges', () => {
  it('treats "nothing weak to review" as the win, not an empty state', () => {
    onboarding.firstTriage.data = {
      rows: [] as typeof TRIAGE_QUEUE,
      meta: { pinned: 0, decided: 0, protection: { strong: 12, weak: 0, manual: 0 } },
    };

    renderReview();

    expect(screen.getByText(/We protected 12 senders you write back to\./)).toBeInTheDocument();
    expect(screen.getByText(/nothing here to second-guess/)).toBeInTheDocument();
    expect(screen.queryByTestId('triage-screen')).toBeNull();
    expect(screen.getByRole('button', { name: /Continue to Senders/i })).toBeInTheDocument();
  });

  it('never claims nothing is weakly protected when rows just could not be shown', () => {
    // `pinned === 0` is two different facts. "Nothing to review" is one;
    // "there are 55 to review and none could be lined up" is the other —
    // every weak protection was decided inside the D30 window, or is not
    // yet scored. Saying the first when the second is true is the
    // surface asserting what it does not know.
    onboarding.firstTriage.data = {
      rows: [] as typeof TRIAGE_QUEUE,
      meta: { pinned: 0, decided: 0, protection: { strong: 460, weak: 55, manual: 0 } },
    };

    renderReview();

    expect(screen.queryByText(/Nothing else is protected on a weaker signal/)).toBeNull();
    expect(
      screen.getByText(/55 senders are still protected on a signal worth a look/),
    ).toBeInTheDocument();
  });

  it('never claims nothing is protected when only the rows are missing', () => {
    // The same lie, louder: zero strong and zero rows produced "Nothing
    // is protected yet" on a mailbox with 3 weak protections.
    onboarding.firstTriage.data = {
      rows: [] as typeof TRIAGE_QUEUE,
      meta: { pinned: 0, decided: 0, protection: { strong: 0, weak: 3, manual: 0 } },
    };

    renderReview();

    expect(screen.queryByText(/Nothing is protected yet/)).toBeNull();
    expect(screen.getByText(/3 senders are protected by a single signal\./)).toBeInTheDocument();
  });

  it('never calls a mailbox unprotected when the user protected senders themselves', () => {
    // `user_defined` is excluded from the review on purpose — the user
    // already decided, so there is nothing to reassure them about and
    // nothing to second-guess. But absent-from-the-review is not
    // absent-from-the-mailbox: with both AUTOMATIC buckets at zero the
    // screen claimed "Nothing is protected yet … nothing is being held
    // back from cleanup" while those senders were protected and were
    // being held back.
    onboarding.firstTriage.data = {
      rows: [] as typeof TRIAGE_QUEUE,
      meta: { pinned: 0, decided: 0, protection: { strong: 0, weak: 0, manual: 7 } },
    };

    renderReview();

    expect(screen.queryByText(/Nothing is protected yet/)).toBeNull();
    expect(screen.queryByText(/nothing is being held back from cleanup/)).toBeNull();
    expect(screen.getByText(/You['’]ve protected 7 senders yourself\./)).toBeInTheDocument();
  });

  it('says plainly when nothing is protected at all', () => {
    onboarding.firstTriage.data = {
      rows: [] as typeof TRIAGE_QUEUE,
      meta: { pinned: 0, decided: 0, protection: { strong: 0, weak: 0, manual: 0 } },
    };

    renderReview();

    expect(screen.getByText(/Nothing is protected yet\./)).toBeInTheDocument();
    // The reason protection is absent, so an empty result is not read as
    // a broken scan.
    expect(
      screen.getByText(/writing to a sender at least three times and hearing back/),
    ).toBeInTheDocument();
  });

  it('reports what is still protected after the reviewed set is done', () => {
    onboarding.firstTriage.data = {
      rows: [] as typeof TRIAGE_QUEUE,
      meta: { pinned: 5, decided: 5, protection: { strong: 460, weak: 50, manual: 0 } },
    };

    renderReview();

    expect(screen.getByText(/Protection reviewed\./)).toBeInTheDocument();
    expect(
      screen.getByText(/50 senders are still protected on a signal worth a look/),
    ).toBeInTheDocument();
  });

  it('claims no counts when the server did not compute them', () => {
    // Only reachable if the goal changed between this render and the
    // read. Rows still render; the headline states nothing it cannot
    // support, which is the whole posture of this screen.
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS,
      meta: { pinned: 2, decided: 0, protection: undefined },
    };

    renderReview();

    expect(screen.getByText(/Senders we protected for you/)).toBeInTheDocument();
    expect(screen.queryByText(/you write back to/)).toBeNull();
    expect(screen.getByTestId('triage-screen')).toBeInTheDocument();
  });

  it('offers a retry rather than an empty review when the read fails', () => {
    onboarding.firstTriage.isError = true;
    onboarding.firstTriage.error = new Error('boom');

    renderReview();

    expect(screen.getByText(/Couldn't load your protection summary/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
    // Never a "nothing is protected" claim on a failed read — that is
    // the surface asserting what it does not know.
    expect(screen.queryByText(/Nothing is protected yet/)).toBeNull();
  });
});

describe('StepProtectionReview — states the flow audit found unpinned (2026-08-10)', () => {
  it('renders the DESIGNED state for a mailbox-scope 409, not a dead retry', () => {
    // A CurrentMailboxGuard 409 is a designed state, never a retry
    // (CLAUDE.md §8): the generic Try-again can only 409 again, and the
    // only other exit wrote the durable `skipped: true` flag. The
    // designed state offers a connection refresh instead.
    onboarding.firstTriage.isError = true;
    onboarding.firstTriage.error = { code: 'NO_ACTIVE_MAILBOX' };

    renderReview();

    expect(screen.getByText(/Your mailbox connection changed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh connection/i })).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load your protection summary/)).toBeNull();
  });

  it('disables both exits while the completion POST is in flight', () => {
    // #484 established the exit must stay clickable AFTER a failure;
    // this is the neighbouring half — it must not be double-submittable
    // DURING the write.
    onboarding.firstTriage.data = {
      rows: [],
      meta: { pinned: 2, decided: 2, protection: { strong: 4, weak: 2, manual: 0 } },
    };

    renderReview({ completing: true });

    expect(screen.getByRole('button', { name: /Finishing…/i })).toBeDisabled();
  });

  it('disables "Finish for today" mid-completion on the review layout too', () => {
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS,
      meta: { pinned: 2, decided: 0, protection: { strong: 4, weak: 2, manual: 0 } },
    };

    renderReview({ completing: true });

    expect(screen.getByRole('button', { name: /Finish for today/i })).toBeDisabled();
  });

  it('does not claim the shielded ordering when any loaded row is unmeasured', () => {
    // Same precondition as the Settings list: every row measured AND at
    // least one non-zero. `unreadInboxCount` is optional on the wire
    // (deploy skew) — an unmeasured row is unknown, not zero, and no
    // arrangement of unknowns is "most shielded first".
    const measured = { ...PENDING_ROWS[0]!, unreadInboxCount: 12 };
    const unmeasured = { ...PENDING_ROWS[1]! };
    delete (unmeasured as { unreadInboxCount?: number }).unreadInboxCount;
    onboarding.firstTriage.data = {
      rows: [measured, unmeasured],
      meta: { pinned: 2, decided: 0, protection: { strong: 4, weak: 2, manual: 0 } },
    };

    renderReview();

    expect(screen.queryByText(/shielding the most unread email/)).toBeNull();
    expect(screen.getByText(/Here are 2 to look at\./)).toBeInTheDocument();
  });
});
