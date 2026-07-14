/**
 * Tests for `SnoozedScreen` (D78–D80, D82).
 *
 * Covers the first-class edge branches per D211 (loading, error,
 * empty), the populated D80 grouping, the Wake-now confirm → POST
 * flow, the D82 snooze-set PATCH flow, and the honest mirror-degraded
 * count copy.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { installFetchStub, resetFetchStub, type FetchStubHandler } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import type { SnoozedSenderRow } from '@/lib/api/snoozed';

import { SnoozedScreen } from './snoozed-screen';

/**
 * A wake time in the 'today' bucket — guaranteed FUTURE and BEFORE
 * local midnight whatever wall-clock time the test runs at (a flat
 * `now + 3h` crosses midnight when the suite runs after 9 PM).
 */
function laterToday(): string {
  const now = Date.now();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0); // start of tomorrow, local
  return new Date(now + (midnight.getTime() - now) / 2).toISOString();
}

const LATER_TODAY = laterToday();
const IN_30_DAYS = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

const ROW_TODAY: SnoozedSenderRow = {
  senderId: '6f1f2f3a-0000-4000-8000-000000000001',
  displayName: 'Daily Digest',
  email: 'digest@news.example.com',
  domain: 'news.example.com',
  laterCount: 12,
  snoozedUntil: LATER_TODAY,
  snoozedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  reason: 'after launch week',
};

const ROW_EVENTUALLY: SnoozedSenderRow = {
  senderId: '6f1f2f3a-0000-4000-8000-000000000002',
  displayName: 'Quarterly Newsletter',
  email: 'news@corp.example.com',
  domain: 'corp.example.com',
  laterCount: 3,
  snoozedUntil: IN_30_DAYS,
  snoozedAt: new Date().toISOString(),
  reason: null,
};

const ROW_NO_TIMER: SnoozedSenderRow = {
  senderId: '6f1f2f3a-0000-4000-8000-000000000003',
  displayName: '',
  email: 'noreply@tools.example.com',
  domain: 'tools.example.com',
  laterCount: 9,
  snoozedUntil: null,
  snoozedAt: null,
  reason: null,
};

function listHandler(rows: SnoozedSenderRow[]): FetchStubHandler {
  return {
    method: 'GET',
    path: '/api/snoozed',
    respond: () =>
      new Response(JSON.stringify({ data: rows }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  };
}

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <SnoozedScreen />
    </QueryWrapper>,
  );
}

describe('SnoozedScreen — edge states', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('shows the loading skeleton while the initial fetch is in-flight', () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/snoozed',
        respond: () => new Promise<Response>(() => {}),
      },
    ]);
    renderScreen();
    expect(screen.getByText('Loading Later senders')).toBeInTheDocument();
  });

  it('shows the error state with a retry affordance on a 500', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/snoozed',
        respond: () =>
          new Response(JSON.stringify({ message: 'boom' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);
    renderScreen();
    expect(await screen.findByText(/couldn't load Later/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows the empty state pointing at the Later verb', async () => {
    installFetchStub([listHandler([])]);
    renderScreen();
    expect(await screen.findByText('Nothing in Later.')).toBeInTheDocument();
    expect(screen.getAllByText('Later').length).toBeGreaterThan(0);
  });
});

describe('SnoozedScreen — populated (D80 grouping)', () => {
  beforeEach(() => installFetchStub([listHandler([ROW_TODAY, ROW_EVENTUALLY, ROW_NO_TIMER])]));
  afterEach(() => resetFetchStub());

  it('groups rows into wake-time buckets with real counts', async () => {
    renderScreen();
    expect(await screen.findByText('Daily Digest')).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: /later today/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /eventually/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /no wake time/i })).toBeInTheDocument();

    expect(screen.getByText('12 in Later')).toBeInTheDocument();
    expect(screen.getByText('“after launch week”')).toBeInTheDocument();
    // Display-name-less sender falls back to its email.
    expect(screen.getByText('noreply@tools.example.com')).toBeInTheDocument();
  });

  it('renders honest copy when the mirror count is unknown', async () => {
    resetFetchStub();
    installFetchStub([listHandler([{ ...ROW_TODAY, laterCount: null }])]);
    renderScreen();
    expect(await screen.findByText('count syncing…')).toBeInTheDocument();
  });
});

