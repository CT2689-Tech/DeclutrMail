import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CompositeActionPreviewResult } from '@/lib/api/use-action';
import { ConfirmActionModal } from '../confirm-action-modal';
import { makeSender } from '../testing/make-sender';

vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
const sender = makeSender({ unsubscribeMethod: 'one_click' });
const request = { verb: 'Unsubscribe' as const, senders: [sender] };
const counts = { all: 4, olderThan30d: 3, olderThan90d: 2, olderThan180d: 1, olderThan365d: 0 };
const preview: CompositeActionPreviewResult = {
  sender: {
    id: sender.id,
    name: sender.name,
    domain: sender.domain,
    lastSeenDays: 1,
    wroteToCount: 0,
  },
  counts,
  recentMessages: {
    all: [],
    olderThan30d: [],
    olderThan90d: [],
    olderThan180d: [],
    olderThan365d: [],
  },
  allMail: null,
  unsubAvailable: true,
  protected: false,
};

describe('Unsubscribe uses the action preview contract', () => {
  it.each(['archive', 'delete'] as const)(
    'shows the %s destination with Details closed for a bulk request',
    (mode) => {
      const second = makeSender({ id: 'second', unsubscribeMethod: 'one_click' });
      render(
        <ConfirmActionModal
          request={{ verb: 'Unsubscribe', senders: [sender, second] }}
          bulkPreview={{
            data: {
              senders: [sender, second].map((s) => ({
                senderId: s.id,
                name: s.name,
                counts,
                protected: false,
              })),
              totals: { ...counts, all: 8 },
              protectedCount: 0,
            },
            loading: false,
            error: false,
          }}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />,
      );
      if (mode === 'delete') fireEvent.click(screen.getByRole('radio', { name: '+ Delete 8' }));
      expect(screen.getByText('Details').closest('details')).not.toHaveAttribute('open');
      expect(
        screen.getByText(
          mode === 'archive'
            ? 'Existing inbox email leaves your inbox and stays in Gmail.'
            : 'Existing inbox email moves to Gmail Trash.',
        ),
      ).toBeVisible();
    },
  );

  it('titles a narrowed bulk request with the live included count', () => {
    const second = makeSender({ id: 'protected-second', unsubscribeMethod: 'one_click' });
    render(
      <ConfirmActionModal
        request={{ verb: 'Unsubscribe', senders: [sender, second] }}
        bulkPreview={{
          data: {
            senders: [
              { senderId: sender.id, name: sender.name, counts, protected: false },
              { senderId: second.id, name: second.name, counts, protected: true },
            ],
            totals: counts,
            protectedCount: 1,
          },
          loading: false,
          error: false,
        }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading')).toHaveTextContent(
      'Unsubscribe from 1 sender and archive 4 emails',
    );
  });
  it('supports the same explicit confirmation shortcut as Archive, Later and Delete', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request}
        compositePreview={preview}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith({
      secondary: { type: 'archive', olderThanDays: null },
      archiveHistoric: true,
    });
  });
  it('shows the active mailbox and warning dialog semantics', () => {
    render(
      <ConfirmActionModal
        request={request}
        compositePreview={preview}
        mailboxEmail="sample@synthetic.test"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('note', { name: 'Gmail account: sample@synthetic.test' }),
    ).toBeVisible();
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('keeps Cancel and Escape available during submission without a second confirmation', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request}
        compositePreview={preview}
        submitting
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Submitting…' }));
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it.each(['refetch', 'error'] as const)(
    'does not arm cleanup from cached counts during %s',
    (state) => {
      const onConfirm = vi.fn();
      const onRetryPreview = vi.fn();
      render(
        <ConfirmActionModal
          request={request}
          compositePreview={preview}
          compositePreviewLoading={state === 'refetch'}
          compositePreviewError={state === 'error'}
          onRetryPreview={onRetryPreview}
          onCancel={vi.fn()}
          onConfirm={onConfirm}
        />,
      );
      expect(screen.getByRole('radio', { name: /\+ Archive/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Unsubscribe + Archive' })).toBeDisabled();
      expect(screen.getByRole('heading')).not.toHaveTextContent('4 emails');
      if (state === 'error') {
        fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
        expect(onRetryPreview).toHaveBeenCalledOnce();
      }
    },
  );

  it('offers Refresh senders and blocks a disappeared sender', () => {
    const onRefreshSenders = vi.fn();
    render(
      <ConfirmActionModal
        request={request}
        compositePreviewError
        previewSenderGone
        onRefreshSenders={onRefreshSenders}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh senders' }));
    expect(onRefreshSenders).toHaveBeenCalledOnce();
  });
});
