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
        protection: undefined as { strong: number; weak: number } | undefined,
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
  onboarding.firstTriage.isLoading = false;
  onboarding.firstTriage.data = {
    rows: [] as typeof TRIAGE_QUEUE,
    meta: { pinned: 0, decided: 0, protection: undefined },
  };
  triageStats.data = null;
  analytics.track.mockReset();
});

function renderReview() {
  return render(<StepProtectionReview onComplete={() => {}} completing={false} />);
}

describe('StepProtectionReview — the review', () => {
  it('leads with the reassurance and names the weak half as the thing to look at', () => {
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS,
      meta: { pinned: 2, decided: 0, protection: { strong: 460, weak: 55 } },
    };

    renderReview();

    expect(screen.getByText(/We protected 460 senders you write back to\./)).toBeInTheDocument();
    expect(screen.getByText(/55 senders are protected by one star or a Gmail/)).toBeInTheDocument();
    // The ordering is stated, because otherwise the row order is
    // arbitrary to the reader.
    expect(screen.getByText(/shielding the most unread mail/)).toBeInTheDocument();
  });

  it('renders the real triage rows with all five verbs and a direct Unprotect', () => {
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS,
      meta: { pinned: 2, decided: 0, protection: { strong: 3, weak: 2 } },
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
      meta: { pinned: 2, decided: 0, protection: { strong: 3, weak: 2 } },
    };

    renderReview();

    expect(screen.queryByText(/shielding the most unread mail/)).toBeNull();
    expect(screen.getByText(/Here are 2 to look at\./)).toBeInTheDocument();
  });

  it('claims it when the data supports it', () => {
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS.map((r, i) => ({ ...r, unreadInboxCount: i === 0 ? 145 : 0 })),
      meta: { pinned: 2, decided: 0, protection: { strong: 3, weak: 2 } },
    };

    renderReview();

    expect(screen.getByText(/shielding the most unread mail/)).toBeInTheDocument();
  });

  it('never reads as failure when nothing was protected by a reply', () => {
    // The second connected account: 0 strong / 2 weak. "We protected 0
    // senders you write back to" would be both true and useless, so the
    // headline states the fact that exists instead.
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS,
      meta: { pinned: 2, decided: 0, protection: { strong: 0, weak: 2 } },
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
      meta: { pinned: 2, decided: 0, protection: { strong: 1, weak: 2 } },
    };

    renderReview();

    expect(analytics.track).toHaveBeenCalledWith('first_relief_session_started', {
      goal: 'protect_important',
      target: 2,
    });
  });

  it('lets the user stop without manufacturing completion', () => {
    const onComplete = vi.fn();
    onboarding.firstTriage.data = {
      rows: PENDING_ROWS,
      meta: { pinned: 5, decided: 2, protection: { strong: 460, weak: 55 } },
    };

    render(<StepProtectionReview onComplete={onComplete} completing={false} />);
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
      meta: { pinned: 0, decided: 0, protection: { strong: 12, weak: 0 } },
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
      meta: { pinned: 0, decided: 0, protection: { strong: 460, weak: 55 } },
    };

    renderReview();

    expect(screen.queryByText(/Nothing else is protected on a weaker signal/)).toBeNull();
    expect(screen.getByText(/55 senders are still protected by one star/)).toBeInTheDocument();
  });

  it('never claims nothing is protected when only the rows are missing', () => {
    // The same lie, louder: zero strong and zero rows produced "Nothing
    // is protected yet" on a mailbox with 3 weak protections.
    onboarding.firstTriage.data = {
      rows: [] as typeof TRIAGE_QUEUE,
      meta: { pinned: 0, decided: 0, protection: { strong: 0, weak: 3 } },
    };

    renderReview();

    expect(screen.queryByText(/Nothing is protected yet/)).toBeNull();
    expect(screen.getByText(/3 senders are protected by a single signal\./)).toBeInTheDocument();
  });

  it('says plainly when nothing is protected at all', () => {
    onboarding.firstTriage.data = {
      rows: [] as typeof TRIAGE_QUEUE,
      meta: { pinned: 0, decided: 0, protection: { strong: 0, weak: 0 } },
    };

    renderReview();

    expect(screen.getByText(/Nothing is protected yet\./)).toBeInTheDocument();
    // The reason protection is absent, so an empty result is not read as
    // a broken scan.
    expect(screen.getByText(/three replies, a starred message/)).toBeInTheDocument();
  });

  it('reports what is still protected after the reviewed set is done', () => {
    onboarding.firstTriage.data = {
      rows: [] as typeof TRIAGE_QUEUE,
      meta: { pinned: 5, decided: 5, protection: { strong: 460, weak: 50 } },
    };

    renderReview();

    expect(screen.getByText(/Protection reviewed\./)).toBeInTheDocument();
    expect(screen.getByText(/50 senders are still protected by one star/)).toBeInTheDocument();
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
