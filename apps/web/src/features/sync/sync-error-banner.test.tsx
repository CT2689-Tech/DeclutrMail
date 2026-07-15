/**
 * SyncErrorBanner tests (D224 passive incremental-failure surface).
 *
 * Locks the visibility predicate — the banner shows ONLY when the most
 * recent sync outcome is a fresh retryable error, or a current invalid
 * Gmail grant that requires explicit reconnection:
 *   1. hidden when no error stamp;
 *   2. visible when the error is recent + newer than the last success;
 *   3. hidden when a success is newer than the error (recovered);
 *   4. hidden when the error is older than 60 minutes (aged out);
 *   5. "Try again" fires the shared sync-now mutation;
 *   6. an invalid grant persists and starts target-bound OAuth instead.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { SyncStatus } from '@declutrmail/shared/contracts';
import { SyncErrorBanner } from './sync-error-banner';

const MAILBOX_ID = '11111111-1111-4111-8111-111111111111';

function statusOf(overrides: Partial<SyncStatus>): SyncStatus {
  return {
    readiness_status: 'ready',
    current_stage: 'ready',
    progress_pct: 100,
    is_ready_for_triage: true,
    last_synced_at: null,
    last_sync_error_at: null,
    last_sync_error_code: null,
    ...overrides,
  };
}

// Mutable cell the mocked hook reads — set per test before render.
const statusCell: { data: SyncStatus | undefined } = { data: undefined };

vi.mock('@/features/onboarding/api/use-sync-status', () => ({
  useSyncStatus: () => ({ data: statusCell.data }),
}));

const mutateSpy = vi.fn();
const startMailboxConnectSpy = vi.fn();

vi.mock('./api/use-sync-now', () => ({
  useSyncNow: () => ({ isPending: false, mutate: mutateSpy }),
}));

vi.mock('@/features/mailboxes/connect-mailbox-url', () => ({
  startMailboxConnect: (mailboxId?: string) => startMailboxConnectSpy(mailboxId),
}));

/** ISO stamp `n` minutes before now. */
function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

describe('SyncErrorBanner', () => {
  beforeEach(() => {
    statusCell.data = undefined;
    mutateSpy.mockClear();
    startMailboxConnectSpy.mockClear();
  });

  it('renders nothing while the status query has no data (fail quiet)', () => {
    render(<SyncErrorBanner mailboxId={MAILBOX_ID} />);
    expect(screen.queryByTestId('sync-error-banner')).not.toBeInTheDocument();
  });

  it('renders nothing when there is no error stamp', () => {
    statusCell.data = statusOf({ last_synced_at: minutesAgo(5) });
    render(<SyncErrorBanner mailboxId={MAILBOX_ID} />);
    expect(screen.queryByTestId('sync-error-banner')).not.toBeInTheDocument();
  });

  it('shows the banner when the error is recent and newer than the last success', () => {
    statusCell.data = statusOf({
      last_synced_at: minutesAgo(30),
      last_sync_error_at: minutesAgo(5),
      last_sync_error_code: 'GMAIL_HISTORY_GONE',
    });
    render(<SyncErrorBanner mailboxId={MAILBOX_ID} />);
    expect(screen.getByTestId('sync-error-banner')).toBeInTheDocument();
    expect(screen.getByText(/new mail isn't syncing/i)).toBeInTheDocument();
  });

  it('shows the banner when the error is recent and no sync has ever completed', () => {
    statusCell.data = statusOf({
      last_synced_at: null,
      last_sync_error_at: minutesAgo(5),
      last_sync_error_code: 'GMAIL_HISTORY_GONE',
    });
    render(<SyncErrorBanner mailboxId={MAILBOX_ID} />);
    expect(screen.getByTestId('sync-error-banner')).toBeInTheDocument();
  });

  it('hides the banner when a success is newer than the error (recovered)', () => {
    statusCell.data = statusOf({
      last_synced_at: minutesAgo(2),
      last_sync_error_at: minutesAgo(5),
      last_sync_error_code: 'GMAIL_HISTORY_GONE',
    });
    render(<SyncErrorBanner mailboxId={MAILBOX_ID} />);
    expect(screen.queryByTestId('sync-error-banner')).not.toBeInTheDocument();
  });

  it('hides the banner when the error is older than 60 minutes', () => {
    statusCell.data = statusOf({
      last_synced_at: null,
      last_sync_error_at: minutesAgo(61),
      last_sync_error_code: 'GMAIL_HISTORY_GONE',
    });
    render(<SyncErrorBanner mailboxId={MAILBOX_ID} />);
    expect(screen.queryByTestId('sync-error-banner')).not.toBeInTheDocument();
  });

  it('keeps a revoked Gmail grant visible after the retryable-error window', () => {
    statusCell.data = statusOf({
      last_synced_at: minutesAgo(180),
      last_sync_error_at: minutesAgo(90),
      last_sync_error_code: 'InvalidGrantError',
    });
    render(<SyncErrorBanner mailboxId={MAILBOX_ID} />);

    expect(screen.getByTestId('sync-error-banner')).toBeInTheDocument();
    expect(screen.getByText(/gmail access expired/i)).toBeInTheDocument();
    expect(screen.getByText(/existing declutrmail history is safe/i)).toBeInTheDocument();
  });

  it('hides a revoked-grant banner after a newer success proves reconnection', () => {
    statusCell.data = statusOf({
      last_synced_at: minutesAgo(2),
      last_sync_error_at: minutesAgo(90),
      last_sync_error_code: 'InvalidGrantError',
    });
    render(<SyncErrorBanner mailboxId={MAILBOX_ID} />);

    expect(screen.queryByTestId('sync-error-banner')).not.toBeInTheDocument();
  });

  it('"Try again" fires the shared sync-now mutation', () => {
    statusCell.data = statusOf({
      last_synced_at: null,
      last_sync_error_at: minutesAgo(5),
      last_sync_error_code: 'GMAIL_HISTORY_GONE',
    });
    render(<SyncErrorBanner mailboxId={MAILBOX_ID} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(mutateSpy).toHaveBeenCalledTimes(1);
    expect(startMailboxConnectSpy).not.toHaveBeenCalled();
  });

  it('starts target-bound reconnect for an invalid grant and never retries sync-now', () => {
    statusCell.data = statusOf({
      last_synced_at: minutesAgo(30),
      last_sync_error_at: minutesAgo(5),
      last_sync_error_code: 'InvalidGrantError',
    });
    render(<SyncErrorBanner mailboxId={MAILBOX_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Gmail' }));

    expect(startMailboxConnectSpy).toHaveBeenCalledWith(MAILBOX_ID);
    expect(mutateSpy).not.toHaveBeenCalled();
  });
});
