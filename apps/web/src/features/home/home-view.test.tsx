import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { installFetchStub, jsonOk } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';

import { failedScanSettingsStep } from '@/features/mailboxes/mailbox-health';
import { ApiError } from '@/lib/api/client';

import { HOME_DECK, fillDeck } from './home-deck-copy';
import { homeCalmTemplate, homeReportCopy, homeTileCopy } from './home-ws5-copy';
import { homePreviewReport } from './home-preview-report';
import type { HomeFixCandidate } from './home-next-steps';
import { HomeRouteLoading } from './home-loading-shell';
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
  it('leads with one preview and discloses supporting context in Details', () => {
    render(
      <HomeView
        state={ready}
        nextSteps={[unsub, later]}
        mailboxEmail="selected@synthetic.test"
        previewReport={homePreviewReport('full')}
        summary={metered}
      />,
    );
    const details = screen.getByText('Details').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(
      screen.getByRole('heading', { name: '158 senders worth reviewing.' }).closest('details'),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview cleanup' }).closest('details')).toBeNull();
    for (const content of [
      screen.getByTestId('home-hero'),
      screen.getByText(/91% of the email/),
      screen.getByText(/≈ 7.7 GB/),
      screen.getByRole('link', { name: 'Open Later' }),
      screen.getByRole('link', { name: 'Review senders' }),
      screen.getByRole('link', { name: 'Compare plans' }),
    ]) {
      expect(content.closest('details')).toBe(details);
    }
    expect(document.querySelector('[data-home-impact]')?.closest('details')).toBeNull();
    expect(document.querySelectorAll('[data-home-impact]')).toHaveLength(1);
    expect(document.querySelectorAll('.dm-button-link')).toHaveLength(1);
    expect(screen.queryByText(HOME_DECK.focus.safety)).toBeNull();
    expect(screen.queryByText(HOME_DECK.focus.context)).toBeNull();
    expect(screen.queryByText(/A quick look at who sends/)).toBeNull();
    expect(screen.queryByText(/We never fetch or store/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Open report' })).toHaveAttribute(
      'href',
      '/senders#inbox-report',
    );
  });

  it('shows only actual suggested sender identities with one impact line and one primary action', () => {
    const senders = ['a', 'b', 'c', 'd'].map((id) => ({
      id,
      name: `Sender ${id}`,
      domain: `${id}.synthetic.test`,
    }));
    render(
      <HomeView state={ready} nextSteps={[{ ...unsub, senderIds: ['a', 'b', 'c'], senders }]} />,
    );
    const preview = screen.getByRole('list', { name: 'Some senders to review' });
    expect(preview.closest('details')).toBeNull();
    expect(preview.querySelectorAll('li')).toHaveLength(3);
    expect(preview).toHaveTextContent('Sender a');
    expect(preview).not.toHaveTextContent('Sender d');
    expect(preview.querySelectorAll('a,button')).toHaveLength(0);
    expect(document.querySelectorAll('[data-home-impact]')).toHaveLength(1);
    expect(document.querySelectorAll('.dm-button-link')).toHaveLength(1);
  });

  it('makes Open Later the single primary action when Later is the only recommendation', () => {
    render(<HomeView state={ready} nextSteps={[later]} />);
    const link = screen.getByRole('link', { name: 'Open Later' });
    expect(link).toHaveClass('dm-button-link');
    expect(link.closest('details')).toBeNull();
    expect(screen.queryByText(HOME_DECK.laterBody)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Review senders' })).toBeNull();
  });

  it.each([ready.since, null])('labels recorded progress as all time with since=%s', (since) => {
    render(<HomeView state={{ ...ready, since }} />);
    const progress = screen.getByRole('region', { name: 'Progress' });
    expect(progress).toHaveTextContent('All time');
    expect(progress.querySelector('time')).toBeNull();
  });

  it('uses Home as the only H1 and links Compare plans to billing', () => {
    render(<HomeView state={ready} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Home');
    expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute(
      'href',
      '/billing?from=%2Fhome',
    );
    expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveClass(
      'dm-external-link',
      'dm-tap-target',
    );
    expect(screen.queryByRole('link', { name: /\/pricing/ })).toBeNull();
    expect(document.body.innerHTML).not.toContain('/pricing');
  });

  it('keeps recorded progress and activity, and does not promote Pro', () => {
    render(<HomeView state={ready} tier="plus" />);
    expect(screen.getByTestId('home-hero')).toHaveTextContent('1,234');
    expect(screen.getByRole('region', { name: 'Progress' }).querySelector('dl')).not.toBeNull();
    expect(screen.getByText('Emails archived')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See your activity' })).toHaveAttribute(
      'href',
      '/activity?window=all',
    );
    expect(screen.getByRole('link', { name: 'See your activity' })).toHaveClass('dm-tap-target');
    expect(screen.queryByRole('link', { name: /Autopilot/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Daily brief/ })).toBeNull();
    expect(screen.queryByText(/Included with/)).toBeNull();
    expect(screen.queryByText('A little room')).toBeNull();
    expect(screen.queryByText('Review 8 today')).toBeNull();
  });

  it('shows the recommendation inbox count separately from recorded progress', () => {
    render(<HomeView state={ready} nextSteps={[unsub]} mailboxEmail="selected@synthetic.test" />);
    expect(screen.getByText('selected@synthetic.test')).toBeInTheDocument();
    expect(document.querySelector('[data-home-impact]')).toHaveTextContent(
      '1,200 emails in your inbox',
    );
    expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent('1,234');
    expect(screen.getByRole('button', { name: 'Preview cleanup' })).toBeInTheDocument();
  });

  it.each([undefined, 0, Number.NaN])(
    'offers sender review when a preview count is unavailable: %s',
    (emailCount) => {
      const step: HomeFixCandidate = { ...unsub };
      if (emailCount === undefined) delete step.emailCount;
      else step.emailCount = emailCount;
      render(<HomeView state={ready} nextSteps={[step]} />);
      expect(document.querySelector('[data-home-impact]')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Preview cleanup' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Review senders' })).toHaveAttribute(
        'href',
        '/senders',
      );
      expect(document.querySelector('[data-home-fix-expected="false"]')).not.toBeNull();
    },
  );

  it('offers the first cleanup before any recorded progress exists', () => {
    render(<HomeView state={{ kind: 'empty', syncing: false, action }} nextSteps={[unsub]} />);
    expect(screen.getByRole('button', { name: 'Preview cleanup' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent(
      HOME_DECK.emptyTitle,
    );
    expect(screen.queryByTestId('home-hero')).toBeNull();
  });

  it('renders the chip from server meter fields', () => {
    render(<HomeView state={ready} summary={metered} />);
    expect(
      screen.getByLabelText('640 of 1,000 free emails left this month. Resets Nov 1.'),
    ).toHaveTextContent('640 of 1,000 free emails left · resets Nov 1');
  });

  it('hides the chip when the server says the workspace is not metered', () => {
    render(<HomeView state={ready} summary={{ ...metered, metered: false }} />);
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
    expect(screen.getByRole('button', { name: 'Preview cleanup' })).toBeInTheDocument();
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

  it('uses one skeleton that matches the ready layout slots', () => {
    const { rerender } = render(<HomeView state={{ kind: 'loading' }} />);
    const slots = () =>
      [...document.querySelectorAll('[data-home-slot]')].map((el) =>
        el.getAttribute('data-home-slot'),
      );
    expect(slots()).toEqual(['quota', 'primary', 'details']);
    rerender(
      <HomeView
        state={ready}
        nextSteps={[unsub, later]}
        mailboxId="mb-preview"
        previewReport={homePreviewReport('full')}
      />,
    );
    expect(slots()).toEqual(['quota', 'primary', 'details', 'visit', 'report', 'plan']);
  });

  it('keeps the route loading shell on the same slots without mounting HomeView', () => {
    const { container } = render(<HomeRouteLoading />);
    expect(container.querySelector('[data-home-mode="loading"]')).not.toBeNull();
    expect(
      [...container.querySelectorAll('[data-home-slot]')].map((el) =>
        el.getAttribute('data-home-slot'),
      ),
    ).toEqual(['quota', 'primary', 'details']);
    expect(container.querySelector('[data-home-skeleton]')).not.toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('uses the calm fallback when nothing is suggested', () => {
    const { container } = render(
      <HomeView state={{ ...ready, secondary: [] }} nextSteps={[]} indexedEmailCount={47} />,
    );
    expect(container.firstElementChild).toHaveAttribute('data-home-mode', 'fallback');
    if (homeCalmTemplate() === null) {
      expect(screen.queryByTestId('home-calm')).toBeNull();
    } else {
      expect(screen.getByTestId('home-calm')).toHaveTextContent('47 scanned emails');
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
    expect(screen.queryByText(HOME_DECK.emptyBody)).toBeNull();
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
    expect(screen.getByText('Collecting sender details.')).toBeInTheDocument();
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

  it('loading: a labelled skeleton and no senders action', () => {
    render(<HomeView state={{ kind: 'loading' }} />);
    expect(screen.getByRole('status', { name: 'Loading Home' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review senders' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Compare plans' })).toBeNull();
  });

  it('error: names the cause and retries', () => {
    const retry = vi.fn();
    render(<HomeView state={{ kind: 'error', error: new ApiError(500, null, 'boom'), retry }} />);
    expect(screen.getByText(/couldn’t load Home/)).toBeInTheDocument();
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
