import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { pluralCopy, WS2_COPY, WS5_COPY } from '@declutrmail/shared/copy/launch';
import type { CompositeActionPreviewResult } from '@/lib/api/use-action';
import { ConfirmActionModal } from '../confirm-action-modal';
import { makeSender } from '../testing/make-sender';
import { backlogMailLine, unsubscribeTitle } from './preview-copy';

function backlogLine(mode: 'archive' | 'delete', n: number): string {
  return backlogMailLine(mode, n);
}

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

  it('previews and confirms Include archived email only for Delete, then resets on mode changes', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request}
        compositePreview={widePreview}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(
      screen.queryByRole('checkbox', { name: WS2_COPY.simplify.confirm.includeArchived }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete 4' }));
    const includeArchived = screen.getByRole('checkbox', {
      name: WS2_COPY.simplify.confirm.includeArchived,
    });
    expect(includeArchived).not.toBeChecked();
    fireEvent.click(includeArchived);
    expect(screen.getByRole('heading')).toHaveTextContent('delete 9 emails');
    expect(screen.getByText(backlogLine('delete', 9))).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + Delete' }));
    expect(onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        secondary: { type: 'delete', olderThanDays: null },
        reach: 'all_mail',
        senderIds: [sender.id],
      }),
    );
    fireEvent.click(screen.getByRole('radio', { name: '+ Archive 4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + Archive' }));
    expect(onConfirm.mock.calls.at(-1)![0]).not.toHaveProperty('reach');
    expect(onConfirm.mock.calls.at(-1)![0]).toMatchObject({ senderIds: [sender.id] });
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete 4' }));
    expect(
      screen.getByRole('checkbox', { name: WS2_COPY.simplify.confirm.includeArchived }),
    ).not.toBeChecked();
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
    expect(screen.getByRole('button', { name: WS5_COPY['f1.segment.unsubOnly'] })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Unsubscribe + Delete' })).toBeNull();
    expect(screen.getByRole('heading')).not.toHaveTextContent(/delete 0 emails/);
    expect(screen.queryByText(/0 emails you already have/)).toBeNull();
    expect(screen.getByText(WS5_COPY['f1.preview.archived.hint'])).toBeVisible();
    fireEvent.click(
      screen.getByRole('checkbox', { name: WS2_COPY.simplify.confirm.includeArchived }),
    );
    expect(screen.getByRole('button', { name: 'Unsubscribe + Delete' })).toBeEnabled();
    expect(screen.getByRole('heading')).toHaveTextContent('delete 9 emails');
  });

  it('never substitutes inbox counts when the selected widened preview disappears or refetches', () => {
    const props = { request, onCancel: vi.fn(), onConfirm: vi.fn() };
    const { rerender } = render(<ConfirmActionModal {...props} compositePreview={widePreview} />);
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete 4' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: WS2_COPY.simplify.confirm.includeArchived }),
    );
    rerender(<ConfirmActionModal {...props} compositePreview={preview} />);
    expect(screen.getByRole('button', { name: 'Unsubscribe + Delete' })).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: WS2_COPY.simplify.confirm.includeArchived }),
    ).toBeChecked();
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
    expect(
      screen.getByRole('checkbox', { name: WS2_COPY.simplify.confirm.includeArchived }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: WS2_COPY.simplify.confirm.includeArchived }),
    ).toBeEnabled();
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
    fireEvent.click(
      screen.getByRole('checkbox', { name: WS2_COPY.simplify.confirm.includeArchived }),
    );
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
      expect(screen.getByText(backlogLine(mode, 8))).toBeVisible();
    },
  );

  it('titles a narrowed bulk request with the live included count', () => {
    const second = makeSender({ id: 'protected-second', unsubscribeMethod: 'one_click' });
    const onConfirm = vi.fn();
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
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('heading')).toHaveTextContent(
      'Unsubscribe from 1 sender and archive 4 emails',
    );
    expect(
      screen.getByText(pluralCopy(WS5_COPY['f1.selection.someProtected'], 1, { k: '1' })),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + Archive' }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        senderIds: [sender.id],
        archiveHistoric: true,
      }),
    );
    expect(onConfirm.mock.calls[0]![0].senderIds).toEqual([sender.id]);
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
      senderIds: [sender.id],
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
    expect(screen.getByRole('button', { name: WS5_COPY['f1.button.busy'] })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: WS5_COPY['f1.button.busy'] }));
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
        fireEvent.click(screen.getByRole('button', { name: WS2_COPY.home.failed.retry }));
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
    expect(screen.getByText(WS2_COPY.simplify.senders.gone)).toBeVisible();
    expect(screen.queryByText('This sender is no longer in this mailbox.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh senders' }));
    expect(onRefreshSenders).toHaveBeenCalledOnce();
  });

  it('formats backlog counts of a thousand or more in the title and the body', () => {
    render(
      <ConfirmActionModal
        request={request}
        compositePreview={{ ...preview, counts: { ...counts, all: 1139 } }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading')).toHaveTextContent('archive 1,139 emails');
    expect(screen.getByRole('heading').textContent).not.toMatch(/\b1139\b/);
    expect(screen.getByText(backlogMailLine('archive', 1139))).toBeVisible();
    expect(unsubscribeTitle('delete', sender.name, 1139)).toBe(
      `Unsubscribe from ${sender.name} and delete 1,139 emails?`,
    );
    expect(backlogMailLine('delete', 1139)).toBe(
      '1,139 emails you already have: moved to Gmail Trash (Delete)',
    );
  });

  it.each(['loading', 'failure'] as const)(
    'never posts a Protected or unnamed sender while the bulk preview is %s',
    (state) => {
      const protectedSender = makeSender({
        id: 'protected-sender',
        protectionFlags: {
          isProtected: true,
          protectionReason: 'user_defined',
          protectionSetAt: '2026-06-01T00:00:00.000Z',
        },
      });
      const unnamed = makeSender({ id: 'unnamed-sender', unsubscribeMethod: 'one_click' });
      const onConfirm = vi.fn();
      render(
        <ConfirmActionModal
          request={{ verb: 'Unsubscribe', senders: [unnamed, protectedSender] }}
          bulkPreview={{
            data: {
              senders: [
                {
                  senderId: unnamed.id,
                  name: unnamed.name,
                  counts,
                  protected: false,
                },
                {
                  senderId: protectedSender.id,
                  name: protectedSender.name,
                  counts,
                  protected: true,
                },
              ],
              totals: counts,
              protectedCount: 1,
            },
            loading: state === 'loading',
            error: state === 'failure',
          }}
          onCancel={vi.fn()}
          onConfirm={onConfirm}
        />,
      );
      fireEvent.click(screen.getByRole('radio', { name: 'Unsubscribe only' }));
      const confirm = screen.getByRole('button', { name: 'Unsubscribe' });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
      const posted = onConfirm.mock.calls.flatMap(
        (call) => (call[0] as { senderIds: string[] }).senderIds,
      );
      expect(posted).not.toContain(protectedSender.id);
      expect(posted).not.toContain(unnamed.id);
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );

  it.each(['loading', 'failure'] as const)(
    'keeps a single-sender Unsubscribe confirm closed while the preview is %s',
    (state) => {
      const onConfirm = vi.fn();
      render(
        <ConfirmActionModal
          request={request}
          compositePreview={preview}
          compositePreviewLoading={state === 'loading'}
          compositePreviewError={state === 'failure'}
          onCancel={vi.fn()}
          onConfirm={onConfirm}
        />,
      );
      fireEvent.click(screen.getByRole('radio', { name: 'Unsubscribe only' }));
      const confirm = screen.getByRole('button', { name: 'Unsubscribe' });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );
});
