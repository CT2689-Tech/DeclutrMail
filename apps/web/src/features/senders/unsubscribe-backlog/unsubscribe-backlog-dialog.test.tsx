import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PREVIEW_DETAILS, previewIncludesValue } from '@declutrmail/shared/copy';
import { pluralCopy, WS2_COPY, WS5_COPY } from '@declutrmail/shared/copy/launch';
import type { CompositeActionPreviewResult } from '@/lib/api/use-action';
import type { ActionRequest } from '../data';
import { ConfirmActionModal } from '../confirm-action-modal';
import { makeSender } from '../testing/make-sender';
import { UnsubscribeBacklogDialog } from './unsubscribe-backlog-dialog';
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

describe('Unsubscribe default choice', () => {
  it('exposes the actual Senders choice as a standalone phone layout slot', () => {
    render(
      <ConfirmActionModal
        request={request}
        compositePreview={preview}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('radio', { name: 'Unsubscribe only' }).closest('.dm-sheet-choice-slot'),
    ).not.toBeNull();
  });
  it('puts the existing sender facts behind Details for one sender', () => {
    render(
      <ConfirmActionModal
        request={request}
        compositePreview={preview}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const details = screen.getByText('Details').closest('details');
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Details'));
    expect(details).toHaveTextContent(PREVIEW_DETAILS.domain.label);
    expect(details).toHaveTextContent(sender.domain);
    expect(details).toHaveTextContent(PREVIEW_DETAILS.sender.label);
    expect(details).toHaveTextContent('12 in the last 90 days · 144 in all');
    expect(details).toHaveTextContent(PREVIEW_DETAILS.lastSeen.label);
    expect(details).toHaveTextContent('1 day ago');
    expect(details).toHaveTextContent(previewIncludesValue(false, null));
  });

  it('omits the received line when the sender row has no count', () => {
    render(
      <UnsubscribeBacklogDialog
        request={
          {
            verb: 'Unsubscribe',
            senders: [{ id: 'thin', name: 'Acme', unsubscribeMethod: 'one_click' }],
          } as ActionRequest
        }
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(/received/)).toBeNull();
  });

  it('keeps Details on Unsubscribe only without an includes row', () => {
    const quiet = makeSender({ unsubscribeMethod: 'one_click', inboxCount: 0 });
    render(
      <ConfirmActionModal
        request={{ verb: 'Unsubscribe', senders: [quiet] }}
        compositePreview={{ ...preview, counts: { ...counts, all: 0 } }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Details'));
    const details = screen.getByText('Details').closest('details');
    expect(details).toHaveTextContent(PREVIEW_DETAILS.domain.label);
    expect(details).not.toHaveTextContent(PREVIEW_DETAILS.includes.label);
    expect(screen.getByRole('radio', { name: 'Unsubscribe only' })).toBeChecked();
  });

  it('opens on + Archive when the row already has inbox mail and keeps that choice after the preview loads', () => {
    const row = makeSender({ unsubscribeMethod: 'one_click', inboxCount: 12 });
    const onConfirm = vi.fn();
    const view = render(
      <ConfirmActionModal
        request={{ verb: 'Unsubscribe', senders: [row] }}
        compositePreviewLoading
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('radio', { name: '+ Archive' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Unsubscribe only' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Unsubscribe + Archive' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '+ Archive' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '+ Delete' })).toBeDisabled();

    view.rerender(
      <ConfirmActionModal
        request={{ verb: 'Unsubscribe', senders: [row] }}
        compositePreview={{
          ...preview,
          sender: { ...preview.sender, id: row.id, name: row.name, domain: row.domain },
        }}
        compositePreviewLoading={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('radio', { name: '+ Archive' })).toBeChecked();
  });

  it('opens on Unsubscribe only when the row has no inbox mail', () => {
    const row = makeSender({ unsubscribeMethod: 'one_click', inboxCount: 0 });
    render(
      <ConfirmActionModal
        request={{ verb: 'Unsubscribe', senders: [row] }}
        compositePreviewLoading
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Unsubscribe only' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '+ Archive' })).not.toBeChecked();
  });
});

describe('Unsubscribe uses the action preview contract', () => {
  const widePreview = {
    ...preview,
    allMail: { counts: { ...counts, all: 9 }, recentMessages: preview.recentMessages },
  };

  it('shows both Delete scope counts for the selected age and confirms both actions and that count', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request}
        compositePreview={{
          ...widePreview,
          allMail: { ...widePreview.allMail, counts: { ...counts, all: 9, olderThan180d: 3 } },
        }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
      target: { value: 'all' },
    });
    const includeArchived = screen.getByRole('checkbox', { name: 'Include archived email' });
    expect(includeArchived).not.toBeChecked();
    fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
      target: { value: '180' },
    });
    expect(screen.getByRole('button', { name: 'Unsubscribe + Delete' })).toBeEnabled();
    fireEvent.click(includeArchived);
    expect(includeArchived).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + Delete' }));
    expect(onConfirm).toHaveBeenCalledWith({
      secondary: { type: 'delete', olderThanDays: 180 },
      archiveHistoric: false,
      reach: 'all_mail',
      senderIds: [sender.id],
    });
  });

  it.each(['archive', 'delete'] as const)(
    'previews the selected age and confirms the same %s cleanup range',
    (mode) => {
      const onConfirm = vi.fn();
      render(
        <ConfirmActionModal
          request={request}
          compositePreview={{
            ...widePreview,
            allMail: { ...widePreview.allMail, counts: { ...counts, all: 9, olderThan180d: 3 } },
          }}
          onCancel={vi.fn()}
          onConfirm={onConfirm}
        />,
      );
      if (mode === 'delete') {
        fireEvent.click(screen.getByRole('radio', { name: '+ Delete' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
          target: { value: 'all' },
        });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
      }
      const window = screen.getByRole('combobox', { name: 'Email age' });
      expect(window).toHaveValue('all');
      fireEvent.change(window, { target: { value: '180' } });
      expect(window).toHaveValue('180');
      expect(
        screen.getByRole('region', {
          name: mode === 'delete' ? 'What Delete will do' : 'What Archive will do',
        }),
      ).toHaveTextContent(mode === 'delete' ? '3 emails' : '1 email');
      // Archive's inbox bucket is smaller than the widened Delete bucket.
      if (mode === 'archive') {
        expect(screen.getByRole('option', { name: 'Older than 180 days' })).toBeInTheDocument();
      } else {
        expect(screen.getByRole('option', { name: 'Older than 180 days' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Include archived email' })).toBeChecked();
      }
      fireEvent.click(
        screen.getByRole('button', {
          name: mode === 'delete' ? 'Unsubscribe + Delete' : 'Unsubscribe + Archive',
        }),
      );
      expect(onConfirm).toHaveBeenCalledWith({
        secondary: { type: mode, olderThanDays: 180 },
        archiveHistoric: mode === 'archive',
        senderIds: [sender.id],
        ...(mode === 'delete' ? { reach: 'all_mail' } : {}),
      });
    },
  );

  it('keeps an empty range changeable and hides age for future-only unsubscribe', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionModal
        request={request}
        compositePreview={preview}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
      target: { value: '365' },
    });
    expect(screen.getByRole('button', { name: 'Unsubscribe + Archive' })).toBeDisabled();
    expect(screen.getByText('Change Email age, or choose Unsubscribe only.')).toBeVisible();
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Unsubscribe only' }));
    expect(screen.queryByRole('combobox', { name: 'Email age' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(onConfirm).toHaveBeenCalledWith({
      secondary: null,
      archiveHistoric: false,
      senderIds: [sender.id],
    });
    fireEvent.click(screen.getByRole('radio', { name: '+ Archive' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
      target: { value: 'all' },
    });
    expect(screen.getByRole('button', { name: 'Unsubscribe + Archive' })).toBeEnabled();
  });

  it('does not invent a missing age bucket or reuse a date range for another sender', () => {
    const onConfirm = vi.fn();
    const props = { request, onCancel: vi.fn(), onConfirm };
    const { rerender } = render(<ConfirmActionModal {...props} compositePreview={preview} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
      target: { value: '90' },
    });
    rerender(
      <ConfirmActionModal
        {...props}
        compositePreview={{ ...preview, counts: { all: 4 } as typeof counts }}
      />,
    );
    expect(screen.getByRole('option', { name: 'Older than 90 days (unavailable)' })).toBeDisabled();
    expect(screen.getByRole('heading')).not.toHaveTextContent('archive 0');
    expect(screen.getByRole('button', { name: 'Unsubscribe + Archive' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
    rerender(
      <ConfirmActionModal
        {...props}
        request={{ verb: 'Unsubscribe', senders: [makeSender({ id: 'another' })] }}
        compositePreview={preview}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Email age' })).toHaveValue('all');
    expect(screen.getByRole('region', { name: 'What Archive will do' })).toHaveTextContent(
      '4 email',
    );
  });

  it('uses eligible bulk age buckets for the title and each Details row, then locks on incomplete coverage', () => {
    const second = makeSender({
      id: 'second',
      name: 'Second sample',
      unsubscribeMethod: 'one_click',
    });
    const protectedSender = makeSender({ id: 'protected', name: 'Protected sample' });
    const data = {
      senders: [
        { senderId: sender.id, name: sender.name, counts, protected: false },
        {
          senderId: second.id,
          name: second.name,
          counts: { ...counts, olderThan90d: 3 },
          protected: false,
        },
        {
          senderId: protectedSender.id,
          name: protectedSender.name,
          counts: { ...counts, olderThan90d: 500 },
          protected: true,
        },
      ],
      totals: { ...counts, all: 8, olderThan90d: 5 },
      protectedCount: 1,
    };
    const props = {
      request: { verb: 'Unsubscribe' as const, senders: [sender, second, protectedSender] },
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
    };
    const { rerender } = render(
      <ConfirmActionModal {...props} bulkPreview={{ data, loading: false, error: false }} />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
      target: { value: '90' },
    });
    expect(screen.getByRole('heading')).toHaveTextContent('2 senders');
    expect(screen.getByRole('region', { name: 'What Archive will do' })).toHaveTextContent(
      '5 emails',
    );
    fireEvent.click(screen.getByText('Details'));
    expect(screen.getByText(/Second sample: 3 emails/)).toBeVisible();
    expect(screen.queryByText(/Protected sample.*500/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + Archive' }));
    expect(props.onConfirm).toHaveBeenCalledWith({
      secondary: { type: 'archive', olderThanDays: 90 },
      archiveHistoric: true,
      senderIds: [sender.id, second.id],
    });
    props.onConfirm.mockClear();
    // An eligible sender with no older email still receives the future unsubscribe.
    rerender(
      <ConfirmActionModal
        {...props}
        bulkPreview={{
          data: {
            ...data,
            senders: data.senders.map((row) =>
              row.senderId === second.id ? { ...row, counts: { ...counts, olderThan90d: 0 } } : row,
            ),
          },
          loading: false,
          error: false,
        }}
      />,
    );
    expect(screen.getByRole('region', { name: 'What Archive will do' })).toHaveTextContent(
      '2 email',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + Archive' }));
    expect(props.onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        senderIds: [sender.id, second.id],
        secondary: { type: 'archive', olderThanDays: 90 },
      }),
    );
    props.onConfirm.mockClear();
    rerender(
      <ConfirmActionModal
        {...props}
        bulkPreview={{
          data: {
            ...data,
            senders: data.senders.map((row) =>
              row.senderId === second.id ? { ...row, counts: { all: 4 } as typeof counts } : row,
            ),
          },
          loading: false,
          error: false,
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Unsubscribe + Archive' })).toBeDisabled();
    expect(screen.getByRole('heading')).not.toHaveTextContent('archive 2');
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

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
    expect(screen.queryByRole('checkbox', { name: 'Include archived email' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
      target: { value: 'all' },
    });
    const includeArchived = screen.getByRole('checkbox', {
      name: 'Include archived email',
    });
    expect(includeArchived).not.toBeChecked();
    fireEvent.click(includeArchived);
    expect(screen.getByRole('region', { name: 'What Delete will do' })).toHaveTextContent(
      '9 email',
    );
    expect(screen.getByText(backlogLine('delete', 9))).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: /^Unsubscribe \+ Delete(?: [\d,]+ emails?)?$/ }),
    );
    expect(onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        secondary: { type: 'delete', olderThanDays: null },
        reach: 'all_mail',
        senderIds: [sender.id],
      }),
    );
    fireEvent.click(screen.getByRole('radio', { name: '+ Archive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + Archive' }));
    expect(onConfirm.mock.calls.at(-1)![0]).not.toHaveProperty('reach');
    expect(onConfirm.mock.calls.at(-1)![0]).toMatchObject({ senderIds: [sender.id] });
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
      target: { value: 'all' },
    });
    expect(screen.getByRole('checkbox', { name: 'Include archived email' })).not.toBeChecked();
  });

  it('lets an empty inbox reach archived email through an explicit Delete choice', () => {
    render(
      <ConfirmActionModal
        request={request}
        compositePreview={{
          ...widePreview,
          counts: { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
        }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: '+ Archive' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
      target: { value: 'all' },
    });
    expect(screen.getByRole('button', { name: 'Unsubscribe + Delete' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Unsubscribe only' })).toBeNull();
    expect(screen.getByRole('heading')).not.toHaveTextContent(/delete 0 emails/);
    expect(screen.queryByText(/0 emails you already have/)).toBeNull();
    expect(screen.getByText('Archived email isn’t included.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Include archived' }));
    expect(
      screen.getByRole('button', { name: /^Unsubscribe \+ Delete(?: [\d,]+ emails?)?$/ }),
    ).toBeEnabled();
    expect(screen.getByRole('region', { name: 'What Delete will do' })).toHaveTextContent(
      '9 email',
    );
  });

  it('never substitutes inbox counts when the selected widened preview disappears or refetches', () => {
    const props = { request, onCancel: vi.fn(), onConfirm: vi.fn() };
    const { rerender } = render(
      <ConfirmActionModal
        {...props}
        compositePreview={{
          ...preview,
          allMail: { counts, recentMessages: preview.recentMessages },
        }}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
      target: { value: 'all' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
    rerender(<ConfirmActionModal {...props} compositePreview={preview} />);
    expect(
      screen.getByRole('button', { name: /^Unsubscribe \+ Delete(?: [\d,]+ emails?)?$/ }),
    ).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Include archived email' })).toBeChecked();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(props.onConfirm).not.toHaveBeenCalled();
    rerender(
      <ConfirmActionModal {...props} compositePreview={widePreview} compositePreviewLoading />,
    );
    expect(
      screen.getByRole('button', { name: /^Unsubscribe \+ Delete(?: [\d,]+ emails?)?$/ }),
    ).toBeDisabled();
    rerender(
      <ConfirmActionModal
        {...props}
        compositePreview={{ ...widePreview, allMail: { ...widePreview.allMail, counts } }}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Include archived email' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Include archived email' })).toBeEnabled();
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
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
      target: { value: 'all' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
    expect(screen.getByRole('region', { name: 'What Delete will do' })).toHaveTextContent(
      '9 email',
    );
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
    expect(
      screen.getByRole('button', { name: /^Unsubscribe \+ Delete(?: [\d,]+ emails?)?$/ }),
    ).toBeDisabled();
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
      if (mode === 'delete') fireEvent.click(screen.getByRole('radio', { name: '+ Delete' }));
      fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
        target: { value: 'all' },
      });
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
    expect(screen.getByRole('heading')).toHaveTextContent('Unsubscribe from 1 sender?');
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
      expect(screen.getByRole('radio', { name: '+ Archive' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Unsubscribe + Archive' })).toBeDisabled();
      expect(screen.getByRole('heading')).not.toHaveTextContent('4 emails');
      if (state === 'error') {
        expect(screen.getByText(WS5_COPY['f1.preview.backlog.error'])).toBeVisible();
        expect(screen.getByRole('radio', { name: '+ Delete' })).toBeDisabled();
        fireEvent.click(screen.getByRole('radio', { name: 'Unsubscribe only' }));
        expect(screen.getByText(WS5_COPY['f1.preview.backlog.error'])).toBeVisible();
        expect(
          screen.queryByText(WS5_COPY['preview.state.loadFailed.unsub']),
        ).not.toBeInTheDocument();
        const confirm = screen.getByRole('button', { name: 'Unsubscribe' });
        expect(confirm).toBeEnabled();
        fireEvent.click(confirm);
        expect(onConfirm).toHaveBeenCalledWith({
          secondary: null,
          archiveHistoric: false,
          senderIds: [sender.id],
        });
        expect(screen.queryByText(WS2_COPY.preview.loadFailed)).not.toBeInTheDocument();
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

  it('formats backlog counts of a thousand or more in the body, and the title does not count them', () => {
    render(
      <ConfirmActionModal
        request={request}
        compositePreview={{ ...preview, counts: { ...counts, all: 1139 } }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('region', { name: 'What Archive will do' })).toHaveTextContent(
      '1,139 emails',
    );
    expect(screen.getByRole('heading')).toHaveTextContent('Unsubscribe from this sender?');
    expect(screen.getByRole('heading').textContent).not.toMatch(/\b1139\b/);
    expect(screen.getByText(backlogMailLine('archive', 1139))).toBeVisible();
    fireEvent.click(screen.getByRole('radio', { name: '+ Delete' }));
    expect(screen.getByRole('heading')).toHaveTextContent('Unsubscribe from this sender?');
    expect(unsubscribeTitle('delete', sender.name, 1139)).toBe('Unsubscribe from this sender?');
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
      if (state === 'loading') {
        expect(confirm).toBeDisabled();
        fireEvent.click(confirm);
        fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
        expect(onConfirm).not.toHaveBeenCalled();
        return;
      }
      expect(screen.getByText(WS5_COPY['f1.preview.backlog.error'])).toBeVisible();
      expect(
        screen.queryByText(WS5_COPY['preview.state.loadFailed.unsub']),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: '+ Archive' })).toBeDisabled();
      expect(screen.getByRole('radio', { name: '+ Delete' })).toBeDisabled();
      expect(confirm).toBeEnabled();
      fireEvent.click(confirm);
      expect(onConfirm).toHaveBeenCalledWith({
        secondary: null,
        archiveHistoric: false,
        senderIds: [sender.id],
      });
    },
  );
});

it('explains a genuinely empty Delete backlog and makes the future-only choice available without sending', () => {
  const zero = { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 };
  const onConfirm = vi.fn();
  const props = { request, onCancel: vi.fn(), onConfirm };
  const { rerender } = render(
    <ConfirmActionModal
      {...props}
      compositePreview={{ ...preview, allMail: { counts, recentMessages: preview.recentMessages } }}
    />,
  );
  fireEvent.click(screen.getByRole('radio', { name: '+ Delete' }));
  rerender(
    <ConfirmActionModal
      {...props}
      compositePreview={{
        ...preview,
        counts: zero,
        allMail: { counts: zero, recentMessages: preview.recentMessages },
      }}
    />,
  );
  expect(screen.getByText('No current Inbox or archived email to delete.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Unsubscribe + Delete' })).toBeDisabled();
  fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Choose Unsubscribe only' }));
  expect(screen.getByRole('radio', { name: 'Unsubscribe only' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeEnabled();
  expect(onConfirm).not.toHaveBeenCalled();
});
