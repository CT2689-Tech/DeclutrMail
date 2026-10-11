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
  receivedCount: 40,
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
    expect(
      screen.getByText(
        '91% of the email you got in the last 90 days came from 2 senders you mostly leave unread.',
      ),
    ).toBeInTheDocument();
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
    const archive = screen.getByRole('radio', { name: 'Unsubscribe and archive' });
    expect(archive).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Unsubscribe and delete' })).toBeDisabled();
    expect(screen.getByRole('dialog')).not.toHaveTextContent('archive 10 emails');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Archive 0');
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
    expect(note.closest('[data-celebration]')?.textContent ?? '').not.toMatch(
      /\d+(\.\d+)? (MB|GB)/,
    );
    expect(screen.getByText(/your storage doesn’t change/)).toBeInTheDocument();
    expect(screen.getByText(/Unsubscribe stays free and unlimited/)).toBeInTheDocument();
  });

  it('collapses to the reopen strip', () => {
    const onReopen = vi.fn();
    render(<InboxReportPanel report={full} dismissed onDismiss={() => {}} onReopen={onReopen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(onReopen).toHaveBeenCalledOnce();
  });
});

describe('InboxReportCard', () => {
  it('lays the home surface out as a title, a body, and a separate action', () => {
    render(<InboxReportCard surface="home" mailboxId="mb" />);
    const title = screen.getByRole('heading', { name: WS5_COPY['report.home.title'] });
    const body = screen.getByText(WS5_COPY['report.home.body']);
    const action = screen.getByRole('link', { name: WS5_COPY['report.home.cta'] });
    const card = title.closest('section');

    expect(card).toHaveAttribute('data-surface', 'home');
    expect(card).toHaveAttribute('data-mailbox', 'mb');
    expect(card).toContainElement(body);
    expect(action).toHaveAttribute('href', '/senders');
    expect(action).toHaveTextContent(WS5_COPY['report.home.cta']);
    expect(title.closest('a')).toBeNull();
    expect(body.closest('a')).toBeNull();
    expect(action).not.toContainElement(title);
    expect(action).not.toContainElement(body);
  });
});
