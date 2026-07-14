import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BulkActionPreviewResult } from '@/lib/api/use-action';
import { TRIAGE_QUEUE } from './data';
import { BatchActionSheet } from './batch-action-sheet';
import type { DomainBatch } from './domain-batch';

const batch: DomainBatch = {
  domain: 'example.com',
  startIndex: 0,
  rows: [0, 1, 2].map((index) => ({
    ...TRIAGE_QUEUE[0]!,
    id: `row-${index}`,
    senderId: `sender-${index}`,
    senderName: `Sender ${index + 1}`,
    senderEmail: `sender-${index + 1}@example.com`,
    senderDomain: 'example.com',
    protectionReason: null,
  })),
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
          open={true}
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

  it('allows click and keyboard confirmation after the live preview resolves', () => {
    const onConfirm = vi.fn();
    render(
      <BatchActionSheet
        open={true}
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
    expect(screen.getByText(/emails currently match in Inbox/i)).toBeInTheDocument();
    expect(screen.getByText(/Gmail is checked again at execution/i)).toBeInTheDocument();
    expect(screen.queryByText(/will move out of the inbox/i)).not.toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'Gmail account: active@gmail.com' })).toBeVisible();
  });
});
