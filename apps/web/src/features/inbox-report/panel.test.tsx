import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WS5_COPY } from '@declutrmail/shared/copy/launch';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { InboxReportCard } from './index';
import { InboxReportPanel } from './panel';

const full: InboxReportDto = {
  generatedAt: '2026-10-11T00:00:00.000Z',
  mailboxSizeBucket: 'under_1gb',
  insights: [
    {
      id: 'mostly_unread_share',
      pct: 91,
      senderCount: 2,
      sweeperExcluded: 0,
      window: '90d',
    },
    { id: 'people_share', pct: 8 },
  ],
  fix: { senderKeys: ['s1', 's2'], sendersCount: 2, inboxEmailCount: 10 },
  fallbackSenderCount: 2,
  receivedCount: 1139,
  totalBytes: 1000,
  variant: 'full',
};

const calm: InboxReportDto = {
  ...full,
  insights: [],
  fix: { senderKeys: [], sendersCount: 0, inboxEmailCount: 0 },
  fallbackSenderCount: 0,
  variant: 'fallback',
};

afterEach(() => resetFetchStub());

describe('InboxReportPanel', () => {
  it('opens the archive-prefilled dialog and does not confirm it', () => {
    const onFixConfirmed = vi.fn();
    render(
      <InboxReportPanel
        report={full}
        mailboxEmail="a@example.com"
        resetDate="Nov 1"
        onDismiss={() => {}}
        onReopen={() => {}}
        onFixConfirmed={onFixConfirmed}
      />,
    );
    expect(screen.getByText('91%')).toBeInTheDocument();
    expect(
      screen.getByText(
        'of the email you got in the last 90 days came from 2 senders you mostly leave unread.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/91%/).length).toBe(1);
    expect(screen.getByText('Last 90 days')).toBeInTheDocument();
    expect(screen.getByText('Based on 1,139 emails in a@example.com')).toBeInTheDocument();
    expect(screen.getByText('Sizes are Gmail’s estimates.')).toBeInTheDocument();
    expect(screen.getByText('about 9 in 10')).toBeInTheDocument();
    expect(document.querySelector('.dm-report-grid')).not.toBeNull();
    expect(document.querySelector('.dm-report-rule')).not.toBeNull();
    expect(document.querySelectorAll('[data-report-glyphs] svg')).toHaveLength(10);
    expect(screen.queryByRole('button', { name: 'Make a share card' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + archive 2 senders' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Unsubscribe from 2 senders and archive 10 emails?',
    );
    expect(onFixConfirmed).not.toHaveBeenCalled();
  });

  it('keeps Archive disabled until the live preview count resolves', async () => {
    let releasePreview: (response: Response) => void = () => {};
    const preview = new Promise<Response>((resolve) => {
      releasePreview = resolve;
    });
    installFetchStub([
      {
        method: 'POST',
        path: '/api/actions/preview/bulk',
        respond: () => preview,
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <InboxReportPanel report={full} mailboxId="mb-1" onDismiss={() => {}} onReopen={() => {}} />
      </QueryWrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + archive 2 senders' }));
    const archive = screen.getByRole('radio', { name: 'Unsubscribe and archive, counting emails' });
    expect(archive).toBeDisabled();
    expect(
      screen.getByRole('radio', { name: 'Unsubscribe and delete, counting emails' }),
    ).toBeDisabled();
    expect(screen.getByRole('dialog')).not.toHaveTextContent('archive 10 emails');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Archive 0');
    expect(screen.getByRole('dialog')).toHaveTextContent(WS5_COPY['f1.preview.backlog.loading']);
    expect(screen.getByRole('dialog')).not.toHaveTextContent('0 emails you already have');
    releasePreview(
      jsonOk({
        data: {
          senders: [
            {
              senderId: 's1',
              name: 'One',
              protected: false,
              counts: {
                all: 3,
                olderThan30d: 0,
                olderThan90d: 0,
                olderThan180d: 0,
                olderThan365d: 0,
              },
            },
            {
              senderId: 's2',
              name: 'Two',
              protected: false,
              counts: {
                all: 4,
                olderThan30d: 0,
                olderThan90d: 0,
                olderThan180d: 0,
                olderThan365d: 0,
              },
            },
          ],
          totals: { all: 7, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
          protectedCount: 0,
        },
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Unsubscribe and archive 7 emails' })).toBeEnabled(),
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Unsubscribe from 2 senders and archive 7 emails?',
    );
    expect(screen.getByRole('radio', { name: 'Unsubscribe and archive 7 emails' })).toBeChecked();
  });

  it('uses the calm fallback without a fix, a share card, or a celebration', () => {
    render(
      <InboxReportPanel
        report={calm}
        onDismiss={() => {}}
        onReopen={() => {}}
        celebration={{ archived: 4, senders: 1 }}
      />,
    );
    expect(screen.getByText(/nothing stands out yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unsubscribe/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make a share card' })).toBeNull();
    expect(screen.queryByText(/Archived/)).toBeNull();
  });

  it('states the archive result without a size', () => {
    render(
      <InboxReportPanel
        report={full}
        resetDate="Nov 1"
        onDismiss={() => {}}
        onReopen={() => {}}
        celebration={{ archived: 10, senders: 2 }}
      />,
    );
    const note = screen.getByText('Archived 10 emails from 2 senders.');
    expect(document.querySelector('[data-report-check] svg')).not.toBeNull();
    expect(note.closest('[data-celebration]')?.textContent ?? '').not.toMatch(
      /\d+(\.\d+)? (MB|GB)/,
    );
    expect(screen.queryByRole('button', { name: 'Unsubscribe + archive 2 senders' })).toBeNull();
    expect(screen.getByText(/your storage doesn’t change/)).toBeInTheDocument();
    expect(screen.getByText(/Unsubscribe stays free and unlimited/)).toBeInTheDocument();
  });

  it('groups a large archive result', () => {
    render(
      <InboxReportPanel
        report={full}
        onDismiss={() => {}}
        onReopen={() => {}}
        celebration={{ archived: 1139, senders: 12 }}
      />,
    );
    expect(screen.getByText('Archived 1,139 emails from 12 senders.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unsubscribe \+ archive/ })).toBeNull();
  });

  it('says a Delete moved mail to Trash and does not say it was archived', () => {
    const { rerender } = render(
      <InboxReportPanel
        report={full}
        onDismiss={() => {}}
        onReopen={() => {}}
        celebration={{ archived: 4, senders: 1, verb: 'delete' }}
      />,
    );
    expect(screen.queryByText(/Archived/)).toBeNull();
    expect(screen.queryByText(/Moved/)).toBeNull();
    expect(screen.queryByText(WS5_COPY['report.celebrate.delete.note'])).toBeNull();
    expect(screen.queryByText(/your storage doesn’t change/)).toBeNull();
    rerender(
      <InboxReportPanel
        report={full}
        onDismiss={() => {}}
        onReopen={() => {}}
        celebration={{ archived: 4, senders: 1, verb: 'delete', bytes: 1_500_000 }}
      />,
    );
    expect(screen.getByText('Moved 4 emails (about 1.5 MB) to Gmail Trash.')).toBeInTheDocument();
    expect(screen.getByText(WS5_COPY['report.celebrate.delete.note'])).toBeInTheDocument();
    expect(screen.queryByText(/Archived/)).toBeNull();
    expect(screen.queryByText(/your storage doesn’t change/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Undo restores/ })).toBeNull();
  });

  it('replaces the previous done state', () => {
    const { rerender } = render(
      <InboxReportPanel
        report={full}
        onDismiss={() => {}}
        onReopen={() => {}}
        celebration={{ archived: 10, senders: 2, verb: 'archive' }}
      />,
    );
    expect(screen.getByText('Archived 10 emails from 2 senders.')).toBeInTheDocument();
    rerender(
      <InboxReportPanel
        report={full}
        onDismiss={() => {}}
        onReopen={() => {}}
        celebration={{ archived: 4, senders: 1, verb: 'delete', bytes: 1_500_000 }}
      />,
    );
    expect(screen.queryByText('Archived 10 emails from 2 senders.')).toBeNull();
    expect(screen.getByText('Moved 4 emails (about 1.5 MB) to Gmail Trash.')).toBeInTheDocument();
  });

  it('turns the Undo sentence into a button when an Activity token exists', () => {
    const onUndo = vi.fn();
    render(
      <InboxReportPanel
        report={full}
        onDismiss={() => {}}
        onReopen={() => {}}
        celebration={{ archived: 10, senders: 2, verb: 'archive' }}
        undoToken="undo-1"
        onUndo={onUndo}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: WS5_COPY['report.celebrate.undo'] }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it('uses the loaded sender name for a one-sender fix title', () => {
    render(
      <InboxReportPanel
        report={{ ...full, fix: { senderKeys: ['s1'], sendersCount: 1, inboxEmailCount: 4 } }}
        senderNames={{ s1: { name: 'Acme' } }}
        onDismiss={() => {}}
        onReopen={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + archive 1 sender' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Unsubscribe from Acme and archive 4 emails?',
    );
    expect(screen.getByRole('dialog')).not.toHaveTextContent('1 senders');
  });

  it('states the unsubscribe requests and the emails still to send', () => {
    const { rerender } = render(
      <InboxReportPanel
        report={full}
        onDismiss={() => {}}
        onReopen={() => {}}
        celebration={{ archived: 0, senders: 1, verb: 'unsub_only', requested: 1, manual: 1 }}
      />,
    );
    expect(
      screen.getByText('Unsubscribe requested from 1 sender · 1 needs you to send an email'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unsubscribe \+ archive/ })).toBeNull();
    expect(screen.queryByText(/Undo restores/)).toBeNull();
    rerender(
      <InboxReportPanel
        report={full}
        onDismiss={() => {}}
        onReopen={() => {}}
        celebration={{ archived: 0, senders: 3, verb: 'unsub_only', requested: 2, manual: 3 }}
      />,
    );
    expect(
      screen.getByText('Unsubscribe requested from 2 senders · 3 need you to send an email'),
    ).toBeInTheDocument();
  });

  it('marks the primary action and keeps the review link inside the report card', () => {
    render(
      <InboxReportPanel
        report={full}
        mailboxEmail="a@example.com"
        onDismiss={() => {}}
        onReopen={() => {}}
      />,
    );
    const report = document.querySelector('.dm-report');
    const fix = screen.getByRole('button', { name: 'Unsubscribe + archive 2 senders' });
    const review = screen.getByRole('link', { name: 'Review them first' });
    expect(report).not.toBeNull();
    expect(fix).toHaveAttribute('data-report-fix');
    expect(report).toContainElement(fix);
    expect(report).toContainElement(review);
    expect(review).toHaveAttribute('href', '/senders?fix=s1,s2');
  });

  it('collapses to the reopen strip', () => {
    const onReopen = vi.fn();
    render(<InboxReportPanel report={full} dismissed onDismiss={() => {}} onReopen={onReopen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(onReopen).toHaveBeenCalledOnce();
  });
});

describe('InboxReportCard', () => {
  it('makes only the home action a link', () => {
    render(<InboxReportCard surface="home" mailboxId="mb" />);
    const card = document.querySelector('[data-surface="home"]');
    expect(card).toHaveAttribute('data-mailbox', 'mb');
    expect(card?.tagName).toBe('DIV');
    const action = screen.getByRole('link', { name: 'Open report' });
    expect(action).toHaveAttribute('href', '/senders');
    expect(action).toHaveAttribute('data-dm-button', '');
    expect(action).toHaveClass('dm-home-report-cta', 'dm-button-link');
    expect(
      screen.getByRole('heading', { name: WS5_COPY['report.home.title'] }),
    ).toBeInTheDocument();
    expect(card).toContainElement(screen.getByText(WS5_COPY['report.home.title']));
    expect(card).toContainElement(screen.getByText(WS5_COPY['report.home.body']));
    expect(action.textContent).toBe(WS5_COPY['report.home.cta']);
  });
});
