import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WS5_COPY } from '@declutrmail/shared/copy/launch';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

import { installFetchStub, jsonNotFound, jsonOk, resetFetchStub } from '@/test/fetch-stub';
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
  it('leads with a short dated summary and sender review, with data and cleanup collapsed', async () => {
    const review = vi.fn();
    const confirm = vi.fn();
    render(
      <InboxReportPanel
        report={full}
        mailboxEmail="a@example.test"
        onDismiss={vi.fn()}
        onReopen={vi.fn()}
        onReview={review}
        onFixConfirmed={confirm}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Inbox snapshot' })).toBeVisible();
    expect(screen.getByText('2 senders worth reviewing.')).toBeVisible();
    await waitFor(() =>
      expect(document.querySelector('time')).toHaveAttribute('dateTime', full.generatedAt),
    );
    const details = document.querySelector('details')!;
    expect(details).not.toHaveAttribute('open');
    expect(details).toContainElement(screen.getByRole('button', { name: 'Preview bulk cleanup' }));
    expect(screen.queryByText('91%')).toBeNull();
    expect(document.querySelector('[data-report-glyphs]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review senders' }));
    expect(review).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByText('Details'));
    expect(details).toHaveAttribute('open');
    expect(screen.getByText('Last 90 days')).toBeVisible();
    expect(screen.getByText('All scanned email')).toBeVisible();
    expect(screen.getByText(/1,139 scanned emails/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Preview bulk cleanup' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(confirm).not.toHaveBeenCalled();
  });
  it('keeps recent, historical and Trash scopes in Details', () => {
    render(
      <InboxReportPanel
        report={{
          ...full,
          insights: [
            { id: 'years_deep', oldestYear: 2012, olderPct: 70 },
            full.insights[0]!,
            { id: 'trash_bytes', bytes: 300_000_000, count: 80 },
          ],
        }}
        onDismiss={vi.fn()}
        onReopen={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Details'));
    expect(screen.getByText('All scanned email')).toBeVisible();
    expect(screen.getByText('Last 90 days')).toBeVisible();
    expect(screen.getByText('In Gmail Trash at snapshot time')).toBeVisible();
  });
  it('uses the actual capped sender set in fallback and keeps review primary', () => {
    const review = vi.fn();
    render(
      <InboxReportPanel
        report={{ ...full, variant: 'fallback', fallbackSenderCount: 72 }}
        onReview={review}
        onDismiss={vi.fn()}
        onReopen={vi.fn()}
      />,
    );
    expect(screen.getByText('2 senders worth reviewing.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review senders' }));
    expect(review).toHaveBeenCalledOnce();
    expect(screen.queryByText(/72 senders|good shape/)).toBeNull();
  });
  it('keeps an empty snapshot neutral without a same-page review link', () => {
    render(<InboxReportPanel report={calm} onDismiss={vi.fn()} onReopen={vi.fn()} />);
    expect(screen.getByText(/No sender suggestions/)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Review senders' })).toBeNull();
    fireEvent.click(screen.getByText('Details'));
    expect(screen.queryByRole('button', { name: 'Preview bulk cleanup' })).toBeNull();
    expect(screen.queryByText(/good shape|Archived/)).toBeNull();
  });

  it('keeps a single qualifying fallback insight available in Details', () => {
    render(
      <InboxReportPanel
        report={{ ...calm, insights: [{ id: 'trash_bytes', bytes: 300_000_000, count: 80 }] }}
        onDismiss={vi.fn()}
        onReopen={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Details'));
    expect(screen.getByText('In Gmail Trash at snapshot time')).toBeVisible();
  });
  it('collapses to the reopen strip', () => {
    const reopen = vi.fn();
    render(<InboxReportPanel report={full} dismissed onDismiss={vi.fn()} onReopen={reopen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(reopen).toHaveBeenCalledOnce();
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
        <InboxReportPanel
          report={full}
          mailboxId="mb-1"
          onDismiss={() => {}}
          onReopen={() => {}}
          onFixConfirmed={vi.fn()}
        />
      </QueryWrapper>,
    );
    fireEvent.click(screen.getByText('Details'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview bulk cleanup' }));
    const archive = screen.getByRole('radio', { name: '+ Archive' });
    expect(archive).toBeDisabled();
    expect(screen.getByRole('radio', { name: '+ Delete' })).toBeDisabled();
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
    await waitFor(() => expect(screen.getByRole('radio', { name: '+ Archive' })).toBeEnabled());
    expect(screen.getByRole('dialog')).toHaveTextContent('Unsubscribe from 2 senders?');
    expect(screen.getByRole('radio', { name: '+ Archive' })).toBeChecked();
  });
});

describe('InboxReportCard', () => {
  it('makes only the home action a link', () => {
    render(<InboxReportCard surface="home" mailboxId="mb" />);
    const card = document.querySelector('[data-surface="home"]');
    expect(card).toHaveAttribute('data-mailbox', 'mb');
    expect(card?.tagName).toBe('DIV');
    const action = screen.getByRole('link', { name: 'Open report' });
    expect(action).toHaveAttribute('href', '/senders#inbox-report');
    expect(action).not.toHaveAttribute('data-dm-button');
    expect(action).toHaveClass('dm-home-report-cta', 'dm-external-link', 'dm-tap-target');
    expect(action).not.toHaveClass('dm-button-link');
    expect(
      screen.getByRole('heading', { name: WS5_COPY['report.home.title'] }),
    ).toBeInTheDocument();
    expect(card).toContainElement(screen.getByText(WS5_COPY['report.home.title']));
    expect(card).toContainElement(screen.getByText(WS5_COPY['report.home.body']));
    expect(action.textContent).toBe(WS5_COPY['report.home.cta']);
  });

  it('puts a lead at the top of the card and outside the link', () => {
    render(<InboxReportCard surface="home" mailboxId="mb" lead={<p>91%</p>} />);
    const lead = screen.getByText('91%');
    const card = document.querySelector('[data-surface="home"]');
    const title = screen.getByRole('heading', { name: WS5_COPY['report.home.title'] });
    expect(card).toContainElement(lead);
    expect(lead.closest('a')).toBeNull();
    expect(lead.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe('Inbox Report action preview recovery', () => {
  it('keeps the compact dismissed report entry wired to the existing reopen owner', () => {
    const onReopen = vi.fn();
    const view = render(
      <InboxReportPanel report={full} compact dismissed onDismiss={() => {}} onReopen={onReopen} />,
    );
    const report = screen.getByRole('region', { name: 'Your Inbox Report' });
    expect(report).toHaveAttribute('data-compact', 'true');
    fireEvent.click(report.querySelector('button')!);
    expect(onReopen).toHaveBeenCalledTimes(1);
    view.rerender(
      <InboxReportPanel report={full} compact onDismiss={() => {}} onReopen={onReopen} />,
    );
    expect(screen.getByRole('button', { name: 'Close Inbox Report' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Your Inbox Report' })).not.toHaveAttribute(
      'data-compact',
    );
  });
  it('blocks a disappeared sender and offers a working route to review senders', async () => {
    const onFixConfirmed = vi.fn();
    installFetchStub([
      {
        method: 'GET',
        path: '/api/actions/preview',
        respond: () => jsonNotFound('SENDER_NOT_FOUND'),
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <InboxReportPanel
          report={{ ...full, fix: { senderKeys: ['gone'], sendersCount: 1, inboxEmailCount: 4 } }}
          mailboxId="mb-1"
          mailboxEmail="report@synthetic.test"
          onDismiss={vi.fn()}
          onReopen={vi.fn()}
          onFixConfirmed={onFixConfirmed}
        />
      </QueryWrapper>,
    );
    fireEvent.click(screen.getByText('Details'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview bulk cleanup' }));
    expect((await screen.findAllByRole('link', { name: 'Review senders' })).at(-1)).toHaveAttribute(
      'href',
      '/senders',
    );
    expect(
      screen.getByRole('note', { name: 'Gmail account: report@synthetic.test' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('radio', { name: 'Unsubscribe only' }));
    expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(onFixConfirmed).not.toHaveBeenCalled();
  });

  it('does not confirm a second fix while the first is still pending', () => {
    const onFixConfirmed = vi.fn();
    const { rerender } = render(
      <InboxReportPanel
        report={full}
        onDismiss={vi.fn()}
        onReopen={vi.fn()}
        onFixConfirmed={onFixConfirmed}
      />,
    );
    fireEvent.click(screen.getByText('Details'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview bulk cleanup' }));
    const confirm = screen.getByRole('button', { name: 'Unsubscribe + Archive' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onFixConfirmed).toHaveBeenCalledTimes(1);
    expect(onFixConfirmed).toHaveBeenCalledWith('archive', undefined, ['s1', 's2'], undefined);
    rerender(
      <InboxReportPanel
        report={full}
        fixPending
        onDismiss={vi.fn()}
        onReopen={vi.fn()}
        onFixConfirmed={onFixConfirmed}
      />,
    );
    expect(screen.getByRole('button', { name: 'Preview bulk cleanup' })).toBeDisabled();
  });
});
