/**
 * Tests for the expanded-row detail panel's volume chart and
 * Recent subjects card.
 *
 * Both previously rendered fixtures (a §10 "no fake completion"
 * violation — the chart a seeded pseudo-random series, the subjects a
 * canned SUBJECT_POOL sample); they now render the sender's real
 * `sender_timeseries` months and real recent-message subjects. Covers:
 *
 *   • Presentational states (D211): loading skeleton, error + retry,
 *     empty ("No volume history yet" / "No recent messages"), ready
 *     (one bar per month row + peak label; one line per subject,
 *     capped at 3).
 *   • `SenderRowDetailLive`: fetches `/api/senders/:id/timeseries` and
 *     `/api/senders/:id/messages` on mount (= on expand) and maps the
 *     envelopes into the states above; a 4xx becomes the error state
 *     without retry storms (`retryUnless4xx`), and Retry refetches.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => ({
    me: {
      user: { email: 'default@example.com' },
      activeMailboxId: 'mailbox-work',
      mailboxes: [{ id: 'mailbox-work', email: 'work+declutr@example.com', status: 'active' }],
    },
  }),
  getActiveMailboxEmail: (me: {
    activeMailboxId: string;
    mailboxes: Array<{ id: string; email: string }>;
    user: { email: string };
  }) => me.mailboxes.find((mailbox) => mailbox.id === me.activeMailboxId)?.email ?? me.user.email,
}));

import { installFetchStub, jsonNotFound, jsonOk } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import type { Sender } from '../data';
import {
  SenderRowDetail,
  SenderRowDetailLive,
  type RowDetailSubjects,
  type RowDetailTimeseries,
} from './sender-row-detail';

function sender(overrides: Partial<Sender> = {}): Sender {
  return {
    id: 'sender-1',
    name: 'Acme Newsletter',
    domain: 'acme.com',
    monthly: 12,
    group: 'updates',
    read: 0.2,
    spark: [3, 3, 3, 3],
    lastDays: 4,
    unread: 0,
    firstSeenMo: 18,
    volumeTrend: 'steady',
    lastReview: null,
    ...overrides,
  };
}

const TIMESERIES = [
  { yearMonth: '2026-05-01', volume: 8, readCount: 2 },
  { yearMonth: '2026-06-01', volume: 20, readCount: 1 },
  { yearMonth: '2026-07-01', volume: 5, readCount: 0 },
];

function messageRow(overrides: { id: string; subject: string }) {
  return {
    id: overrides.id,
    providerMessageId: `prov-${overrides.id}`,
    providerThreadId: `thread-${overrides.id}`,
    subject: overrides.subject,
    snippet: 'snippet',
    internalDate: '2026-07-01T10:00:00.000Z',
    isUnread: false,
    sizeBytes: null,
  };
}

const MESSAGES = [
  messageRow({ id: 'm1', subject: 'Your July statement is ready' }),
  messageRow({ id: 'm2', subject: 'Security alert: new sign-in' }),
  messageRow({ id: 'm3', subject: 'Weekly digest — 12 new updates' }),
  messageRow({ id: 'm4', subject: 'Fourth message beyond the preview cap' }),
];

function messagesEnvelope(rows: ReturnType<typeof messageRow>[]) {
  return { data: rows, meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } } };
}

const READY_SUBJECTS: RowDetailSubjects = {
  status: 'ready',
  subjects: MESSAGES.slice(0, 3).map((m) => m.subject),
};

function renderDetail(
  timeseries: RowDetailTimeseries,
  subjects: RowDetailSubjects = READY_SUBJECTS,
  row: Sender = sender(),
) {
  return render(
    <SenderRowDetail s={row} onAction={() => {}} timeseries={timeseries} subjects={subjects} />,
  );
}

describe('SenderRowDetail — D245 fact-first actions', () => {
  const CHART_READY: RowDetailTimeseries = { status: 'ready', points: TIMESERIES };

  it('removes the dominant recommendation callout and uses honest fact labels', () => {
    renderDetail(CHART_READY);
    expect(screen.queryByText(/recommended/i)).not.toBeInTheDocument();
    expect(screen.getByText('Last received')).toBeInTheDocument();
    expect(screen.getByText('Marked read')).toBeInTheDocument();
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
  });

  it('offers factual one-click Unsubscribe and restores Archive to the action set', () => {
    renderDetail(CHART_READY, READY_SUBJECTS, sender({ unsubscribeMethod: 'one_click' }));
    expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Keep',
      'Archive',
      'Unsubscribe',
      'Later',
    ]);
  });
});

describe('SenderRowDetail volume chart', () => {
  it('ready: renders one bar per timeseries month with real peak + month-range labels', () => {
    renderDetail({ status: 'ready', points: TIMESERIES });
    const chart = screen.getByRole('img', {
      name: /monthly volume over 3 months, peak 20 per month/i,
    });
    expect(chart.children.length).toBe(3);
    // Peak bar is full height; others proportional to REAL volumes.
    const heights = Array.from(chart.children).map((el) => (el as HTMLElement).style.height);
    expect(heights[1]).toBe('100%');
    expect(heights[0]).toBe('40%'); // 8/20
    expect(screen.getByText(/peak 20\/mo/i)).toBeTruthy();
    expect(screen.getByText('May 2026')).toBeTruthy();
    expect(screen.getByText('Jul 2026')).toBeTruthy();
  });

  it('ready + no rows: renders the calm empty state, no bars, no peak', () => {
    renderDetail({ status: 'ready', points: [] });
    expect(screen.getByText(/no volume history yet/i)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/peak/i)).toBeNull();
  });

  it('loading: marks the card busy and shows the skeleton, no data claims', () => {
    const { container } = renderDetail({ status: 'loading' });
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/peak/i)).toBeNull();
  });

  it('error: shows the error copy and wires the Retry button', () => {
    const retry = vi.fn();
    renderDetail({ status: 'error', retry });
    expect(screen.getByText(/couldn't load volume history/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('SenderRowDetail recent subjects', () => {
  const CHART_READY: RowDetailTimeseries = { status: 'ready', points: TIMESERIES };

  it('ready: renders one line per real subject', () => {
    renderDetail(CHART_READY, READY_SUBJECTS);
    expect(screen.getByText('Your July statement is ready')).toBeTruthy();
    expect(screen.getByText('Security alert: new sign-in')).toBeTruthy();
    expect(screen.getByText('Weekly digest — 12 new updates')).toBeTruthy();
  });

  it('ready + no rows: renders the calm empty state', () => {
    renderDetail(CHART_READY, { status: 'ready', subjects: [] });
    expect(screen.getByText(/no recent messages/i)).toBeTruthy();
  });

  it('loading: marks the card busy and shows skeleton lines, no data claims', () => {
    const { container } = renderDetail(CHART_READY, { status: 'loading' });
    // Chart is ready, so the only busy card is the subjects one.
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBe(1);
    expect(screen.queryByText('Your July statement is ready')).toBeNull();
    expect(screen.queryByText(/no recent messages/i)).toBeNull();
  });

  it('error: shows the error copy and wires the Retry button', () => {
    const retry = vi.fn();
    renderDetail(CHART_READY, { status: 'error', retry });
    expect(screen.getByText(/couldn't load recent subjects/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('SenderRowDetail Gmail round trip', () => {
  it('binds the domain search to the active Gmail account without /u/0', () => {
    renderDetail({ status: 'ready', points: TIMESERIES });
    const link = screen.getByRole('link', { name: 'View in Gmail ↗' });
    expect(link).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/?authuser=work%2Bdeclutr%40example.com#search/' +
        'from%3A%22%40acme.com%22',
    );
    expect(link.getAttribute('href')).not.toContain('/u/0');
  });
});

describe('SenderRowDetailLive', () => {
  function renderLive() {
    const client = createTestQueryClient();
    return render(
      <QueryWrapper client={client}>
        <SenderRowDetailLive s={sender()} onAction={() => {}} />
      </QueryWrapper>,
    );
  }

  const timeseriesHandler = {
    method: 'GET' as const,
    path: /^\/api\/senders\/[^/]+\/timeseries$/,
    respond: () => jsonOk({ data: TIMESERIES }),
  };
  const messagesHandler = {
    method: 'GET' as const,
    path: /^\/api\/senders\/[^/]+\/messages$/,
    respond: () => jsonOk(messagesEnvelope(MESSAGES)),
  };

  it('fetches the sender timeseries on mount and renders the real bars', async () => {
    const requested: string[] = [];
    installFetchStub([
      {
        ...timeseriesHandler,
        respond: (_req: Request, url: URL) => {
          requested.push(url.pathname);
          return jsonOk({ data: TIMESERIES });
        },
      },
      messagesHandler,
    ]);
    renderLive();
    const chart = await screen.findByRole('img', { name: /peak 20 per month/i });
    expect(chart.children.length).toBe(3);
    expect(requested).toEqual(['/api/senders/sender-1/timeseries']);
  });

  it('fetches the sender messages on mount and renders the first 3 real subjects', async () => {
    const requested: string[] = [];
    installFetchStub([
      timeseriesHandler,
      {
        ...messagesHandler,
        respond: (_req: Request, url: URL) => {
          requested.push(url.pathname);
          return jsonOk(messagesEnvelope(MESSAGES));
        },
      },
    ]);
    renderLive();
    expect(await screen.findByText('Your July statement is ready')).toBeTruthy();
    expect(screen.getByText('Security alert: new sign-in')).toBeTruthy();
    expect(screen.getByText('Weekly digest — 12 new updates')).toBeTruthy();
    // 4th row exists on the wire but the panel caps the preview at 3.
    expect(screen.queryByText('Fourth message beyond the preview cap')).toBeNull();
    expect(requested).toEqual(['/api/senders/sender-1/messages']);
  });

  it('renders the calm empty state when the sender has no recent messages', async () => {
    installFetchStub([
      timeseriesHandler,
      { ...messagesHandler, respond: () => jsonOk(messagesEnvelope([])) },
    ]);
    renderLive();
    expect(await screen.findByText(/no recent messages/i)).toBeTruthy();
  });

  it('maps a 4xx to the error state (no retry storm) and Retry refetches', async () => {
    let fail = true;
    installFetchStub([
      {
        ...timeseriesHandler,
        respond: () => (fail ? jsonNotFound('sender_not_found') : jsonOk({ data: TIMESERIES })),
      },
      messagesHandler,
    ]);
    renderLive();
    expect(await screen.findByText(/couldn't load volume history/i)).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('img', { name: /peak 20 per month/i })).toBeTruthy();
  });

  it('maps a messages 4xx to the subjects error state while the chart stays ready', async () => {
    let fail = true;
    installFetchStub([
      timeseriesHandler,
      {
        ...messagesHandler,
        respond: () =>
          fail ? jsonNotFound('sender_not_found') : jsonOk(messagesEnvelope(MESSAGES)),
      },
    ]);
    renderLive();
    expect(await screen.findByText(/couldn't load recent subjects/i)).toBeTruthy();
    // The chart's own fetch succeeded — its error copy must NOT show.
    expect(await screen.findByRole('img', { name: /peak 20 per month/i })).toBeTruthy();
    expect(screen.queryByText(/couldn't load volume history/i)).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Your July statement is ready')).toBeTruthy();
  });
});
