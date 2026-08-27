import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BulkActionPreviewResult } from '@/lib/api/use-action';
import { TRIAGE_QUEUE } from './data';
import { BatchActionSheet } from './batch-action-sheet';
import type { DomainBatch } from './domain-batch';

const batchRows = [0, 1, 2].map((index) => ({
  ...TRIAGE_QUEUE[0]!,
  id: `row-${index}`,
  senderId: `sender-${index}`,
  senderName: `Sender ${index + 1}`,
  senderEmail: `sender-${index + 1}@example.com`,
  senderDomain: 'example.com',
  protectionReason: null,
}));
const batch: DomainBatch = {
  domain: 'example.com',
  startIndex: 0,
  rows: batchRows,
  eligibleRows: batchRows,
};

const buckets = {
  all: 3,
  olderThan30d: 2,
  olderThan90d: 1,
  olderThan180d: 0,
  olderThan365d: 0,
};

const readyPreview: BulkActionPreviewResult = {
  senders: batch.rows.map((row) => ({
    senderId: row.senderId,
    name: row.senderName,
    counts: { ...buckets, all: 1 },
    protected: false,
  })),
  totals: buckets,
  protectedCount: 0,
};

describe('BatchActionSheet — live-preview confirm gate', () => {
  it.each(['loading', 'unavailable'] as const)(
    'blocks click and keyboard confirmation while the preview is %s',
    (preview) => {
      const onConfirm = vi.fn();
      render(
        <BatchActionSheet
          open
          verb="Archive"
          batch={batch}
          preview={preview}
          onCancel={() => {}}
          onConfirm={onConfirm}
        />,
      );

      const confirm = screen.getByRole('button', { name: /^Archive all/ });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );

  it('offers an explicit retry when the preview is unavailable', () => {
    const onRetryPreview = vi.fn();
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview="unavailable"
        onCancel={() => {}}
        onConfirm={() => {}}
        onRetryPreview={onRetryPreview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /retry preview/i }));
    expect(onRetryPreview).toHaveBeenCalledTimes(1);
  });

  it('allows click and keyboard confirmation after the live preview resolves', () => {
    const onConfirm = vi.fn();
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview={readyPreview}
        mailboxEmail="active@gmail.com"
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Archive all/ }));
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/emails in Inbox now/i)).toBeInTheDocument();
    expect(screen.getByText(/Rechecked when it runs/i)).toBeInTheDocument();
    expect(screen.queryByText(/will move out of the inbox/i)).not.toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'Gmail account: active@gmail.com' })).toBeVisible();
  });

  it('requires an exact future return time for Later', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <BatchActionSheet
        open
        verb="Later"
        batch={batch}
        preview={readyPreview}
        wakeAt={null}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('button', { name: /later for all/i })).toBeDisabled();

    rerender(
      <BatchActionSheet
        open
        verb="Later"
        batch={batch}
        preview={readyPreview}
        wakeAt={new Date(Date.now() + 86_400_000).toISOString()}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('button', { name: /later for all/i })).not.toBeDisabled();
  });
});

// A domain batch is the largest spend reachable from Triage — one cleanup
// action per eligible sender — and stated no cost at all. Its own
// `onError` catches 402 FREE_CAP_REACHED, so the cap was known to be
// reachable from here; the preview just never said so before the click.
describe('BatchActionSheet — states what the batch costs (D226)', () => {
  it('counts one cleanup action per eligible sender', () => {
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview={{ senders: [], totals: buckets, protectedCount: 0 }}
        quotaRemaining={34}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(
      screen.getByText(/Uses 3 of your 34 cleanup actions left this month/),
    ).toBeInTheDocument();
  });

  it('warns instead of promising when the batch exceeds the allowance', () => {
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview={{ senders: [], totals: buckets, protectedCount: 0 }}
        quotaRemaining={2}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(
      screen.getByText(/needs 3 cleanup actions but only 2 are left this month/),
    ).toBeInTheDocument();
  });

  it('says nothing on a tier that does not meter cleanup actions', () => {
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview={{ senders: [], totals: buckets, protectedCount: 0 }}
        quotaRemaining={null}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText(/cleanup action/)).toBeNull();
  });
});
