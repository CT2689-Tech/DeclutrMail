import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { installFetchStub, jsonOk } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';

const cardGate = vi.hoisted(() => ({ shape: 'none' as 'none' | 'anchor' | 'shell' }));

vi.mock('@/features/inbox-report', () => ({
  InboxReportCard: (props: { mailboxId: string; lead?: ReactNode }) => {
    if (cardGate.shape === 'anchor') {
      return (
        <>
          {props.lead}
          <a href="/senders" data-mailbox={props.mailboxId}>
            <strong>Your Inbox Report</strong>
            <span>
              A quick look at who sends you the most, what you leave unread and what takes up space.
            </span>
            <span>Open report</span>
          </a>
        </>
      );
    }
    if (cardGate.shape === 'shell') {
      return (
        <div data-surface="home" data-mailbox={props.mailboxId}>
          {props.lead}
          <h2 className="dm-home-report-title">Your Inbox Report</h2>
          <span className="dm-home-report-body">
            A quick look at who sends you the most, what you leave unread and what takes up space.
          </span>
          <a className="dm-home-report-cta dm-button-link" href="/senders">
            Open report
          </a>
        </div>
      );
    }
    return <>{props.lead}</>;
  },
  getFixSet: (report: {
    fix: { senderKeys: readonly string[]; sendersCount: number; inboxEmailCount: number };
  }) => ({
    senderKeys: [...report.fix.senderKeys],
    sendersCount: report.fix.sendersCount,
    inboxEmailCount: report.fix.inboxEmailCount,
  }),
}));

import { failedScanSettingsStep } from '@/features/mailboxes/mailbox-health';
import { ApiError } from '@/lib/api/client';

import { HOME_DECK, fillDeck } from './home-deck-copy';
import { homeCalmTemplate, homeReportCopy, homeTileCopy } from './home-ws5-copy';
import { homePreviewReport } from './home-preview-report';
import type { HomeFixCandidate } from './home-next-steps';
import { HomePreview } from './home-preview';
import { HomeView } from './home-view';

const action = { label: 'Review senders', href: '/senders' };

const ready = {
  kind: 'ready' as const,
  hero: { label: 'emails cleared', value: 1234 },
  since: '2026-03-15T12:00:00.000Z',
  secondary: [
    { label: 'Emails archived', value: 1200 },
    { label: 'Emails deleted', value: 34 },
  ],
  action,
};

const unsub: HomeFixCandidate = {
  kind: 'unsub_archive',
  senderCount: 158,
  emailCount: 1200,
  senderIds: ['s1'],
};

const largest: HomeFixCandidate = {
  kind: 'largest',
  senderCount: 10,
  sizeLabel: '2.1 GB',
  senderIds: ['s2'],
};

const later: HomeFixCandidate = {
  kind: 'later_due',
  senderCount: 3,
  senderIds: ['s3'],
};

const metered = {
  metered: true,
  limit: 1000,
  used: 360,
  remaining: 640,
  resetAt: '2026-11-01T00:00:00.000Z',
};

