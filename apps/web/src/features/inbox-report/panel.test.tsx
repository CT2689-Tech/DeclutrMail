import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

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
  it('returns nothing when the report flag is off', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_INBOX_REPORT_ENABLED', 'false');
    vi.stubEnv('INBOX_REPORT_ENABLED', 'false');
    const { container } = render(<InboxReportCard surface="home" mailboxId="mb" />);
    expect(container).toBeEmptyDOMElement();
    vi.unstubAllEnvs();
  });
});
