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
vi.mock('@/lib/posthog', () => ({ track: analytics.track }));

beforeEach(() => {
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

    expect(screen.getByText(/First relief/i)).toBeInTheDocument();
    expect(screen.getByText(/up to five real sender decisions/i)).toBeInTheDocument();
    expect(screen.getByText(/recurring newsletters/i)).toBeInTheDocument();
    expect(screen.getByText(/decision 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByTestId('triage-screen')).toHaveAttribute('data-journey', 'first_relief');
    expect(analytics.track).toHaveBeenCalledWith('first_relief_session_started', {
      goal: 'reduce_newsletters',
      target: 3,
    });
  });

  it('hands Free users to Senders and reserves ongoing Triage for Plus', () => {
    triageStats.data = { tier: 'free' };

    render(<StepFirstTriage onComplete={() => {}} completing={false} goal="reduce_newsletters" />);

    expect(screen.getByText(/Senders stays available after onboarding/i)).toBeInTheDocument();
    expect(
      screen.getByText(/cleanup actions you have left remain available there/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/ongoing Triage queues require Plus/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue to Senders/i })).toBeInTheDocument();
  });

  it('spares Plus/Pro users the Free-tier caveat', () => {
    triageStats.data = { tier: 'pro' };

    render(<StepFirstTriage onComplete={() => {}} completing={false} goal="reduce_newsletters" />);

    expect(screen.getByText(/Triage keeps a queue ready/i)).toBeInTheDocument();
    expect(screen.queryByText(/ongoing Triage queues require Plus/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/On Free/i)).not.toBeInTheDocument();
  });

  it('claims no tier capability while the tier is unknown', () => {
    triageStats.data = null;

    render(<StepFirstTriage onComplete={() => {}} completing={false} goal="reduce_newsletters" />);

    expect(screen.getByText(/Senders stays available after onboarding\./i)).toBeInTheDocument();
    expect(screen.queryByText(/ongoing Triage queues require Plus/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Triage keeps a queue ready/i)).not.toBeInTheDocument();
  });

  it('lets the user stop without manufacturing completion', () => {
    const onComplete = vi.fn();
    onboarding.firstTriage.data = {
      rows: TRIAGE_QUEUE.slice(0, 3),
      meta: { pinned: 5, decided: 2 },
    };

    render(<StepFirstTriage onComplete={onComplete} completing={false} goal="protect_important" />);
    fireEvent.click(screen.getByRole('button', { name: /Stop for today/i }));

    expect(analytics.track).toHaveBeenCalledWith('first_relief_session_completed', {
      goal: 'protect_important',
      target: 5,
      decided: 2,
      outcome: 'stopped',
    });
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