describe('SnoozedScreen — wake now flow', () => {
  afterEach(() => resetFetchStub());

  it('confirms before mutating, POSTs the wake, marks the row waking', async () => {
    let wakePosted = 0;
    installFetchStub([
      listHandler([ROW_TODAY]),
      {
        method: 'POST',
        path: new RegExp(`^/api/snoozed/${ROW_TODAY.senderId}/wake$`),
        respond: () => {
          wakePosted += 1;
          return new Response(
            JSON.stringify({ data: { senderId: ROW_TODAY.senderId, status: 'queued' } }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          );
        },
      },
    ]);
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Daily Digest');

    // Step 1 — the click opens a confirm; nothing has mutated yet.
    await user.click(screen.getByRole('button', { name: 'Wake now' }));
    expect(wakePosted).toBe(0);
    expect(
      screen.getByText(/12 messages move from DeclutrMail\/Later back to your inbox/i),
    ).toBeInTheDocument();

    // Step 2 — confirming fires the POST and flips the row to waking.
    const confirmButtons = screen.getAllByRole('button', { name: 'Wake now' });
    await user.click(confirmButtons[confirmButtons.length - 1]!);
    await waitFor(() => expect(wakePosted).toBe(1));
    expect(await screen.findByText('Waking…')).toBeInTheDocument();
  });

  it('surfaces a queue-unavailable failure inline', async () => {
    installFetchStub([
      listHandler([ROW_TODAY]),
      {
        method: 'POST',
        path: new RegExp(`^/api/snoozed/${ROW_TODAY.senderId}/wake$`),
        respond: () =>
          new Response(JSON.stringify({ code: 'QUEUE_UNAVAILABLE', message: 'no redis' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Daily Digest');

    await user.click(screen.getByRole('button', { name: 'Wake now' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Wake now' });
    await user.click(confirmButtons[confirmButtons.length - 1]!);

    expect(await screen.findByRole('alert')).toHaveTextContent(/wake queue isn't available/i);
  });
});

describe('SnoozedScreen — snooze menu (D82)', () => {
  afterEach(() => resetFetchStub());

  it('PATCHes the picked preset with the note attached', async () => {
    const bodies: unknown[] = [];
    installFetchStub([
      listHandler([ROW_NO_TIMER]),
      {
        method: 'PATCH',
        path: new RegExp(`^/api/snoozed/${ROW_NO_TIMER.senderId}$`),
        respond: async (req) => {
          bodies.push(await req.json());
          return new Response(
            JSON.stringify({
              data: {
                senderId: ROW_NO_TIMER.senderId,
                snoozedUntil: IN_30_DAYS,
                snoozedAt: new Date().toISOString(),
                reason: 'travel',
                changed: true,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
      },
    ]);
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('noreply@tools.example.com');

    await user.click(screen.getByRole('button', { name: 'Set wake time ▾' }));
    expect(
      screen.getByRole('button', {
        name: 'Close wake-time options for noreply@tools.example.com',
      }),
    ).toHaveTextContent('Close');
    await user.type(screen.getByPlaceholderText('Note (optional)'), 'travel');
    await user.click(screen.getByRole('button', { name: 'Tomorrow (9:00 AM)' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    const body = bodies[0] as { until: string; reason?: string };
    expect(body.reason).toBe('travel');
    expect(new Date(body.until).getTime()).toBeGreaterThan(Date.now());
  });

  it('offers Clear wake time only when a timer exists, and clears it', async () => {
    const bodies: unknown[] = [];
    installFetchStub([
      listHandler([ROW_TODAY]),
      {
        method: 'PATCH',
        path: new RegExp(`^/api/snoozed/${ROW_TODAY.senderId}$`),
        respond: async (req) => {
          bodies.push(await req.json());
          return new Response(
            JSON.stringify({
              data: {
                senderId: ROW_TODAY.senderId,
                snoozedUntil: null,
                snoozedAt: null,
                reason: null,
                changed: true,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
      },
    ]);
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Daily Digest');

    await user.click(screen.getByRole('button', { name: 'Set wake time ▾' }));
    await user.click(screen.getByRole('button', { name: 'Clear wake time' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ until: null });
  });
});
