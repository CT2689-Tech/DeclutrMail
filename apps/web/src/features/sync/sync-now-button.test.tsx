/**
 * SyncNowButton completion-watch tests (D38/D224).
 *
 * Locks the three outcomes of the post-click watch so it can never
 * regress into waiting on a completion signal that never happens:
 *   1. success — `last_synced_at` moves past the pre-click baseline;
 *   2. failure — `last_sync_error_at` moves (dead-lettered run never
 *      stamps success) → error toast, watch ends early;
 *   3. baseline freshness — the baseline comes from the pre-mutate
 *      REFETCH, not the (possibly hours-old) mounted cache, so
 *      pre-click drift cannot false-positive the first poll.
 */

import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import type { SyncStatus } from '@declutrmail/shared/contracts';
import { toast } from '@declutrmail/shared';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { startMailboxConnect } from '@/features/mailboxes/connect-mailbox-url';
import { SyncNowButton } from './sync-now-button';

vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: vi.fn() };
});

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

// Mutable cell the mocked hooks read — tests mutate + rerender.
const statusCell: { data: SyncStatus; refetchData: SyncStatus | null } = {
  data: statusOf({}),
  refetchData: null,
};

vi.mock('@/features/onboarding/api/use-sync-status', () => ({
  SYNC_STATUS_KEY: ['sync', 'status'] as const,
  useSyncStatus: () => ({
    data: statusCell.data,
    refetch: async () => ({ data: statusCell.refetchData ?? statusCell.data }),
  }),
}));

vi.mock('./api/use-sync-now', () => ({
  useSyncNow: () => ({
    isPending: false,
    mutate: (_vars: undefined, opts?: { onSuccess?: () => void; onSettled?: () => void }) => {
      opts?.onSuccess?.();
      opts?.onSettled?.();
    },
  }),
}));

const retryInitialSyncMutate = vi.fn();
vi.mock('./api/use-retry-initial-sync', () => ({
  useRetryInitialSync: () => ({
    isPending: false,
    mutate: retryInitialSyncMutate,
  }),
}));

vi.mock('@/features/mailboxes/connect-mailbox-url', () => ({
  startMailboxConnect: vi.fn(),
}));

function Harness({ mailboxId }: { mailboxId?: string | undefined } = {}) {
  // Rerender lever — the mocked useSyncStatus reads statusCell fresh on
  // every render, so bumping this state re-runs the watch effects.
  const [, bump] = useState(0);
  return (
    <>
      <button type="button" onClick={() => bump((n) => n + 1)}>
        rerender
      </button>
      {mailboxId !== undefined ? <SyncNowButton mailboxId={mailboxId} /> : <SyncNowButton />}
    </>
  );
}

function renderButton(mailboxId?: string) {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <Harness mailboxId={mailboxId} />
    </QueryWrapper>,
  );
}

async function clickSyncNow() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /check gmail for new emails/i }));
  });
}

function pushStatus(next: SyncStatus) {
  statusCell.data = next;
  fireEvent.click(screen.getByRole('button', { name: 'rerender' }));
}

