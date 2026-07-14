import { render, screen } from '@testing-library/react';
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

vi.mock('./api/use-onboarding', () => ({
  useFirstTriage: () => onboarding.firstTriage,
}));
vi.mock('@/features/triage/api/use-triage-queue', () => ({
  useTriageStats: () => ({ isError: false, isLoading: false, data: null }),
}));
vi.mock('@/features/triage/triage-screen', () => ({
  TriageScreen: () => <div data-testid="triage-screen" />,
}));
vi.mock('@/features/triage/triage-undo-tray', () => ({
  TriageUndoTray: () => <div data-testid="undo-tray" />,
}));

beforeEach(() => {
  onboarding.firstTriage.isLoading = false;
  onboarding.firstTriage.data = {
    rows: [] as typeof TRIAGE_QUEUE,
    meta: { pinned: 3, decided: 3 },
  };
});

describe('StepFirstTriage', () => {
  it('frames the active step as a guided three-decision preview', () => {
    onboarding.firstTriage.data = {
      rows: TRIAGE_QUEUE.slice(0, 3),
      meta: { pinned: 3, decided: 0 },
    };

    render(<StepFirstTriage onComplete={() => {}} completing={false} />);

    expect(screen.getByText(/Guided 3-decision preview/i)).toBeInTheDocument();
    expect(
      screen.getByText(/guide you through up to three real sender decisions/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/decision 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByTestId('triage-screen')).toBeInTheDocument();
  });

  it('hands Free users to Senders and reserves ongoing Triage for Plus', () => {
    render(<StepFirstTriage onComplete={() => {}} completing={false} />);

    expect(screen.getByText(/Senders stays available after onboarding/i)).toBeInTheDocument();
    expect(
      screen.getByText(/cleanup actions you have left remain available there/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/ongoing Triage queues require Plus/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open your senders/i })).toBeInTheDocument();
  });
});
