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

function Harness() {
  // Rerender lever — the mocked useSyncStatus reads statusCell fresh on
  // every render, so bumping this state re-runs the watch effects.
  const [, bump] = useState(0);
  return (
    <>
      <button type="button" onClick={() => bump((n) => n + 1)}>
        rerender
      </button>
      <SyncNowButton />
    </>
  );
}

function renderButton() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <Harness />
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