describe('SyncNowButton completion watch', () => {
  beforeEach(() => {
    vi.mocked(toast).mockClear();
    statusCell.data = statusOf({ last_synced_at: '2026-07-07T10:00:00.000Z' });
    statusCell.refetchData = null;
  });
  afterEach(() => {
    vi.clearAllTimers();
  });

  it('hides Sync now while the current scoped Gmail grant needs reconnect', () => {
    statusCell.data = statusOf({
      last_synced_at: '2026-07-07T10:00:00.000Z',
      last_sync_error_at: '2026-07-07T10:05:00.000Z',
      last_sync_error_code: 'InvalidGrantError',
    });

    renderButton();

    expect(
      screen.queryByRole('button', { name: /check gmail for new emails/i }),
    ).not.toBeInTheDocument();
  });

  it('keeps Sync now available for a current retryable sync error', () => {
    statusCell.data = statusOf({
      last_synced_at: '2026-07-07T10:00:00.000Z',
      last_sync_error_at: '2026-07-07T10:05:00.000Z',
      last_sync_error_code: 'GMAIL_HISTORY_GONE',
    });

    renderButton();

    expect(screen.getByRole('button', { name: /check gmail for new emails/i })).toBeInTheDocument();
  });

  it('success — toasts "up to date" when last_synced_at moves past the baseline', async () => {
    renderButton();
    await clickSyncNow();
    expect(vi.mocked(toast)).not.toHaveBeenCalled();

    pushStatus(statusOf({ last_synced_at: '2026-07-07T10:05:00.000Z' }));
    expect(vi.mocked(toast)).toHaveBeenCalledWith('Inbox up to date — synced just now.', 'success');
    // Watch ended — the button is clickable again.
    expect(
      screen.getByRole('button', { name: /check gmail for new emails/i }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('failure — a moved error stamp ends the watch with an error toast (no infinite wait)', async () => {
    renderButton();
    await clickSyncNow();

    pushStatus(
      statusOf({
        last_synced_at: '2026-07-07T10:00:00.000Z', // unchanged — run never completed
        last_sync_error_at: '2026-07-07T10:00:30.000Z',
        last_sync_error_code: 'GMAIL_HISTORY_GONE',
      }),
    );
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      'Sync failed — check the mailbox connection and try again.',
      'danger',
    );
    expect(
      screen.getByRole('button', { name: /check gmail for new emails/i }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('baseline freshness — pre-click drift served by the refetch does not false-positive', async () => {
    // Mounted cache is stale (T0); the pre-mutate refetch returns T1
    // (an unrelated drift-sweep ran before the click).
    statusCell.data = statusOf({ last_synced_at: '2026-07-07T09:00:00.000Z' });
    statusCell.refetchData = statusOf({ last_synced_at: '2026-07-07T09:30:00.000Z' });

    renderButton();
    await clickSyncNow();

    // First poll observes the same T1 the refetch already reported —
    // NOT a completion of OUR run.
    pushStatus(statusOf({ last_synced_at: '2026-07-07T09:30:00.000Z' }));
    expect(vi.mocked(toast)).not.toHaveBeenCalled();

    // Our run completes → T2 → success.
    pushStatus(statusOf({ last_synced_at: '2026-07-07T09:31:00.000Z' }));
    expect(vi.mocked(toast)).toHaveBeenCalledWith('Inbox up to date — synced just now.', 'success');
  });
});

describe('SyncNowButton — readiness_status=failed (QA-sync-20260831-03)', () => {
  beforeEach(() => {
    retryInitialSyncMutate.mockClear();
    vi.mocked(startMailboxConnect).mockClear();
  });

  it('does not silently disappear when the initial sync has terminally failed', () => {
    // The negative control: reverting the `failed` branch in
    // `SyncNowButton` makes this assertion fail — the button used to
    // return `null` for every non-`ready` readiness value, including
    // `failed`, leaving the app-shell with no visible sync indicator at
    // all for an already-onboarded user whose mailbox re-enters this
    // state (a re-queued reconnect, or the server-side `cursorTooOld`
    // recovery).
    statusCell.data = statusOf({ readiness_status: 'failed', current_stage: 'failed' });

    renderButton('mailbox-1');

    expect(screen.getByText(/scan failed/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /check gmail for new emails/i }),
    ).not.toBeInTheDocument();
  });

  it('offers "Scan again", wired to the initial-sync retry mutation, for a non-auth failure', async () => {
    statusCell.data = statusOf({ readiness_status: 'failed', current_stage: 'failed' });

    renderButton('mailbox-1');
    const retryButton = screen.getByRole('button', { name: /scan again/i });
    await act(async () => {
      fireEvent.click(retryButton);
    });

    expect(retryInitialSyncMutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /reconnect gmail/i })).not.toBeInTheDocument();
  });

  it.each(['InvalidGrantError', 'AuthExpiredError'] as const)(
    'offers "Reconnect Gmail" instead of a doomed retry when the failure needs reauthorization (%s)',
    async (errorCode) => {
      // The negative control for `AuthExpiredError`: reverting
      // `FailedSyncIndicator`'s `needsReconnect` to the plain
      // `InvalidGrantError`-only `syncStatusNeedsReconnect` makes this
      // case fail — the onboarding gate's own failure screen already
      // reconnects for `AuthExpiredError` (QA-sync-20260831-07); this
      // indicator didn't, offering "Scan again" against the same dead
      // token instead (Codex adversarial review).
      statusCell.data = statusOf({
        readiness_status: 'failed',
        current_stage: 'failed',
        error_code: errorCode,
      });

      renderButton('mailbox-1');
      const reconnectButton = screen.getByRole('button', { name: /reconnect gmail/i });
      await act(async () => {
        fireEvent.click(reconnectButton);
      });

      // Also asserts the mailbox id the button reconnects: the retry
      // route requires the id being DISPLAYED, never a server-resolved
      // "active" mailbox — the same requirement `useRetryInitialSync`
      // documents for its own POST (Codex adversarial review).
      expect(vi.mocked(startMailboxConnect)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(startMailboxConnect)).toHaveBeenCalledWith('mailbox-1');
      expect(retryInitialSyncMutate).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /scan again/i })).not.toBeInTheDocument();
    },
  );

  it.each(['queued', 'syncing'] as const)(
    'still hides Sync now for pre-ready states (`queued`/`syncing`) — the onboarding gate owns those (%s)',
    (readiness) => {
      statusCell.data = statusOf({
        readiness_status: readiness,
        current_stage: 'fetching_metadata',
      });

      renderButton('mailbox-1');

      expect(screen.queryByText(/scan failed/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /check gmail for new emails/i }),
      ).not.toBeInTheDocument();
    },
  );
});
