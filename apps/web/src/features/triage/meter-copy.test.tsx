import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';
import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory } from '@declutrmail/shared/entitlements';
import { hideLegacyQuotaLine } from '@/features/shell/meter-preview-slot';
import { ConfirmActionModal } from '@/features/senders/confirm-action-modal';
import { makeSender } from '@/features/senders/testing/make-sender';
import type { ActionRequest } from '@/features/senders/data';

import { ActionSheet } from './action-sheet';
import { TriageEmptyState } from './empty-state';
import { TRIAGE_QUEUE, TRIAGE_SESSION_STATS_FREE } from './fixtures';

const summaryState = vi.hoisted(() => ({
  data: undefined as CleanupSummaryDto | undefined,
}));

vi.mock('@/features/billing/use-cleanup-summary', () => ({
  useCleanupSummary: () => ({ data: summaryState.data, isLoading: false }),
}));

const metered: CleanupSummaryDto = {
  metered: true,
  limit: 1000,
  used: 360,
  remaining: 640,
  resetAt: '2026-11-01T00:00:00.000Z',
};

const row = TRIAGE_QUEUE[0]!;
const sender = makeSender();
const buckets = {
  all: 12,
  olderThan30d: 3,
  olderThan90d: 2,
  olderThan180d: 1,
  olderThan365d: 0,
};

beforeEach(() => {
  summaryState.data = undefined;
});

describe('meter copy', () => {
  it('keeps the sender-unit sentence until a metered summary exists', () => {
    expect(hideLegacyQuotaLine('Uses 1 of your 34 cleanup actions left this month.', null)).toBe(
      'Uses 1 of your 34 cleanup actions left this month.',
    );
    expect(
      hideLegacyQuotaLine('Uses 1 of your 34 cleanup actions left this month.', {
        ...metered,
        metered: false,
      }),
    ).toBe('Uses 1 of your 34 cleanup actions left this month.');
    expect(
      hideLegacyQuotaLine('Uses 1 of your 34 cleanup actions left this month.', metered),
    ).toBeNull();
  });

  it('keeps the action sentence on the sheet when the email meter is absent', () => {
    render(
      <ActionSheet
        open
        verb="Archive"
        row={row}
        inboxCount={12}
        quotaRemaining={34}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(
      screen.getByText('This clears 1 email. You have 34 free this month.'),
    ).toBeInTheDocument();
  });

  it('replaces the action sentence with the email count and leaves confirm available', () => {
    summaryState.data = metered;
    render(
      <ActionSheet
        open
        verb="Archive"
        row={row}
        inboxCount={800}
        quotaRemaining={0}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText(/cleanup action/)).not.toBeInTheDocument();
    expect(
      screen.getByText('This clears 800 emails. You have 640 free left this month.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Archive/ })).toBeEnabled();
  });

  it('uses the free sentence for an unsubscribe that moves no mail', () => {
    summaryState.data = metered;
    render(
      <ActionSheet
        open
        verb="Unsubscribe"
        row={row}
        inboxCount={4}
        quotaRemaining={34}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText('Unsubscribing is free and doesn’t count.')).toBeInTheDocument();
    expect(screen.queryByText(/cleanup action/)).not.toBeInTheDocument();
    expect(screen.queryByText(/clears 0/)).not.toBeInTheDocument();
  });

  it('does not swap a sender-unit shortfall for an upgrade once the email meter is on', () => {
    summaryState.data = metered;
    const second = makeSender({ id: 'sender-q2', displayName: 'Quota Two', email: 'q2@x.com' });
    const request: ActionRequest = { verb: 'Archive', senders: [sender, second] };
    render(
      <ConfirmActionModal
        request={request}
        onCancel={() => {}}
        onConfirm={() => {}}
        bulkPreview={{
          data: {
            senders: [
              { senderId: sender.id, name: sender.name, counts: buckets, protected: false },
              { senderId: second.id, name: second.name, counts: buckets, protected: false },
            ],
            totals: buckets,
            protectedCount: 0,
          },
          loading: false,
          error: false,
        }}
        cleanupQuota={{ remaining: 1, resetsAt: null }}
      />,
    );
    expect(screen.queryByText(/cleanup action/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fillStory(WS1_COPY['cap.plus.link']) })).toBeNull();
    expect(screen.getByRole('button', { name: /Archive/ })).toBeEnabled();
    expect(
      screen.getByText('This clears 12 emails. You have 640 free this month.'),
    ).toBeInTheDocument();
  });

  it('keeps the empty-state action sentence until the email meter exists', () => {
    render(<TriageEmptyState stats={TRIAGE_SESSION_STATS_FREE} readiness="ready" />);
    expect(screen.getByText('2 of 50 free emails left')).toBeInTheDocument();
    expect(screen.queryByText(/Jan 1|resets/)).not.toBeInTheDocument();
  });

  it('shows the email allowance on the empty state when the meter is on', () => {
    summaryState.data = metered;
    render(<TriageEmptyState stats={TRIAGE_SESSION_STATS_FREE} readiness="ready" />);
    expect(screen.queryByText(/cleanup action/)).not.toBeInTheDocument();
    expect(screen.getByText('640 of 1,000 free emails left · resets Nov 1')).toBeInTheDocument();
  });
});