describe('HomeView', () => {
  it('formats the progress month in an explicit timezone on either side of hydration', () => {
    const state = {
      ...ready,
      hero: { label: 'emails cleared', value: 12 },
      since: '2026-01-01T00:00:00.000Z',
    };
    const { rerender } = render(<HomeView state={state} />);
    expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent(
      'emails cleared since Jan 2026',
    );
    rerender(<HomeView state={state} timeZone="America/Los_Angeles" />);
    expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent(
      'emails cleared since Dec 2025',
    );
  });

  it('uses Home as the only H1 and links Compare plans to billing', () => {
    render(<HomeView state={ready} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Home');
    expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute(
      'href',
      '/billing?from=%2Fhome',
    );
    expect(screen.queryByRole('link', { name: /\/pricing/ })).toBeNull();
    expect(document.body.innerHTML).not.toContain('/pricing');
  });

  it('keeps recorded progress and activity, and does not promote Pro', () => {
    render(<HomeView state={ready} tier="plus" />);
    expect(screen.getByTestId('home-hero')).toHaveTextContent('1,234');
    expect(screen.getByRole('region', { name: 'Progress' }).querySelector('dl')).toBeNull();
    expect(screen.queryByText('Emails archived')).toBeNull();
    expect(screen.getByRole('link', { name: 'See your activity' })).toHaveAttribute(
      'href',
      '/activity',
    );
    expect(screen.queryByRole('link', { name: /Autopilot/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Daily brief/ })).toBeNull();
    expect(screen.queryByText(/Included with/)).toBeNull();
    expect(screen.queryByText('A little room')).toBeNull();
    expect(screen.queryByText('Review 8 today')).toBeNull();
  });

  it('renders the chip from server meter fields', () => {
    render(<HomeView state={ready} summary={metered} timeZone="UTC" />);
    expect(
      screen.getByLabelText('640 of 1,000 free emails left this month. Resets Nov 1.'),
    ).toHaveTextContent('640 of 1,000 free emails left · resets Nov 1');
  });

  it('hides the chip when the server says the workspace is not metered', () => {
    render(<HomeView state={ready} summary={{ ...metered, metered: false }} timeZone="UTC" />);
    expect(screen.queryByText(/free emails left/)).toBeNull();
  });

  it('ranks a primary unsubscribe step and keeps F2 off the page', () => {
    render(
      <HomeView
        state={ready}
        nextSteps={[later, largest, unsub]}
        senderSizeView={false}
        reportSizeLabel="7.7 GB"
      />,
    );
    expect(screen.getByRole('region', { name: 'Suggested next steps' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unsubscribe/ })).toBeNull();
    expect(screen.queryByText(/of these senders/)).toBeNull();
    const laterLink = screen.getByRole('link', { name: HOME_DECK.laterCta });
    const laterCard = laterLink.closest('article');
    expect(laterLink).toHaveAttribute('href', '/later');
    expect(laterCard).not.toBeNull();
    expect(laterCard?.querySelector('h3')).toHaveTextContent(HOME_DECK.laterTitle);
    expect(laterCard).toHaveTextContent(HOME_DECK.laterBody);
    expect(laterCard).not.toHaveTextContent('3');
    expect(laterCard).not.toHaveTextContent(/sender/);
    expect(screen.queryByRole('link', { name: 'Later' })).toBeNull();
    expect(laterCard?.querySelector('h3')?.contains(laterLink)).toBe(false);
    expect(laterCard?.querySelector('svg')).not.toBeNull();
    expect(screen.queryByText('Your 10 largest senders')).toBeNull();
    expect(screen.queryByRole('link', { name: 'See largest senders' })).toBeNull();
    if (homeTileCopy() === null) {
      expect(screen.queryByText('≈ 7.7 GB')).toBeNull();
      expect(screen.queryByText('of email in your Gmail')).toBeNull();
    }
    expect(document.querySelector('[data-home-mode="full"]')).not.toBeNull();
    expect(document.querySelector('[data-sender-size-view="off"]')).not.toBeNull();
  });

  it('preview full state shows the fixture report and a count-free Later card', async () => {
    render(
      <HomeView
        state={ready}
        nextSteps={[later, unsub]}
        mailboxId="mb-preview"
        previewReport={homePreviewReport('full')}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Your Inbox Report' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open report' })).toHaveAttribute('href', '/senders');
    expect(screen.getByText('91%')).toBeInTheDocument();
    expect(screen.getByText(/195 senders you mostly leave unread/)).toBeInTheDocument();
    expect(screen.getByText(/Each of those 195 senders had less than 10%/)).toBeInTheDocument();
    expect(screen.queryByText(/Each had less than 10%/)).toBeNull();
    expect(screen.queryByText(/It had less than 10%/)).toBeNull();
    expect(homePreviewReport('full')?.fix.supportOne).toMatch(/^That sender had less than 10%/);
    expect(screen.getByText('≈ 7.7 GB')).toBeInTheDocument();
    expect(screen.getByText(/We never fetch or store full email contents/)).toBeInTheDocument();
    const unsubscribe = screen.getByRole('button', { name: 'Unsubscribe + archive 158 senders' });
    const tile = screen.getByText('≈ 7.7 GB');
    expect(unsubscribe.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    fireEvent.click(unsubscribe);
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Unsubscribe from 158 senders and archive 1,200 emails?',
    );
    const laterCard = screen.getByRole('link', { name: 'Open Later' }).closest('article');
    expect(laterCard).toHaveTextContent(HOME_DECK.laterBody);
    expect(laterCard).not.toHaveTextContent('3');
    expect(homePreviewReport('caught-up')?.calm).toMatch(/47 emails/);
    expect(homePreviewReport('syncing')).toBeNull();
    expect(homePreviewReport('empty')).toBeNull();
  });

  it('reserves the narrow page inset so the primary action stays above the tab bar', () => {
    const narrow = (css: string) => css.slice(css.lastIndexOf('@media (max-width: 760px)'));
    const dir = dirname(fileURLToPath(import.meta.url));
    const home = narrow(readFileSync(join(dir, 'home-view.module.css'), 'utf8'));
    const card = narrow(readFileSync(join(dir, '../inbox-report/card.module.css'), 'utf8'));
    expect(home).toContain('padding: 12px 16px var(--dm-tabbar-inset)');
    expect(home).toContain('min-height: 28px');
    expect(home).toMatch(/\.fixActions\s*\{[^}]*margin-top:\s*8px/);
    expect(home).toMatch(/\.arrivals\s*\{[^}]*padding:\s*6px 10px/);
    expect(home).toContain('.page:has(.arrivals) .header');
    expect(home).toContain('.page:has(.arrivals) .leadFigure');
    expect(card).toMatch(/\.card\s*\{[^}]*padding:\s*16px/);
    expect(card).toMatch(/\.body\s*\{[^}]*margin:\s*8px 0 12px/);
  });

  it('keeps the lead, size tile, and trust line when the home card link is present', async () => {
    cardGate.shape = 'anchor';
    render(
      <HomeView
        state={ready}
        nextSteps={[later, unsub]}
        mailboxId="mb-preview"
        previewReport={homePreviewReport('full')}
      />,
    );
    const lead = await screen.findByText('91%');
    expect(lead).toBeVisible();
    expect(screen.getByText(/195 senders you mostly leave unread/)).toBeVisible();
    expect(screen.getByText('≈ 7.7 GB')).toBeVisible();
    expect(screen.getByText(/We never fetch or store full email contents/)).toBeVisible();
    expect(document.querySelector('[data-report-facts]')).not.toHaveAttribute('hidden');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Your Inbox Report' })).toBeNull();
    });
    const card = document.querySelector('[data-home-report-card] > a');
    expect(card).not.toBeNull();
    expect(card?.querySelector('strong')).toHaveTextContent('Your Inbox Report');
    expect(card?.querySelectorAll('span')).toHaveLength(2);
    cardGate.shape = 'none';
  });

  it('keeps the lead, size tile, and trust line when the shipped home card is present', async () => {
    cardGate.shape = 'shell';
    render(
      <HomeView
        state={ready}
        nextSteps={[later, unsub]}
        mailboxId="mb-preview"
        previewReport={homePreviewReport('full')}
      />,
    );
    const lead = await screen.findByText('91%');
    const shell = lead.closest('[data-surface="home"]');
    expect(lead.closest('[data-report-lead]')).not.toBeNull();
    expect(lead.closest('[data-home-report-card]')).not.toBeNull();
    expect(lead.closest('a')).toBeNull();
    expect(lead.closest('[hidden]')).toBeNull();
    expect(shell).not.toBeNull();
    const title = shell?.querySelector('h2');
    expect(title).not.toBeNull();
    expect(lead.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText('≈ 7.7 GB').closest('[data-report-tile]')).not.toBeNull();
    expect(
      screen.getByText(/We never fetch or store full email contents/).closest('[hidden]'),
    ).toBeNull();
    expect(shell?.querySelector('h2')).toHaveTextContent('Your Inbox Report');
    expect(shell?.querySelector('.dm-home-report-body')).not.toBeNull();
    expect(shell?.querySelector('a')).toHaveTextContent('Open report');
    expect(shell?.querySelector('h2')?.textContent).not.toContain('Open report');
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: 'Open report' })).toHaveLength(1);
    });
    cardGate.shape = 'none';
  });

  it('shows the largest card only when the size view is on', () => {
    render(
      <HomeView
        state={ready}
        nextSteps={[unsub, largest]}
        senderSizeView
        reportSizeLabel="7.7 GB"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Your 10 largest senders' })).toBeInTheDocument();
    const largestBody = fillDeck(HOME_DECK.largestBody, { size: '2.1 GB' });
    expect(largestBody).not.toBeNull();
    expect(screen.getByText(largestBody ?? '')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See largest senders' })).toHaveAttribute(
      'href',
      '/senders',
    );
  });

  it('does not paint an unsubscribe step while the report deck is empty', () => {
    render(<HomeView state={ready} nextSteps={[unsub]} />);
    expect(screen.queryByRole('button', { name: /Unsubscribe/ })).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByText(/of these senders/)).toBeNull();
    expect(document.querySelector('[data-home-fix-expected="false"]')).not.toBeNull();
  });

  it('uses the calm fallback when nothing is suggested', () => {
    const { container } = render(
      <HomeView state={{ ...ready, secondary: [] }} nextSteps={[]} indexedEmailCount={47} />,
    );
    expect(container.firstElementChild).toHaveAttribute('data-home-mode', 'fallback');
    if (homeCalmTemplate() === null) {
      expect(screen.queryByTestId('home-calm')).toBeNull();
    } else {
      expect(screen.getByTestId('home-calm')).toHaveTextContent('47 emails');
    }
    expect(screen.queryByText(/share card/i)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Suggested next steps' })).toBeNull();
  });

  it('omits the calm count when the indexed total is unknown', () => {
    render(<HomeView state={ready} nextSteps={[]} indexedEmailCount={null} />);
    expect(screen.queryByTestId('home-calm')).toBeNull();
    if (homeReportCopy() === null) {
      expect(screen.queryByRole('heading', { name: 'Your Inbox Report' })).toBeNull();
    }
  });

  it('empty: no number, and a syncing mailbox does not say it is reading Gmail', () => {
    const { rerender } = render(<HomeView state={{ kind: 'empty', syncing: false, action }} />);
    expect(screen.queryByTestId('home-hero')).toBeNull();
    expect(screen.getByText('Nothing cleared yet.')).toBeInTheDocument();
    expect(screen.getByText(HOME_DECK.emptyBody)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review senders' })).toHaveAttribute(
      'href',
      '/senders',
    );
    rerender(<HomeView state={{ kind: 'empty', syncing: true, action }} />);
    expect(screen.getByRole('heading', { name: HOME_DECK.syncingTitle })).toBeInTheDocument();
    expect(screen.getByText(HOME_DECK.syncingBody)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Reading your Gmail…' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Review senders' })).toBeNull();
    expect(screen.queryByText('Nothing cleared yet.')).toBeNull();
    if (homeReportCopy() === null) {
      expect(screen.queryByRole('heading', { name: 'Your Inbox Report' })).toBeNull();
    }
    expect(screen.queryByText('Your scan is waiting to start.')).toBeNull();
    expect(screen.queryByText('Waiting to start.')).toBeNull();
    expect(screen.getByTestId('home-scan-bar')).toBeInTheDocument();
  });

  it('syncing: a known stage replaces the leave line and is not the queued sentence', () => {
    render(
      <HomeView
        state={{
          kind: 'empty',
          syncing: true,
          action,
          stageSentence: HOME_DECK.syncingStage.fetching_metadata,
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: HOME_DECK.syncingTitle })).toBeInTheDocument();
    expect(screen.getByText('Finding your senders.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review senders' })).toBeNull();
    expect(screen.queryByText(HOME_DECK.syncingBody)).toBeNull();
    expect(screen.queryByText('Waiting to start.')).toBeNull();
  });

  it('queued: uses the waiting title and does not say progress is saved', () => {
    render(<HomeView state={{ kind: 'empty', syncing: true, queued: true, action }} />);
    expect(screen.getByRole('heading', { name: HOME_DECK.queuedTitle })).toBeInTheDocument();
    expect(screen.getByText(HOME_DECK.queuedBody)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review senders' })).toBeNull();
    expect(screen.queryByText(/Your progress is saved/)).toBeNull();
    expect(screen.queryByText('Nothing cleared yet.')).toBeNull();
    expect(screen.queryByRole('heading', { name: HOME_DECK.syncingTitle })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Reading your Gmail…' })).toBeNull();
  });

  it('does not use Review today as the empty primary action', () => {
    render(
      <HomeView
        state={{
          kind: 'empty',
          syncing: false,
          action: { label: 'Review 2 today', href: '/triage' },
        }}
      />,
    );
    expect(screen.queryByRole('link', { name: /Review 2 today/ })).toBeNull();
  });

  it('sync-failed: says the scan stopped and offers retry and help', () => {
    render(<HomeView state={{ kind: 'sync-failed', needsReconnect: false }} />);
    expect(screen.getByRole('heading', { name: HOME_DECK.failedTitle })).toBeInTheDocument();
    expect(screen.getByText(HOME_DECK.failedBody)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: HOME_DECK.failedRetry })).toBeEnabled();
    expect(screen.getByRole('link', { name: HOME_DECK.failedHelp })).toHaveAttribute(
      'href',
      '/help',
    );
    expect(screen.queryByText('Gmail scan failed.')).toBeNull();
    expect(screen.queryByText('Nothing cleared yet.')).toBeNull();
    expect(screen.queryByTestId('home-hero')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Settings' })).toBeNull();
  });

  it('sync-failed reconnect without a mailbox still points at Gmail accounts', () => {
    render(<HomeView state={{ kind: 'sync-failed', needsReconnect: true }} />);
    expect(screen.getByRole('heading', { name: HOME_DECK.failedTitle })).toBeInTheDocument();
    expect(screen.getByText(failedScanSettingsStep(true))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
      'href',
      '/settings#mailboxes',
    );
  });

  it('loading: a labelled skeleton and no link', () => {
    render(<HomeView state={{ kind: 'loading' }} />);
    expect(screen.getByRole('status', { name: 'Loading Home' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('error: names the cause and retries', () => {
    const retry = vi.fn();
    render(<HomeView state={{ kind: 'error', error: new ApiError(500, null, 'boom'), retry }} />);
    expect(screen.getByText(/couldn't load Home/)).toBeInTheDocument();
    expect(screen.getByText(/server returned an error/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('Home preview failed fixture', () => {
  it('names a mailbox so Try again restarts that scan', async () => {
    const mailboxes: string[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: '/api/v1/sync/initial/retry',
        respond: (req) => {
          mailboxes.push(req.headers.get('X-Active-Mailbox-Id') ?? '');
          return jsonOk({ data: { outcome: 'requeued' } });
        },
      },
    ]);
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <HomePreview state="failed" />
      </QueryClientProvider>,
    );
    expect(screen.getByText(HOME_DECK.failedBody)).toBeInTheDocument();
    expect(screen.queryByText('We couldn’t load scan recovery')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: HOME_DECK.failedRetry }));
    await waitFor(() => expect(mailboxes).toEqual(['mb-preview']));
    expect(screen.getByText(HOME_DECK.failedBody)).toBeInTheDocument();
  });
});
