import { fireEvent, render, screen, within } from '@testing-library/react';
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

      const confirm = screen.getByRole('button', { name: /^Archive( [\d,]+)?$/ });
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

    fireEvent.click(screen.getByRole('button', { name: /^Archive( [\d,]+)?$/ }));
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(2);
    // The count is the title and the button; its scope sits in Details.
    expect(
      screen.getByRole('heading', { name: /Archive 3 emails from 3 senders\?/ }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Archive 3' })).toBeEnabled();
    expect(screen.getByText(/Inbox now, rechecked when it runs/i)).toBeInTheDocument();
    expect(screen.getByText(/From example\.com\./)).toBeInTheDocument();
    expect(screen.getByText(/One undo reverses the whole batch/)).toBeInTheDocument();
    expect(
      screen.getByRole('note', { name: 'Gmail account: active@gmail.com' }),
    ).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: /^Later( [\d,]+)?$/ })).toBeDisabled();

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
    expect(screen.getByRole('button', { name: /^Later( [\d,]+)?$/ })).not.toBeDisabled();
  });

  // Codex review 2026-09-03, round 2: the live preview can legitimately
  // resolve to zero actionable senders — every queued one went Protected,
  // or was deleted, since the batch was queued. Confirm must disable
  // itself instead of letting the click through to a server rejection.
  it('disables confirm when the live preview resolves with every sender Protected', () => {
    const onConfirm = vi.fn();
    const allProtected: BulkActionPreviewResult = {
      senders: readyPreview.senders.map((s) => ({ ...s, protected: true })),
      totals: readyPreview.totals,
      protectedCount: readyPreview.senders.length,
    };
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview={allProtected}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole('button', { name: /^Archive( [\d,]+)?$/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Protected or gone/i)).toBeInTheDocument();
  });

  it('disables confirm when the senders are actionable but none has inbox email', () => {
    const onConfirm = vi.fn();
    const zeroTotal: BulkActionPreviewResult = {
      senders: readyPreview.senders.map((s) => ({
        ...s,
        protected: false,
        counts: { ...s.counts, all: 0 },
      })),
      totals: { ...readyPreview.totals, all: 0 },
      protectedCount: 0,
    };
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview={zeroTotal}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    // A no-op that would still spend cleanup actions on Free.
    const confirm = screen.getByRole('button', { name: /^Archive( [\d,]+)?$/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: /Nothing in your inbox/ })).toBeInTheDocument();
  });

  // The footer used to say "close and refresh" with no control that did
  // either — the single-sender sheet's Refresh, on the batch dead end.
  it('offers Refresh triage as the route out when nothing is actionable', () => {
    const onRefreshTriage = vi.fn();
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview={{ senders: [], totals: readyPreview.totals, protectedCount: 0 }}
        onCancel={() => {}}
        onConfirm={() => {}}
        onRefreshTriage={onRefreshTriage}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh triage' }));
    expect(onRefreshTriage).toHaveBeenCalledTimes(1);
  });

  it('shows no Refresh while the batch still has actionable senders', () => {
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview={readyPreview}
        onCancel={() => {}}
        onConfirm={() => {}}
        onRefreshTriage={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Refresh triage' })).toBeNull();
  });

  it('disables confirm when the live preview resolves with every sender deleted since queuing', () => {
    const onConfirm = vi.fn();
    const allGone: BulkActionPreviewResult = {
      senders: [],
      totals: readyPreview.totals,
      protectedCount: 0,
    };
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview={allGone}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole('button', { name: /^Archive( [\d,]+)?$/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Protected or gone/i)).toBeInTheDocument();
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
        preview={readyPreview}
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
        preview={readyPreview}
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
        preview={readyPreview}
        quotaRemaining={null}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText(/cleanup action/)).toBeNull();
  });
});

// QA-archive-20260901-01: the sheet named a vague "multiple senders"
// instead of the real, actionable count — the same count `unitsNeeded`
// charges.
describe('BatchActionSheet — the title names the real count (QA-archive-20260901-01)', () => {
  it('names the verb and the real eligible-sender count, not a vague "multiple"', () => {
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview={readyPreview}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: /from 3 senders/ })).toBeInTheDocument();
    expect(screen.queryByText(/multiple senders/)).toBeNull();
  });

  // Codex review 2026-09-03: `eligible` is the queue snapshot taken before
  // the bulk preview ran. If the live preview newly flags one of those
  // senders Protected, the title/quota must all drop to the count
  // the confirm click actually commits to (`enqueueBulkComposite` skips
  // Protected rows) — never the stale queue count.
  it('drops the count to the live actionable total when the preview newly flags a sender Protected', () => {
    const previewWithOneProtected: BulkActionPreviewResult = {
      senders: readyPreview.senders.map((s, i) => (i === 0 ? { ...s, protected: true } : s)),
      totals: readyPreview.totals,
      protectedCount: 1,
    };
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview={previewWithOneProtected}
        quotaRemaining={34}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: /from 2 senders\?/ })).toBeInTheDocument();
    // Said once, in the note.
    expect(screen.getByText(/1 Protected sender is skipped\./)).toBeInTheDocument();
    expect(screen.getByText('Protected')).toBeInTheDocument();
    expect(
      screen.getByText(/Uses 2 of your 34 cleanup actions left this month/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/3 senders/)).toBeNull();
  });
});

describe('BatchActionSheet — PreviewSheet grammar', () => {
  it('names the senders but no count while the preview is still counting', () => {
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview="loading"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Archive email from 3 senders?' })).toBeVisible();
    expect(screen.getByText(/Counting the inbox/)).toBeInTheDocument();
  });

  it('lists every sender with its own count in Details', () => {
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview={readyPreview}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    const list = screen.getByRole('list', { name: 'Current per-sender matches' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('Sender 2')).toBeInTheDocument();
  });

  it('Escape cancels', () => {
    const onCancel = vi.fn();
    render(
      <BatchActionSheet
        open
        verb="Archive"
        batch={batch}
        preview={readyPreview}
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
