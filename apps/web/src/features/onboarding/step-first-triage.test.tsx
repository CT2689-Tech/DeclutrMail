import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRIAGE_QUEUE } from '@/features/triage/data';
import { StepFirstTriage } from './step-first-triage';

const onboarding = vi.hoisted(() => ({
  firstTriage: {
    isError: false,
    error: null,
    isLoading: false,
    data: {
      rows: [] as typeof TRIAGE_QUEUE,
      meta: { pinned: 3, decided: 3 },
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
  TriageScreen: ({ journey }: { journey?: string }) => (
    <div data-testid="triage-screen" data-journey={journey} />
  ),
}));
vi.mock('@/features/triage/triage-undo-tray', () => ({
  TriageUndoTray: () => <div data-testid="undo-tray" />,
}));
// The D38 tour reads onboarding state and owns a mutation; its own
// behaviour is covered in `src/features/tour/verb-tour.test.tsx`.
vi.mock('@/features/tour/verb-tour', () => ({
  OnboardingVerbTour: () => <div data-testid="verb-tour" />,
}));
vi.mock('@/lib/posthog', () => ({ track: analytics.track }));

beforeEach(() => {
  // `isError` was not reset here, so the first test to set it would have
  // leaked into every test after it.
  onboarding.firstTriage.isError = false;
  onboarding.firstTriage.isLoading = false;
  onboarding.firstTriage.data = {
    rows: [] as typeof TRIAGE_QUEUE,
    meta: { pinned: 3, decided: 3 },
  };
  triageStats.data = null;
  analytics.track.mockReset();
});

describe('StepFirstTriage', () => {
  it('frames the active step as a finite goal-led relief session', () => {
    onboarding.firstTriage.data = {
      rows: TRIAGE_QUEUE.slice(0, 3),
      meta: { pinned: 3, decided: 0 },
    };

    render(<StepFirstTriage onComplete={() => {}} completing={false} goal="reduce_newsletters" />);

    expect(screen.getByText(/Review senders/i)).toBeInTheDocument();
    expect(screen.getByText(/up to five senders/i)).toBeInTheDocument();
    expect(screen.getByText(/recurring newsletters/i)).toBeInTheDocument();
    expect(screen.getByText(/Review 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByTestId('triage-screen')).toHaveAttribute('data-journey', 'first_relief');
    expect(analytics.track).toHaveBeenCalledWith('first_relief_session_started', {
      goal: 'reduce_newsletters',
      target: 3,
    });
  });

  it('explains the first review in user outcomes, not internal workflow language', () => {
    onboarding.firstTriage.data = {
      rows: TRIAGE_QUEUE.slice(0, 3),
      meta: { pinned: 3, decided: 0 },
    };

    render(<StepFirstTriage onComplete={() => {}} completing={false} goal="reduce_newsletters" />);

    expect(screen.getByText(/where one choice can make a noticeable difference/i)).toBeVisible();
    expect(screen.queryByText(/real sender decisions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/practice run|first-triage candidates/i)).not.toBeInTheDocument();
  });

  it('hands Free users to Senders (Triage itself is Free per A3)', () => {
    triageStats.data = { tier: 'free' };

    render(<StepFirstTriage onComplete={() => {}} completing={false} goal="reduce_newsletters" />);

    // Post-A3 (#401): Triage is Free — the caveat is the monthly meter,
    // never a claim that Triage needs Plus.
    expect(screen.getByText(/Senders and Triage both stay available/i)).toBeInTheDocument();
    expect(screen.getByText(/metered monthly/i)).toBeInTheDocument();
    expect(screen.queryByText(/require Plus/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue to Senders/i })).toBeInTheDocument();
  });

  it('spares Plus/Pro users the Free-tier caveat', () => {
    triageStats.data = { tier: 'pro' };

    render(<StepFirstTriage onComplete={() => {}} completing={false} goal="reduce_newsletters" />);

    expect(screen.getByText(/Triage keeps a queue ready/i)).toBeInTheDocument();
    expect(screen.queryByText(/metered monthly/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/On Free/i)).not.toBeInTheDocument();
  });

  it('claims no tier capability while the tier is unknown', () => {
    triageStats.data = null;

    render(<StepFirstTriage onComplete={() => {}} completing={false} goal="reduce_newsletters" />);

    expect(screen.getByText(/Senders stays available after onboarding\./i)).toBeInTheDocument();
    expect(screen.queryByText(/metered monthly/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Triage keeps a queue ready/i)).not.toBeInTheDocument();
  });

  it('stays retryable when the completion POST fails', () => {
    // Same trap as the protection review: `finished` latched before the
    // completion write, so a transient failure stranded the user on a
    // terminal screen whose toast says "try again" next to a dead
    // button. Onboarding has no way back.
    const onComplete = vi.fn();
    onboarding.firstTriage.data = {
      rows: [] as typeof TRIAGE_QUEUE,
      meta: { pinned: 3, decided: 3 },
    };

    render(
      <StepFirstTriage onComplete={onComplete} completing={false} goal="reduce_newsletters" />,
    );
    const exit = screen.getByRole('button', { name: /Continue to Senders/i });

    fireEvent.click(exit);
    fireEvent.click(exit);

    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(
      analytics.track.mock.calls.filter(([n]) => n === 'first_relief_session_completed'),
    ).toHaveLength(1);
  });

  it('lets the user stop without manufacturing completion', () => {
    const onComplete = vi.fn();
    onboarding.firstTriage.data = {
      rows: TRIAGE_QUEUE.slice(0, 3),
      meta: { pinned: 5, decided: 2 },
    };

    render(
      <StepFirstTriage onComplete={onComplete} completing={false} goal="clear_old_promotions" />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Finish for today/i }));

    expect(analytics.track).toHaveBeenCalledWith('first_relief_session_completed', {
      goal: 'clear_old_promotions',
      target: 5,
      decided: 2,
      outcome: 'stopped',
    });
    expect(onComplete).toHaveBeenCalledOnce();
  });

  // The mid-review exit ends onboarding for good. It was briefly given
  // the COMPLETION panel's label ("Continue to Senders"), which reads as
  // navigation while senders are still queued. The two controls must not
  // share a name.
  it('does not label the mid-review exit as navigation', () => {
    onboarding.firstTriage.data = {
      rows: TRIAGE_QUEUE.slice(0, 3),
      meta: { pinned: 5, decided: 2 },
    };

    render(<StepFirstTriage onComplete={() => {}} completing={false} goal="reduce_newsletters" />);

    expect(screen.getByRole('button', { name: /Finish for today/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue to Senders/i })).not.toBeInTheDocument();
  });

  // Step 5 renders `corner` in every state — mid-review, loading, error
  // and completion. The error panel's only other control is "Try again",
  // so a caller that drops `corner` strands anyone whose read keeps
  // failing on the last step of onboarding (D106).
  it('renders the caller corner in the error state, where it is the only way out', () => {
    onboarding.firstTriage.isError = true;

    render(
      <StepFirstTriage
        onComplete={() => {}}
        completing={false}
        goal="reduce_newsletters"
        corner={<button type="button">Skip for now</button>}
      />,
    );

    expect(screen.getByRole('button', { name: /Skip for now/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });
});

describe('StepFirstTriage — completion in flight', () => {
  it('disables the exit while the completion POST is pending', () => {
    // #484's other half: the exit stays clickable after a FAILURE, and
    // must not be double-submittable DURING the write. Same pin as the
    // protection-review sibling.
    onboarding.firstTriage.data = {
      rows: [],
      meta: { pinned: 3, decided: 3 },
    };

    render(<StepFirstTriage onComplete={() => {}} completing={true} goal="reduce_newsletters" />);

    expect(screen.getByRole('button', { name: /Finishing…/i })).toBeDisabled();
  });
});
