import { renderToString } from 'react-dom/server';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { installFetchStub, jsonOk } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';
import { ApiError } from '@/lib/api/client';
import { HOME_DECK } from './home-deck-copy';
import { HomeRouteLoading } from './home-loading-shell';
import { HomePreview } from './home-preview';
import { HomeView, homeLaterOverview } from './home-view';
import { homeShortlist, type HomeFixCandidate } from './home-next-steps';
import { overviewFixture, reportFixture } from './home-view.fixture';

const action = { label: 'Review senders', href: '/senders' };
const ready = {
  kind: 'ready' as const,
  hero: { label: 'emails cleared', value: 1234 },
  since: null,
  secondary: [
    { label: 'Emails archived', value: 1200 },
    { label: 'Emails deleted', value: 34 },
  ],
  action,
};
const step: HomeFixCandidate = {
  kind: 'unsub_archive',
  senderCount: 1,
  emailCount: 1200,
  senderIds: ['s1'],
  senders: [
    {
      id: 's1',
      name: 'Synthetic newsletter',
      domain: 'newsletter.synthetic.test',
      inboxCount: 1200,
      readRate: 0.02,
    },
  ],
};

describe('Action overview', () => {
  it('keeps review backlog visible alongside an explainable cleanup and its exact Inbox scope', () => {
    render(
      <HomeView
        state={ready}
        nextSteps={[step]}
        overview={overviewFixture}
        report={reportFixture}
        tier="pro"
        newSenders={{ status: 'ready', data: 139 }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Start with 1 sender.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview cleanup' })).toBeEnabled();
    expect(screen.getByText('Review Unsubscribe + Archive.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New senders/ })).toHaveTextContent('139');
    expect(screen.getByRole('link', { name: /Synthetic newsletter/ })).toHaveAttribute(
      'href',
      '/senders?sender=s1',
    );
    expect(screen.getByText('2% marked read · 90 days')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Your Inbox Report' }).closest('details')).toBeNull();
    expect(screen.getByRole('region', { name: 'Your results' }).closest('details')).toBeNull();
  });
  it('uses the server shortlist count rather than mailbox totals or hidden sender IDs', () => {
    const shortlist = homeShortlist([
      ...step.senders!,
      { id: 'zero', name: 'Zero', domain: 'z.test', inboxCount: 0 },
      { id: 'unknown', name: 'Unknown', domain: 'u.test', inboxCount: null },
    ]);
    expect(shortlist).toMatchObject({ senderIds: ['s1'], senderCount: 1, emailCount: 1200 });
    expect(
      homeShortlist([{ id: 'bad', name: 'Bad', domain: 'b.test', inboxCount: NaN }]),
    ).toBeNull();
    render(<HomeView state={ready} nextSteps={[shortlist!]} overview={overviewFixture} />);
    expect(screen.getByRole('region', { name: 'Mailbox snapshot' })).toHaveTextContent('6,200');
    expect(document.querySelector('[data-home-impact]')).toHaveTextContent('1,200 emails');
  });
  it('does not call a returning mailbox a first cleanup when eligible senders have no Inbox mail', () => {
    expect(
      homeShortlist([{ id: 'zero', name: 'Zero', domain: 'z.test', inboxCount: 0 }]),
    ).toBeNull();
    render(<HomeView state={ready} nextSteps={[]} report={reportFixture} />);
    expect(screen.getByRole('heading', { name: 'Explore your senders.' })).toBeInTheDocument();
    expect(screen.queryByText('Start your first cleanup.')).toBeNull();
  });
  it('keeps preview disabled in the server document until the handler is attached', () => {
    expect(renderToString(<HomeView state={ready} nextSteps={[step]} />)).toMatch(
      /<button[^>]*disabled=""[^>]*>Preview cleanup/,
    );
    render(<HomeView state={ready} nextSteps={[step]} />);
    expect(screen.getByRole('button', { name: 'Preview cleanup' })).toBeEnabled();
  });
  it.each([undefined, 0, NaN])(
    'does not preview an unknown or invalid impact (%s)',
    (emailCount) => {
      const next = { ...step };
      if (emailCount === undefined) delete next.emailCount;
      else next.emailCount = emailCount;
      render(<HomeView state={ready} nextSteps={[next]} />);
      expect(screen.queryByRole('button', { name: 'Preview cleanup' })).toBeNull();
      expect(document.querySelector('[data-home-impact]')).toBeNull();
    },
  );
  it.each([
    'Reconnect Gmail to continue.',
    'Your cleanup is in progress.',
    'Check your cleanup status.',
    'A Later return needs attention.',
  ])('puts %s before another cleanup', (title) => {
    render(
      <HomeView
        state={ready}
        nextSteps={[step]}
        priority={{ title, action: { label: 'Open Activity', href: '/activity' } }}
      />,
    );
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview cleanup' })).toBeNull();
  });
  it('switches every result figure between the rolling seven-day window and all time', () => {
    render(<HomeView state={ready} overview={overviewFixture} />);
    const results = within(screen.getByRole('region', { name: 'Your results' }));
    expect(results.getByTestId('home-hero')).toHaveTextContent('1,000');
    expect(results.getByText('800')).toBeInTheDocument();
    fireEvent.click(results.getByRole('button', { name: 'All time' }));
    expect(results.getByTestId('home-hero')).toHaveTextContent('1,234');
    expect(results.getByText('1,200')).toBeInTheDocument();
    expect(results.getByRole('link', { name: /activity & Undo/ })).toHaveAttribute(
      'href',
      '/activity?window=all',
    );
  });
  it('keeps a failed optional source unavailable rather than showing zero or removing other sections', () => {
    render(
      <HomeView
        state={ready}
        nextSteps={[step]}
        overview={{
          ...overviewFixture,
          snapshot: { status: 'error', data: null },
          suggestions: { status: 'error', data: null },
          week: { status: 'error', data: null },
        }}
        tier="pro"
      />,
    );
    expect(screen.getByRole('region', { name: 'Mailbox snapshot' })).toHaveTextContent(
      /unavailable/i,
    );
    expect(screen.getByRole('region', { name: 'Your results' })).toHaveTextContent('Unavailable');
    expect(screen.getByRole('button', { name: 'Preview cleanup' })).toBeEnabled();
    expect(screen.getByText(/2 active/)).toBeInTheDocument();
    expect(screen.queryByText('0 suggestions awaiting approval')).toBeNull();
  });
  it('keeps missing size estimates unknown and labels partial coverage', () => {
    const { rerender } = render(<HomeView state={ready} overview={overviewFixture} />);
    expect(screen.getByText('Size estimates are incomplete')).toBeInTheDocument();
    rerender(
      <HomeView
        state={ready}
        overview={{
          ...overviewFixture,
          snapshot: {
            status: 'ready',
            data: { ...overviewFixture.snapshot.data!, totalBytes: null, sizeKnownCount: 0 },
          },
        }}
      />,
    );
    expect(screen.getByRole('region', { name: 'Mailbox snapshot' })).toHaveTextContent(
      /unavailable/i,
    );
    expect(screen.queryByText('≈0 B')).toBeNull();
  });
  it('hides restricted workflow reads on Free while keeping cleanup and results', () => {
    render(<HomeView state={ready} nextSteps={[step]} tier="free" overview={overviewFixture} />);
    expect(screen.queryByRole('link', { name: /Follow-ups/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /automations/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview cleanup' })).toBeInTheDocument();
  });
  it('shows loading and first-scan states without fabricated totals or cleanup controls', () => {
    const { rerender } = render(<HomeView state={{ kind: 'loading' }} />);
    expect(screen.getByRole('status', { name: 'Loading Home' })).toBeInTheDocument();
    rerender(<HomeView state={{ kind: 'empty', syncing: true, queued: true, action }} />);
    expect(screen.getByText(HOME_DECK.queuedBody)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review senders' })).toBeNull();
    expect(screen.queryByTestId('home-hero')).toBeNull();
  });
  it('shows a fresh start without presenting a zero achievement', () => {
    render(<HomeView state={{ kind: 'empty', syncing: false, action }} />);
    expect(screen.getByText('Start your first cleanup.')).toBeInTheDocument();
    expect(screen.queryByTestId('home-hero')).toBeNull();
  });
  it('keeps a results error recoverable while the available sender work remains usable', () => {
    const retry = vi.fn();
    render(
      <HomeView
        state={{ kind: 'error', error: new ApiError(500, null, 'boom'), retry }}
        nextSteps={[step]}
      />,
    );
    expect(screen.getByText(/server returned an error/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview cleanup' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('retains the route loading shell without mounting a second HomeView', () => {
    const { container } = render(<HomeRouteLoading />);
    expect(container.querySelector('[data-home-skeleton]')).not.toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });
  it('separates future returns from due and failed returns', () => {
    const now = Date.parse('2026-10-25T20:00:00Z');
    const rows = [
      { senderId: 'a', returnStatus: 'scheduled', snoozedUntil: '2026-10-25T21:00:00Z' },
      { senderId: 'b', returnStatus: 'scheduled', snoozedUntil: '2026-10-25T19:00:00Z' },
      { senderId: 'c', returnStatus: 'missed', snoozedUntil: '2026-10-24T20:00:00Z' },
    ] as Parameters<typeof homeLaterOverview>[0];
    expect(homeLaterOverview(rows, now)).toEqual({
      due: 2,
      troubled: 1,
      nextAt: '2026-10-25T21:00:00Z',
    });
    expect(homeLaterOverview(rows, null)).toEqual({ due: 1, troubled: 1, nextAt: null });
  });
});

describe('Home preview failed fixture', () => {
  it('retries the named synthetic mailbox scan', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: HOME_DECK.failedRetry }));
    await waitFor(() => expect(mailboxes).toEqual(['mb-preview']));
  });
});
