import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { LaterReturnRecoverySummary } from '@declutrmail/shared/contracts';
import { ApiError } from '@/lib/api/client';

import { formatAttempt, LaterReturnAlert } from './later-return-alert';

vi.mock('@/features/auth/api/use-me', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUserTimeZone: () => 'Asia/Kolkata',
}));

const state: {
  summary: LaterReturnRecoverySummary | undefined;
  wakeError: Error | null;
} = { summary: undefined, wakeError: null };
const mutate = vi.fn();

vi.mock('./api/use-snoozed', () => ({
  useLaterRecovery: () => ({ data: state.summary }),
  useWakeRecoveryNow: () => ({
    isPending: false,
    isError: state.wakeError !== null,
    error: state.wakeError,
    mutate,
  }),
}));

describe('LaterReturnAlert', () => {
  beforeEach(() => {
    state.summary = undefined;
    state.wakeError = null;
    mutate.mockClear();
  });

  it('stays silent when scheduled returns are healthy', () => {
    state.summary = { affectedCount: 0, firstIssue: null };
    render(<LaterReturnAlert enabled />);
    expect(screen.queryByTestId('later-return-alert')).not.toBeInTheDocument();
  });

  it('shows a durable failed-return recovery action', () => {
    state.summary = {
      affectedCount: 1,
      firstIssue: {
        senderId: 'sender-1',
        displayName: 'Daily Digest',
        email: 'digest@example.test',
        snoozedUntil: '2026-07-14T10:00:00.000Z',
        returnStatus: 'retrying',
        lastReturnAttemptAt: '2026-07-14T10:01:00.000Z',
        returnFailureKind: 'temporary',
      },
    };
    render(<LaterReturnAlert enabled />);

    expect(screen.getByRole('alert')).toHaveTextContent(/could not be confirmed/i);
    // Exact string: this banner is server-rendered into hydrated HTML
    // on every app route, so the label must be identical on the server
    // and in any browser locale/zone (React #418; e2e hydration-smoke).
    expect(screen.getByRole('alert')).toHaveTextContent('Last tried Jul 14, 2026, 3:31 PM.');
    fireEvent.click(screen.getByRole('button', { name: 'Try return now' }));
    expect(mutate).toHaveBeenCalledWith({ senderId: 'sender-1' });
  });

  it('gives reconnect guidance for revoked Gmail access', () => {
    state.summary = {
      affectedCount: 2,
      firstIssue: {
        senderId: 'sender-1',
        displayName: '',
        email: 'digest@example.test',
        snoozedUntil: '2026-07-14T10:00:00.000Z',
        returnStatus: 'retrying',
        lastReturnAttemptAt: '2026-07-14T10:01:00.000Z',
        returnFailureKind: 'reauthorize',
      },
    };
    render(<LaterReturnAlert enabled />);
    expect(screen.getByRole('alert')).toHaveTextContent(/reconnect Gmail from the account menu/i);
  });

  it('surfaces an unavailable recovery queue instead of swallowing the click failure', () => {
    state.summary = {
      affectedCount: 1,
      firstIssue: {
        senderId: 'sender-1',
        displayName: 'Daily Digest',
        email: 'digest@example.test',
        snoozedUntil: '2026-07-14T10:00:00.000Z',
        returnStatus: 'missed',
        lastReturnAttemptAt: null,
        returnFailureKind: null,
      },
    };
    state.wakeError = new ApiError(503, {}, 'unavailable');
    render(<LaterReturnAlert enabled />);
    expect(screen.getByText(/return queue isn't available/i)).toBeInTheDocument();
  });
});

describe('formatAttempt', () => {
  it('renders the exact pinned label in the user zone, never the machine zone', () => {
    expect(formatAttempt('2026-07-14T10:01:00.000Z', 'Asia/Kolkata')).toBe('Jul 14, 2026, 3:31 PM');
    expect(formatAttempt('2026-07-14T10:01:00.000Z', 'UTC')).toBe('Jul 14, 2026, 10:01 AM');
  });

  it('degrades honestly on an unparseable stamp', () => {
    expect(formatAttempt('not-a-time', 'UTC')).toBe('at an unknown time');
  });
});
