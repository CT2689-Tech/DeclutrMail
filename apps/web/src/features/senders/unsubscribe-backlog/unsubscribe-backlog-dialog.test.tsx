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
  const widePreview = {
    ...preview,
    allMail: { counts: { ...counts, all: 9 }, recentMessages: preview.recentMessages },
  };

  it('previews and confirms Inbox + archived only for Delete, then resets on mode changes', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request}
        compositePreview={widePreview}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByRole('radiogroup', { name: 'Where it applies' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete 4' }));
    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
    expect(screen.getByRole('heading')).toHaveTextContent('delete 9 emails');
    expect(
      screen.getByText('Existing inbox and archived email moves to Gmail Trash.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + Delete' }));
    expect(onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        secondary: { type: 'delete', olderThanDays: null },
        reach: 'all_mail',
      }),
    );
    fireEvent.click(screen.getByRole('radio', { name: '+ Archive 4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + Archive' }));
    expect(onConfirm.mock.calls.at(-1)![0]).not.toHaveProperty('reach');
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete 4' }));
    expect(screen.getByRole('radio', { name: /^Inbox only/ })).toBeChecked();
  });

  it('lets an empty inbox reach archived email through an explicit Delete choice', () => {
    render(
      <ConfirmActionModal
        request={request}
        compositePreview={{ ...widePreview, counts: { ...counts, all: 0 } }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: '+ Archive 0' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete 0' }));
    expect(screen.getByRole('button', { name: 'Unsubscribe + Delete' })).toBeDisabled();
    expect(screen.getByText(/Switch to Inbox \+ archived/)).toBeVisible();
    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
    expect(screen.getByRole('button', { name: 'Unsubscribe + Delete' })).toBeEnabled();
    expect(screen.getByRole('heading')).toHaveTextContent('delete 9 emails');
  });

  it('never substitutes inbox counts when the selected widened preview disappears or refetches', () => {
    const props = { request, onCancel: vi.fn(), onConfirm: vi.fn() };
    const { rerender } = render(<ConfirmActionModal {...props} compositePreview={widePreview} />);
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete 4' }));
    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
    rerender(<ConfirmActionModal {...props} compositePreview={preview} />);
    expect(screen.getByRole('button', { name: 'Unsubscribe + Delete' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Inbox \+ archived/ })).toBeChecked();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(props.onConfirm).not.toHaveBeenCalled();
    rerender(
      <ConfirmActionModal {...props} compositePreview={widePreview} compositePreviewLoading />,
    );
    expect(screen.getByRole('button', { name: 'Unsubscribe + Delete' })).toBeDisabled();
    rerender(
      <ConfirmActionModal
        {...props}
        compositePreview={{ ...widePreview, allMail: { ...widePreview.allMail, counts } }}
      />,
    );
    expect(screen.getByRole('radio', { name: /Inbox \+ archived/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^Inbox only/ })).toBeEnabled();
  });

  it('uses only eligible bulk archived counts and blocks incomplete all-mail coverage', () => {
    const second = makeSender({ id: 'protected-second', unsubscribeMethod: 'one_click' });
    const props = {
      request: { verb: 'Unsubscribe' as const, senders: [sender, second] },
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
    };
    const data = {
      senders: [
        {
          senderId: sender.id,
          name: sender.name,
          counts,
          allMailCounts: { ...counts, all: 9 },
          protected: false,
        },
        {
          senderId: second.id,
          name: second.name,
          counts,
          allMailCounts: { ...counts, all: 500 },
          protected: true,
        },
      ],
      totals: counts,
      allMailTotals: { ...counts, all: 9 },
      protectedCount: 1,
    };
    const { rerender } = render(
      <ConfirmActionModal {...props} bulkPreview={{ data, loading: false, error: false }} />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete 4' }));
    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived 9/ }));
    expect(screen.getByRole('heading')).toHaveTextContent('1 sender and delete 9 emails');
    rerender(
      <ConfirmActionModal
        {...props}
        bulkPreview={{
          data: {
            ...data,
            senders: data.senders.map((row) => ({
              senderId: row.senderId,
              name: row.name,
              counts: row.counts,
              protected: row.protected,
            })),
          },
          loading: false,
          error: false,
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Unsubscribe + Delete' })).toBeDisabled();
  });

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
