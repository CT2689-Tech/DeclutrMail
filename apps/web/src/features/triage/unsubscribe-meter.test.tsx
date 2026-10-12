import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';
import { WS5_COPY } from '@declutrmail/shared/copy/launch';

import { UnsubscribeBacklogDialog } from '@/features/senders/unsubscribe-backlog/unsubscribe-backlog-dialog';
import { makeSender } from '@/features/senders/testing/make-sender';

import { ActionSheet } from './action-sheet';
import { TRIAGE_QUEUE } from './fixtures';
import { InlinePreviewBlock } from './inline-preview';

const summary = vi.hoisted(() => ({
  data: {
    metered: true,
    limit: 1000,
    used: 360,
    remaining: 640,
    resetAt: '2026-11-09T00:00:00.000Z',
  } as CleanupSummaryDto,
}));

vi.mock('@/features/billing/use-cleanup-summary', () => ({
  useCleanupSummary: () => ({ isLoading: false, data: summary.data }),
}));

const row = TRIAGE_QUEUE[0]!;

beforeEach(() => {
  summary.data = {
    metered: true,
    limit: 1000,
    used: 360,
    remaining: 640,
    resetAt: '2026-11-09T00:00:00.000Z',
  };
});

function expectMailMeter(text: string) {
  expect(screen.getByTestId('meter-preview-line')).toHaveTextContent(text);
  expect(screen.getByText(WS5_COPY['f1.meterFree'])).toBeInTheDocument();
  expect(screen.queryByText(/cleanup action/)).toBeNull();
}

describe('unsubscribe mail movement states the email meter', () => {
  it('shows the remaining allowance on Triage, Senders, and the skip-sheet preview', () => {
    render(
      <ActionSheet
        open
        verb="Unsubscribe"
        row={row}
        inboxCount={12}
        quotaRemaining={34}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expectMailMeter('This clears 12 emails. You have 640 free this month.');

    render(
      <InlinePreviewBlock
        row={row}
        busy={false}
        shortcutLive={false}
        preview={{
          verb: 'Unsubscribe',
          archiveHistoric: true,
          backlogMode: 'archive',
          inboxCount: 12,
          quotaRemaining: 34,
        }}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getAllByTestId('meter-preview-line')).toHaveLength(2);

    render(
      <UnsubscribeBacklogDialog
        request={{
          verb: 'Unsubscribe',
          senders: [makeSender({ unsubscribeMethod: 'one_click' })],
        }}
        preferredInboxCount={12}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getAllByTestId('meter-preview-line')).toHaveLength(3);
    expect(screen.getAllByText(WS5_COPY['f1.meterFree'])).toHaveLength(3);
  });

  it('hides the meter when the backlog stays put', () => {
    render(
      <ActionSheet
        open
        verb="Unsubscribe"
        row={row}
        inboxCount={12}
        quotaRemaining={34}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Unsubscribe only' }));
    expect(screen.queryByTestId('meter-preview-line')).toBeNull();
    expect(screen.queryByText(WS5_COPY['f1.meterFree'])).toBeNull();
    expect(screen.queryByText(/cleanup action/)).toBeNull();
  });

  it('says the clear does not fit when the remaining allowance is smaller', () => {
    summary.data = { ...summary.data, used: 996, remaining: 4 };
    render(
      <UnsubscribeBacklogDialog
        request={{
          verb: 'Unsubscribe',
          senders: [makeSender({ unsubscribeMethod: 'one_click' })],
        }}
        preferredInboxCount={12}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId('meter-preview-line')).toHaveTextContent(
      'This clears 12 emails. You have 4 free left this month.',
    );
  });
});
