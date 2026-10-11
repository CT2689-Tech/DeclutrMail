import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { failedScanSettingsStep } from '@/features/mailboxes/mailbox-health';
import { ApiError } from '@/lib/api/client';

import { HOME_DECK } from './home-deck-copy';
import type { HomeFixCandidate } from './home-next-steps';
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
    expect(screen.getByRole('link', { name: 'Later' })).toHaveAttribute('href', '/later');
    expect(screen.getByRole('link', { name: 'Later' }).closest('article')).not.toBeNull();
    expect(screen.queryByText('Your 10 largest senders')).toBeNull();
    expect(screen.queryByRole('link', { name: 'See largest senders' })).toBeNull();
    expect(screen.queryByText('≈ 7.7 GB')).toBeNull();
    expect(screen.queryByText('of email in your Gmail')).toBeNull();
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
    expect(
      screen.getByText(
        'About 2.1 GB of email (Gmail’s estimates). Archiving doesn’t change storage. Deleting moves email to Gmail Trash, which Gmail empties after 30 days.',
      ),
    ).toBeInTheDocument();
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
    expect(screen.queryByTestId('home-calm')).toBeNull();
    expect(screen.queryByText(/share card/i)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Suggested next steps' })).toBeNull();
  });

  it('omits the calm count when the indexed total is unknown', () => {
    render(<HomeView state={ready} nextSteps={[]} indexedEmailCount={null} />);
    expect(screen.queryByTestId('home-calm')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Your Inbox Report' })).toBeNull();
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
    expect(screen.queryByText('Reading your Gmail.')).toBeNull();
    expect(screen.queryByText('Nothing cleared yet.')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Your Inbox Report' })).toBeNull();
    expect(screen.queryByText('Your scan is waiting to start.')).toBeNull();
    expect(screen.getByTestId('home-scan-bar')).toBeInTheDocument();
  });

  it('queued: uses the waiting title and does not say progress is saved', () => {
    render(<HomeView state={{ kind: 'empty', syncing: true, queued: true, action }} />);
    expect(screen.getByRole('heading', { name: HOME_DECK.queuedTitle })).toBeInTheDocument();
    expect(screen.getByText(HOME_DECK.queuedBody)).toBeInTheDocument();
    expect(screen.queryByText(/Your progress is saved/)).toBeNull();
    expect(screen.queryByText('Nothing cleared yet.')).toBeNull();
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

  it('sync-failed: says the scan failed and links to Gmail accounts — never "Nothing cleared yet"', () => {
    render(<HomeView state={{ kind: 'sync-failed', needsReconnect: false }} />);
    expect(screen.getByText('Gmail scan failed.')).toBeInTheDocument();
    expect(screen.getByText('Gmail account needs attention')).toBeInTheDocument();
    expect(screen.queryByText('Nothing cleared yet.')).toBeNull();
    expect(screen.queryByTestId('home-hero')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
      'href',
      '/settings#mailboxes',
    );
  });

  it.each([false, true])(
    'sync-failed: says exactly what failedScanSettingsStep says (needsReconnect=%s)',
    (needsReconnect) => {
      render(<HomeView state={{ kind: 'sync-failed', needsReconnect }} />);
      expect(screen.getByText(failedScanSettingsStep(needsReconnect))).toBeInTheDocument();
    },
  );

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
