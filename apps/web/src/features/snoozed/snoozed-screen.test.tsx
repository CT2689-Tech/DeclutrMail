/**
 * Tests for `SnoozedScreen` (D78–D80, D82).
 *
 * Covers the first-class edge branches per D211 (loading, error,
 * empty), the populated D80 grouping, the Wake-now confirm → POST
 * flow, the D82 snooze-set PATCH flow, and the honest mirror-degraded
 * count copy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { installFetchStub, resetFetchStub, type FetchStubHandler } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import type { SnoozedSenderRow } from '@/lib/api/snoozed';
import { AuthProvider } from '@/features/auth/auth-provider';
import { ME_QUERY_KEY } from '@/features/auth/api/use-me';

import { formatLastAttempt, SnoozedScreen } from './snoozed-screen';

// This suite builds its fixtures with LOCAL Date math (laterToday()),
// so the screen must bucket in the machine zone for the grouping
// assertions to stay meaningful wherever the suite runs. Exact
// pinned-zone strings are asserted in snooze-times.test.ts instead.
const accountZone = vi.hoisted(() => ({ value: '' }));
vi.mock('@/features/auth/api/use-me', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUserTimeZone: () => accountZone.value || Intl.DateTimeFormat().resolvedOptions().timeZone,
}));

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
  returnStatus: 'scheduled',
  lastReturnAttemptAt: null,
  returnFailureKind: null,
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
  returnStatus: 'scheduled',
  lastReturnAttemptAt: null,
  returnFailureKind: null,
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
  const view = render(
    <QueryWrapper client={client}>
      <SnoozedScreen />
    </QueryWrapper>,
  );
  return { ...view, client };
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
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load Later/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows the empty state pointing at the Later verb', async () => {
    installFetchStub([listHandler([])]);
    renderScreen();
    expect(await screen.findByText('Nothing in Later')).toBeInTheDocument();
    expect(screen.getAllByText('Later').length).toBeGreaterThan(0);
  });
});

describe('SnoozedScreen — populated (D80 grouping)', () => {
  beforeEach(() => installFetchStub([listHandler([ROW_TODAY, ROW_EVENTUALLY])]));
  afterEach(() => resetFetchStub());

  it('groups rows into wake-time buckets with real counts', async () => {
    renderScreen();
    expect(await screen.findByText('Daily Digest')).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: /later today/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /eventually/i })).toBeInTheDocument();
    expect(screen.getByText('12 in Later')).toBeInTheDocument();
    expect(screen.getByText('“after launch week”')).toBeInTheDocument();
    expect(screen.queryByText(/needs (scheduling|a return time)/i)).not.toBeInTheDocument();
  });

  it('renders honest copy when the mirror count is unknown', async () => {
    resetFetchStub();
    installFetchStub([listHandler([{ ...ROW_TODAY, laterCount: null }])]);
    renderScreen();
    expect(await screen.findByText('count syncing…')).toBeInTheDocument();
  });

  it('surfaces a failed return without implying the mail was lost', async () => {
    resetFetchStub();
    installFetchStub([
      listHandler([
        {
          ...ROW_TODAY,
          returnStatus: 'retrying',
          lastReturnAttemptAt: new Date().toISOString(),
          returnFailureKind: 'temporary',
        },
      ]),
    ]);
    renderScreen();
    expect(await screen.findByText('Return retrying')).toBeInTheDocument();
    // The app-wide LaterReturnAlert owns the banner; this page must not
    // render a second copy of the same failure.
    expect(screen.queryByText(/could not be confirmed/i)).not.toBeInTheDocument();
    expect(screen.getByText(/automatic retry remains active/i)).toBeInTheDocument();
    expect(screen.getByText(/Last tried/i)).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Bring back now' }));
    expect(wakePosted).toBe(0);
    expect(screen.getByText(/12 emails return to your inbox/i)).toBeInTheDocument();
    // Wake-now has no Activity undo, so the confirm must say the scheduled
    // return is discarded — on the populated branch, not only the empty one.
    expect(screen.getByText(/return time clears/i)).toBeInTheDocument();

    // Step 2 — confirming fires the POST and flips the row to waking.
    const confirmButtons = screen.getAllByRole('button', { name: 'Bring back now' });
    await user.click(confirmButtons[confirmButtons.length - 1]!);
    await waitFor(() => expect(wakePosted).toBe(1));
    expect(await screen.findByText('Bringing back…')).toBeInTheDocument();
  });

  it('keeps stale failure pending, then restores controls after a newer failed attempt', async () => {
    const previousAttempt = '2026-10-01T10:00:00.000Z';
    let listUnavailable = false;
    let row: SnoozedSenderRow = {
      ...ROW_TODAY,
      returnStatus: 'retrying',
      lastReturnAttemptAt: previousAttempt,
      returnFailureKind: 'temporary',
    };
    installFetchStub([
      {
        method: 'GET',
        path: '/api/snoozed',
        respond: () =>
          listUnavailable
            ? new Response('{}', { status: 500 })
            : new Response(JSON.stringify({ data: [row] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
      },
      {
        method: 'POST',
        path: `/api/snoozed/${ROW_TODAY.senderId}/wake`,
        respond: () =>
          new Response(
            JSON.stringify({ data: { senderId: ROW_TODAY.senderId, status: 'queued' } }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          ),
      },
    ]);
    const client = createTestQueryClient();
    const user = userEvent.setup();
    render(
      <QueryWrapper client={client}>
        <SnoozedScreen />
      </QueryWrapper>,
    );
    await screen.findByText('Return retrying');
    await user.click(screen.getByRole('button', { name: 'Bring back now' }));
    const confirms = screen.getAllByRole('button', { name: 'Bring back now' });
    await user.click(confirms[confirms.length - 1]!);
    await screen.findByText('Bringing back…');
    await client.invalidateQueries({ queryKey: ['snoozed'] });
    expect(screen.getByRole('button', { name: 'Bring back now' })).toBeDisabled();
    row = { ...row, lastReturnAttemptAt: '2026-09-30T10:00:00.000Z' };
    await client.invalidateQueries({ queryKey: ['snoozed'] });
    expect(screen.getByRole('button', { name: 'Bring back now' })).toBeDisabled();
    listUnavailable = true;
    await client.invalidateQueries({ queryKey: ['snoozed'] });
    await screen.findByText(/couldn.t refresh Later/i);
    expect(screen.getByText('Daily Digest')).toBeInTheDocument();
    expect(screen.getByText('Bringing back…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bring back now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Change return time' })).toBeDisabled();
    listUnavailable = false;
    row = { ...row, lastReturnAttemptAt: previousAttempt };
    await client.invalidateQueries({ queryKey: ['snoozed'] });
    await screen.findByText('Bringing back…');
    expect(screen.getByRole('button', { name: 'Bring back now' })).toBeDisabled();
    row = { ...row, lastReturnAttemptAt: '2026-10-02T10:00:00.000Z' };
    await client.invalidateQueries({ queryKey: ['snoozed'] });
    await waitFor(() => expect(screen.queryByText('Bringing back…')).not.toBeInTheDocument());
    expect(screen.getByText('Return retrying')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bring back now' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Change return time' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Bring back now' }));
    expect(screen.getByText(/12 emails return to your inbox/i)).toBeInTheDocument();
  });

  it('hands an unconfirmed return back to normal polling with usable controls', async () => {
    installFetchStub([
      listHandler([ROW_TODAY]),
      {
        method: 'POST',
        path: `/api/snoozed/${ROW_TODAY.senderId}/wake`,
        respond: () =>
          new Response(
            JSON.stringify({ data: { senderId: ROW_TODAY.senderId, status: 'queued' } }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          ),
      },
    ]);
    const originalTimeout = globalThis.setTimeout;
    let expire: (() => void) | undefined;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      if (delay && delay > 119_000 && delay <= 120_000) expire = callback as () => void;
      return originalTimeout(callback, delay, ...args);
    });
    try {
      const user = userEvent.setup();
      renderScreen();
      await screen.findByText('Daily Digest');
      await user.click(screen.getByRole('button', { name: 'Bring back now' }));
      const confirms = screen.getAllByRole('button', { name: 'Bring back now' });
      await user.click(confirms[confirms.length - 1]!);
      await screen.findByText('Bringing back…');
      expect(expire).toBeDefined();
      const afterDeadline = Date.now() + 120_001;
      vi.spyOn(Date, 'now').mockReturnValue(afterDeadline);
      act(() => expire!());
      expect(screen.queryByText('Bringing back…')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/confirmation is taking longer/i);
      expect(screen.getByRole('button', { name: 'Bring back now' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Change return time' })).toBeEnabled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('releases the pending request when another session changes the return timer', async () => {
    let row = ROW_TODAY;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/snoozed',
        respond: () =>
          new Response(JSON.stringify({ data: [row] }), {
            headers: { 'content-type': 'application/json' },
          }),
      },
      {
        method: 'POST',
        path: `/api/snoozed/${ROW_TODAY.senderId}/wake`,
        respond: () =>
          new Response(
            JSON.stringify({ data: { senderId: ROW_TODAY.senderId, status: 'queued' } }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          ),
      },
    ]);
    const client = createTestQueryClient();
    const user = userEvent.setup();
    render(
      <QueryWrapper client={client}>
        <SnoozedScreen />
      </QueryWrapper>,
    );
    await screen.findByText('Daily Digest');
    await user.click(screen.getByRole('button', { name: 'Bring back now' }));
    await user.click(screen.getAllByRole('button', { name: 'Bring back now' }).at(-1)!);
    await screen.findByText('Bringing back…');
    row = { ...ROW_TODAY, snoozedUntil: IN_30_DAYS };
    await client.invalidateQueries({ queryKey: ['snoozed'] });
    await waitFor(() => expect(screen.queryByText('Bringing back…')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Change return time' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: /eventually/i })).toBeInTheDocument();
  });

  it('drops the old mailbox pending request when the active account changes', async () => {
    const me = {
      user: { id: 'u1', email: 'u@synthetic.test', workspaceId: 'w1', timezone: 'UTC' },
      mailboxes: [],
      activeMailboxId: 'mailbox-a',
      tier: 'pro',
      cleanupRemaining: 42,
    };
    installFetchStub([
      {
        method: 'GET',
        path: '/api/auth/me',
        respond: () =>
          new Response(JSON.stringify({ data: me }), {
            headers: { 'content-type': 'application/json' },
          }),
      },
      listHandler([ROW_TODAY]),
      {
        method: 'POST',
        path: `/api/snoozed/${ROW_TODAY.senderId}/wake`,
        respond: () =>
          new Response(
            JSON.stringify({ data: { senderId: ROW_TODAY.senderId, status: 'queued' } }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          ),
      },
    ]);
    const client = createTestQueryClient();
    const user = userEvent.setup();
    render(
      <QueryWrapper client={client}>
        <AuthProvider>
          <SnoozedScreen />
        </AuthProvider>
      </QueryWrapper>,
    );
    await screen.findByText('Daily Digest');
    await user.click(screen.getByRole('button', { name: 'Bring back now' }));
    await user.click(screen.getAllByRole('button', { name: 'Bring back now' }).at(-1)!);
    await screen.findByText('Bringing back…');
    act(() => client.setQueryData(ME_QUERY_KEY, { ...me, activeMailboxId: 'mailbox-b' }));
    await waitFor(() => expect(screen.queryByText('Bringing back…')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Bring back now' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Change return time' })).toBeEnabled();
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

    await user.click(screen.getByRole('button', { name: 'Bring back now' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Bring back now' });
    await user.click(confirmButtons[confirmButtons.length - 1]!);

    expect(await screen.findByRole('alert')).toHaveTextContent(/return schedule isn't available/i);
  });
});

describe('SnoozedScreen — snooze menu (D82)', () => {
  afterEach(() => resetFetchStub());

  it('PATCHes the picked preset with the note attached', async () => {
    const bodies: unknown[] = [];
    installFetchStub([
      listHandler([ROW_EVENTUALLY]),
      {
        method: 'PATCH',
        path: new RegExp(`^/api/snoozed/${ROW_EVENTUALLY.senderId}$`),
        respond: async (req) => {
          bodies.push(await req.json());
          return new Response(
            JSON.stringify({
              data: {
                senderId: ROW_EVENTUALLY.senderId,
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
    await screen.findByText('Quarterly Newsletter');

    await user.click(screen.getByRole('button', { name: 'Change return time' }));
    expect(
      screen.getByRole('button', {
        name: 'Cancel return-time changes for Quarterly Newsletter',
      }),
    ).toHaveTextContent('Cancel');
    await user.type(screen.getByPlaceholderText('Note (optional)'), 'travel');
    await user.click(screen.getByRole('button', { name: 'Tomorrow (9:00 AM)' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    const body = bodies[0] as { until: string; reason?: string };
    expect(body.reason).toBe('travel');
    expect(new Date(body.until).getTime()).toBeGreaterThan(Date.now());
  });

  it('never offers an indefinite Later state', async () => {
    installFetchStub([listHandler([ROW_TODAY])]);
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Daily Digest');

    await user.click(screen.getByRole('button', { name: 'Change return time' }));
    expect(screen.queryByRole('button', { name: /clear return time/i })).not.toBeInTheDocument();
  });
});

describe('formatLastAttempt', () => {
  it('renders the exact pinned label in the user zone, never the machine zone', () => {
    expect(formatLastAttempt('2026-07-14T10:01:00.000Z', 'Asia/Kolkata')).toBe(
      'Jul 14, 2026, 3:31 PM',
    );
    expect(formatLastAttempt('2026-07-14T10:01:00.000Z', 'UTC')).toBe('Jul 14, 2026, 10:01 AM');
  });

  it('degrades honestly on an unparseable stamp', () => {
    expect(formatLastAttempt('not-a-time', 'UTC')).toBe('at an unknown time');
  });
});

describe('Later — custom timezone and retained refresh', () => {
  afterEach(() => {
    resetFetchStub();
    accountZone.value = '';
  });
  it('submits a custom wall time in the account timezone instead of the device timezone', async () => {
    accountZone.value = 'Asia/Kolkata';
    let body: unknown;
    installFetchStub([
      listHandler([ROW_EVENTUALLY]),
      {
        method: 'PATCH',
        path: new RegExp(`^/api/snoozed/${ROW_EVENTUALLY.senderId}$`),
        respond: async (req) => {
          body = await req.json();
          return new Response(
            JSON.stringify({
              data: {
                senderId: ROW_EVENTUALLY.senderId,
                snoozedUntil: '2099-10-04T03:30:00.000Z',
                snoozedAt: new Date().toISOString(),
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
    await screen.findByText('Quarterly Newsletter');
    await user.click(screen.getByRole('button', { name: 'Change return time' }));
    fireEvent.change(screen.getByLabelText('Custom · Asia/Kolkata'), {
      target: { value: '2099-10-04T09:00' },
    });
    await user.click(screen.getByRole('button', { name: 'Set' }));
    await waitFor(() => expect(body).toEqual({ until: '2099-10-04T03:30:00.000Z' }));
  });
  it('preserves rows and offers retry after a background list failure', async () => {
    let fail = false;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/snoozed',
        respond: () =>
          fail
            ? new Response('{}', { status: 500 })
            : new Response(JSON.stringify({ data: [ROW_EVENTUALLY] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
      },
    ]);
    const view = renderScreen();
    await screen.findByText('Quarterly Newsletter');
    fail = true;
    await view.client.invalidateQueries({ queryKey: ['snoozed'] });
    expect(await screen.findByText(/Couldn’t refresh Later\./)).toBeInTheDocument();
    expect(screen.getByText('Quarterly Newsletter')).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load Later/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
