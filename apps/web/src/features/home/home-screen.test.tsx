import { ToastHost } from '@declutrmail/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';

import type { Me } from '@/features/auth/api/me-contract';
import { InboxReportFirstLanding } from '@/features/inbox-report/first-landing-entry';
import { resetMailboxScopedCache } from '@/features/mailboxes/api/reset-mailbox-cache';
import { ProductUndoTray } from '@/features/triage/triage-undo-tray';
import { undoKeys } from '@/features/undo/query-keys';
import { makeQueryClient } from '@/lib/query-client';
import { addFetchHandlers, installFetchStub, jsonOk, jsonServerError } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';

import { HOME_DECK } from './home-deck-copy';
import { homeFixCopy } from './home-ws5-copy';
import { HomeScreen } from './home-screen';

const authCell: { me: Me } = { me: meFor('pro', 'ready') };

vi.mock('@/features/auth/auth-provider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({ me: authCell.me }),
    useOptionalAuth: () => ({ me: authCell.me }),
  };
});
vi.mock('@/features/mailboxes/no-active-mailbox', () => ({
  NoActiveMailbox: () => <div data-testid="no-active-mailbox" />,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/home',
}));

function meFor(
  tier: Me['tier'],
  readiness: Me['mailboxes'][number]['readiness'],
  activeMailboxId: string | null = 'mb-1',
): Me {
  return {
    user: { id: 'u1', email: 'me@example.com', workspaceId: 'w1', timezone: null },
    mailboxes: [
      { id: 'mb-1', email: 'me@example.com', status: 'active', connectedAt: null, readiness },
    ],
    activeMailboxId,
    tier,
    cleanupRemaining: null,
  };
}

const SUMMARY = {
  window: 'all',
  since: '2026-03-15T12:00:00.000Z',
  decidedSenders: 9,
  byVerb: { keep: 1, archive: 5, unsubscribe: 1, later: 1, delete: 1 },
  emailsByVerb: { keep: 0, archive: 1200, unsubscribe: 0, later: 500, delete: 34 },
  emailsHandled: 1734,
  undoCount: 0,
};
const EMPTY_SUMMARY = {
  ...SUMMARY,
  since: null,
  decidedSenders: 0,
  emailsByVerb: { keep: 0, archive: 0, unsubscribe: 0, later: 0, delete: 0 },
  emailsHandled: 0,
};

function mailboxConflict(code: string): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status: 409,
    headers: { 'content-type': 'application/json' },
  });
}

const EMPTY_REPORT = {
  generatedAt: '2026-10-01T00:00:00.000Z',
  mailboxSizeBucket: 'under_1gb',
  insights: [],
  fix: { senderKeys: [], sendersCount: 0, inboxEmailCount: 0 },
  fallbackSenderCount: 0,
  receivedCount: 0,
  totalBytes: 0,
  variant: 'fallback',
};

const REPORT_WITH_FIX = {
  ...EMPTY_REPORT,
  variant: 'full',
  insights: [
    {
      id: 'mostly_unread_share',
      pct: 85,
      senderCount: 29,
      sweeperExcluded: 0,
      window: '90d',
    },
  ],
  fix: { senderKeys: ['s1', 's2'], sendersCount: 2, inboxEmailCount: 40 },
  fallbackSenderCount: 2,
  receivedCount: 80,
};

interface Stub {
  summary?: () => Response;
  queueLength?: number;
  screenerPending?: number;
  sync?: Record<string, unknown>;
  report?: () => Response;
  snoozed?: () => Response;
}

function stub({ summary, queueLength = 0, screenerPending = 0, sync, report, snoozed }: Stub = {}) {
  const calls = {
    summary: [] as string[],
    triage: 0,
    screener: 0,
    retryMailbox: null as string | null,
  };
  installFetchStub([
    {
      method: 'GET',
      path: '/api/home/visit',
      respond: () =>
        jsonOk({
          data: {
            visitId: '00000000-0000-4000-8000-000000000000',
            since: null,
            until: '2026-10-10T10:00:00.000Z',
            indexedEmails: null,
            indexedSenders: null,
          },
        }),
    },
    {
      method: 'POST',
      path: '/api/home/visit',
      respond: () => jsonOk({ data: { since: null, indexedEmails: null, indexedSenders: null } }),
    },
    {
      method: 'GET',
      path: '/api/v1/sync/status',
      respond: () =>
        jsonOk({
          data: sync ?? {
            readiness_status: authCell.me.mailboxes[0]?.readiness ?? 'ready',
            progress_pct: 100,
            is_ready_for_triage: authCell.me.mailboxes[0]?.readiness === 'ready',
          },
        }),
    },
    {
      method: 'GET',
      path: '/api/activity/summary',
      respond: (_req, url) => {
        calls.summary.push(url.search);
        return summary ? summary() : jsonOk({ data: SUMMARY });
      },
    },
    {
      method: 'GET',
      path: '/api/triage/bootstrap',
      respond: () => {
        calls.triage += 1;
        return jsonOk({
          data: {
            queue: Array.from({ length: queueLength }, (_, i) => ({
              id: `row-${i}`,
              senderId: `sender-${i}`,
              senderName: `Journal ${i}`,
              senderDomain: 'journal.example',
              last90dMessages: 25 + i,
              inboxCount: i + 1,
            })),
            stats: {},
            todaySummary: {},
          },
        });
      },
    },
    {
      method: 'GET',
      path: '/api/screener/count',
      respond: () => {
        calls.screener += 1;
        return jsonOk({ data: { pending: screenerPending } });
      },
    },
    {
      method: 'GET',
      path: '/api/mailboxes/mb-1/inbox-report',
      respond: () => (report ? report() : jsonOk({ data: EMPTY_REPORT })),
    },
    {
      method: 'POST',
      path: '/api/actions/preview/bulk',
      respond: () =>
        jsonOk({
          data: {
            senders: ['s1', 's2'].map((senderId) => ({
              senderId,
              name: senderId,
              protected: false,
              counts: {
                all: 20,
                olderThan30d: 0,
                olderThan90d: 0,
                olderThan180d: 0,
                olderThan365d: 0,
              },
            })),
            totals: { all: 40 },
            protectedCount: 0,
          },
        }),
    },
    {
      method: 'GET',
      path: '/api/snoozed',
      respond: () => (snoozed ? snoozed() : jsonOk({ data: [] })),
    },
    {
      method: 'POST',
      path: '/api/v1/sync/initial/retry',
      respond: (req) => {
        calls.retryMailbox = req.headers.get('X-Active-Mailbox-Id');
        return jsonOk({ data: { outcome: 'requeued' } });
      },
    },
  ]);
  return calls;
}

function renderHome(client: QueryClient = createTestQueryClient(), withToast = false) {
  render(
    <QueryClientProvider client={client}>
      {withToast ? <ToastHost /> : null}
      <HomeScreen />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  authCell.me = meFor('pro', 'ready');
});
afterEach(() => vi.restoreAllMocks());

describe('HomeScreen', () => {
  it('shows the unsubscribe step and the Later card from the mailbox reads', async () => {
    stub({
      report: () => jsonOk({ data: REPORT_WITH_FIX }),
      snoozed: () =>
        jsonOk({
          data: [
            {
              senderId: 'later-1',
              displayName: 'Ada',
              email: 'ada@example.com',
              domain: 'example.com',
              laterCount: 2,
              snoozedUntil: '2026-10-13T00:00:00.000Z',
              snoozedAt: '2026-10-01T00:00:00.000Z',
              reason: null,
              returnStatus: 'scheduled',
              lastReturnAttemptAt: null,
              returnFailureKind: null,
            },
          ],
        }),
    });
    renderHome();
    const unsubscribe = await screen.findByRole('button', {
      name: 'Preview cleanup',
    });
    expect(screen.getByRole('region', { name: 'Suggested next steps' })).toBeInTheDocument();
    expect(screen.getByText(/Each of those 29 senders had less than 10%/)).toBeInTheDocument();
    const lead = screen.getByText(/85% of the email/);
    expect(lead.closest('details')).not.toBeNull();
    expect(lead.closest('a')).toBeNull();
    const laterCard = screen.getByRole('link', { name: 'Open Later' }).closest('article');
    expect(laterCard).toHaveTextContent('Later');
    expect(laterCard).not.toHaveTextContent('1 sender');
    fireEvent.click(unsubscribe);
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Unsubscribe from 2 senders?');
  });

  it('confirming Unsubscribe + Archive sends the request and shows the toast', async () => {
    const posts: { body: unknown; mailbox: string | null }[] = [];
    const statusReads: string[] = [];
    stub({ report: () => jsonOk({ data: REPORT_WITH_FIX }) });
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions/unsubscribe-backlog',
        respond: async (req) => {
          posts.push({
            body: await req.json(),
            mailbox: req.headers.get('X-Active-Mailbox-Id'),
          });
          return jsonOk({
            data: {
              mode: 'archive',
              backlog: {
                actionId: 'act-1',
                handle: 'action',
                requestedCount: 40,
                verb: 'archive',
              },
              senders: [
                {
                  senderId: 's1',
                  method: 'one_click',
                  mailtoUrl: null,
                  executionActionId: null,
                  lifecycleStatus: null,
                  unsubStatus: 'requested',
                  reasonCode: null,
                },
                {
                  senderId: 's2',
                  method: 'one_click',
                  mailtoUrl: null,
                  executionActionId: null,
                  lifecycleStatus: null,
                  unsubStatus: 'requested',
                  reasonCode: null,
                },
              ],
            },
          });
        },
      },
      {
        method: 'GET',
        path: '/api/actions/act-1',
        respond: () => {
          statusReads.push('/api/actions/act-1');
          return jsonOk({
            data: {
              actionId: 'act-1',
              verb: 'archive',
              direction: 'forward',
              status: 'done',
              requestedCount: 40,
              affectedCount: 40,
              wakeAt: null,
              undoToken: 'undo-1',
              undoExpiresAt: '2026-11-11T00:00:00.000Z',
              undoExecutedAt: null,
              undoRevertedAt: null,
              errorCode: null,
            },
          });
        },
      },
    ]);
    renderHome(createTestQueryClient(), true);
    const copy = homeFixCopy();
    expect(copy).not.toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview cleanup' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: copy!.cancel }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(posts).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup' }));
    await waitFor(() => expect(screen.getByRole('button', { name: copy!.button })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: copy!.button }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      body: { mode: 'archive', senderIds: ['s1', 's2'] },
      mailbox: 'mb-1',
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByText(/Archived 40/)).toBeNull();
    expect(localStorage.getItem('dm-inbox-report-celebration:mb-1')).toBeNull();
    // The global progress owner resolves the accepted handle, not Home.
    expect(statusReads).toEqual([]);
    localStorage.removeItem('dm-inbox-report-celebration:mb-1');
  });

  it('shows the all-time cleared total without a Review today button', async () => {
    const calls = stub({ queueLength: 2, screenerPending: 4 });
    renderHome();

    expect(screen.getByRole('status', { name: 'Loading Home' })).toBeInTheDocument();
    expect(await screen.findByTestId('home-hero')).toHaveTextContent('1,234');
    expect(calls.summary).toEqual(['?window=all']);
    expect(screen.queryByRole('link', { name: /Review \d+ today/ })).toBeNull();
    expect(screen.queryByText('In inbox now')).toBeNull();
    expect(screen.queryByRole('link', { name: /Autopilot/ })).toBeNull();
    expect(calls.triage).toBe(0);
    expect(calls.screener).toBe(1);
  });

  it('prioritizes pending new sender review on Home', async () => {
    stub({ queueLength: 0, screenerPending: 4 });
    renderHome();
    expect(await screen.findByTestId('home-hero')).toHaveTextContent('1,234');
    expect(await screen.findByRole('link', { name: 'Review new senders' })).toHaveAttribute(
      'href',
      '/senders?view=first-review',
    );
  });

  it('shows cleanup totals without waiting on a removed review list', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    installFetchStub([
      {
        method: 'GET',
        path: '/api/home/visit',
        respond: () =>
          jsonOk({
            data: {
              visitId: '00000000-0000-4000-8000-000000000000',
              since: null,
              until: '2026-10-10T10:00:00.000Z',
              indexedEmails: null,
              indexedSenders: null,
            },
          }),
      },
      {
        method: 'POST',
        path: '/api/home/visit',
        respond: () => jsonOk({ data: { since: null, indexedEmails: null, indexedSenders: null } }),
      },
      {
        method: 'GET',
        path: '/api/v1/sync/status',
        respond: () =>
          jsonOk({
            data: { readiness_status: 'ready', is_ready_for_triage: true, progress_pct: 100 },
          }),
      },
      { method: 'GET', path: '/api/activity/summary', respond: () => jsonOk({ data: SUMMARY }) },
      {
        method: 'GET',
        path: '/api/triage/bootstrap',
        respond: async () => {
          await held;
          return jsonOk({ data: { queue: [], stats: {}, todaySummary: {} } });
        },
      },
      {
        method: 'GET',
        path: '/api/screener/count',
        respond: () => jsonOk({ data: { pending: 0 } }),
      },
      {
        method: 'GET',
        path: '/api/mailboxes/mb-1/inbox-report',
        respond: () => jsonOk({ data: EMPTY_REPORT }),
      },
      { method: 'GET', path: '/api/snoozed', respond: () => jsonOk({ data: [] }) },
    ]);
    renderHome();
    try {
      expect(await screen.findByTestId('home-hero', {}, { timeout: 300 })).toHaveTextContent(
        '1,234',
      );
      expect(screen.queryByText('Loading review tasks…')).toBeNull();
      expect(screen.queryByRole('link', { name: /Review \d+ today/ })).toBeNull();
    } finally {
      release();
    }
  });

  it('never reads the Screener for a tier without it', async () => {
    authCell.me = meFor('free', 'ready');
    const calls = stub({ screenerPending: 4 });
    renderHome();
    expect(await screen.findByTestId('home-hero')).toHaveTextContent('1,234');
    expect(calls.triage).toBe(0);
    expect(calls.screener).toBe(0);
  });

  it('shows an empty home without an achievement count or Review today', async () => {
    stub({ summary: () => jsonOk({ data: EMPTY_SUMMARY }), queueLength: 2 });
    renderHome();
    expect(await screen.findByText('Start your first cleanup.')).toBeInTheDocument();
    expect(screen.queryByTestId('home-hero')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Review 2 today' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Review senders' })).toHaveAttribute(
      'href',
      '/senders',
    );
  });

  it('new user: no number, a title and the senders link', async () => {
    stub({ summary: () => jsonOk({ data: EMPTY_SUMMARY }) });
    renderHome();
    expect(await screen.findByText('Start your first cleanup.')).toBeInTheDocument();
    expect(screen.queryByTestId('home-hero')).toBeNull();
    expect(screen.getByRole('link', { name: 'Review senders' })).toHaveAttribute(
      'href',
      '/senders',
    );
  });

  it('new user whose mailbox is still syncing', async () => {
    authCell.me = meFor('pro', 'syncing');
    stub({ summary: () => jsonOk({ data: EMPTY_SUMMARY }) });
    renderHome();
    expect(screen.queryByRole('heading', { name: 'Your Inbox Report' })).toBeNull();
    expect(
      await screen.findByRole('heading', { name: 'Scanning your Gmail…' }),
    ).toBeInTheDocument();
    expect(screen.getByText('You can close this tab and come back later.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review senders' })).toBeNull();
    expect(screen.queryByText('Waiting to start.')).toBeNull();
    expect(screen.getByTestId('home-scan-bar')).toBeInTheDocument();
  });

  it('syncing home shows the stage the status read reports', async () => {
    authCell.me = meFor('pro', 'syncing');
    stub({
      summary: () => jsonOk({ data: EMPTY_SUMMARY }),
      sync: { readiness_status: 'syncing', current_stage: 'fetching_metadata', progress_pct: 10 },
    });
    renderHome();
    expect(await screen.findByText('Collecting sender details.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review senders' })).toBeNull();
    expect(screen.queryByText('You can close this tab and come back later.')).toBeNull();
    expect(screen.queryByText('Waiting to start.')).toBeNull();
  });

  it('new user whose scan failed: says so and offers a scoped retry', async () => {
    authCell.me = meFor('pro', 'failed');
    const calls = stub({ summary: () => jsonOk({ data: EMPTY_SUMMARY }) });
    renderHome();
    expect(await screen.findByRole('heading', { name: HOME_DECK.failedTitle })).toBeInTheDocument();
    expect(screen.getByText(HOME_DECK.failedBody)).toBeInTheDocument();
    expect(screen.queryByText('Nothing cleared yet.')).toBeNull();
    expect(screen.queryByText('Gmail scan failed.')).toBeNull();
    expect(screen.getByRole('link', { name: HOME_DECK.failedHelp })).toHaveAttribute(
      'href',
      '/help',
    );
    fireEvent.click(screen.getByRole('button', { name: HOME_DECK.failedRetry }));
    await waitFor(() => {
      expect(calls.retryMailbox).toBe('mb-1');
    });
  });

  it('reports a queued scan without claiming a worker has started', async () => {
    authCell.me = meFor('pro', 'queued');
    stub({ summary: () => jsonOk({ data: EMPTY_SUMMARY }) });
    renderHome();
    expect(await screen.findByText('Your scan is waiting to start.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review senders' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Reading your Gmail…' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Reading your Gmail…' })).toBeNull();
    expect(screen.queryByText('Waiting to start.')).toBeNull();
  });

  it('a syncing mailbox with history still shows its number', async () => {
    authCell.me = meFor('pro', 'syncing');
    stub();
    renderHome();
    expect(await screen.findByTestId('home-hero')).toHaveTextContent('1,234');
  });

  it.each(['NO_ACTIVE_MAILBOX', 'SELECT_MAILBOX'])(
    'guard 409 %s renders the mailbox gate, not an error',
    async (code) => {
      stub({ summary: () => mailboxConflict(code) });
      renderHome();
      expect(await screen.findByTestId('no-active-mailbox')).toBeInTheDocument();
      expect(screen.queryByText(/couldn’t load Home/)).toBeNull();
    },
  );

  it('no active mailbox: the gate, and no mailbox-scoped read at all', async () => {
    authCell.me = meFor('pro', 'ready', null);
    const calls = stub();
    renderHome();
    expect(screen.getByTestId('no-active-mailbox')).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toEqual({ summary: [], triage: 0, screener: 0, retryMailbox: null });
  });

  it('server failure: error state, and Try again recovers', async () => {
    let fail = true;
    stub({ summary: () => (fail ? jsonServerError() : jsonOk({ data: SUMMARY })) });
    renderHome();
    expect(await screen.findByText(/couldn’t load Home/)).toBeInTheDocument();

    fail = false;
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByTestId('home-hero')).toHaveTextContent('1,234');
  });

  it('does not retry a 4xx under the production query client', async () => {
    const calls = stub({
      summary: () =>
        new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
    });
    renderHome(makeQueryClient());
    expect(await screen.findByText(/couldn’t load Home/)).toBeInTheDocument();
    expect(calls.summary).toHaveLength(1);
  });

  it('a mailbox switch drops the previous inbox report while the next one is loading', async () => {
    authCell.me = {
      ...meFor('pro', 'ready'),
      mailboxes: [
        {
          id: 'mb-1',
          email: 'me@example.com',
          status: 'active',
          connectedAt: null,
          readiness: 'ready',
        },
        {
          id: 'mb-2',
          email: 'other@example.com',
          status: 'active',
          connectedAt: null,
          readiness: 'ready',
        },
      ],
    };
    stub({ report: () => jsonOk({ data: REPORT_WITH_FIX }) });
    const releaseMb2: Array<(response: Response) => void> = [];
    addFetchHandlers([
      {
        method: 'GET',
        path: '/api/mailboxes/mb-2/inbox-report',
        respond: () =>
          new Promise<Response>((resolve) => {
            releaseMb2.push(resolve);
          }),
      },
    ]);
    const client = createTestQueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <HomeScreen />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/85% of the email/)).toBeInTheDocument();

    const details = screen.getByText('Details').closest('details')!;
    details.open = true;
    fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    authCell.me = { ...authCell.me, activeMailboxId: 'mb-2' };
    view.rerender(
      <QueryClientProvider client={client}>
        <HomeScreen />
      </QueryClientProvider>,
    );
    const reset = resetMailboxScopedCache(client);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(/85% of the email/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading Home' })).toBeInTheDocument();

    for (const release of releaseMb2) release(jsonOk({ data: EMPTY_REPORT }));
    await act(async () => {
      await reset;
    });
    view.unmount();
  });

  it('a mailbox switch refetches the numbers (scoped-cache reset)', async () => {
    let summary = SUMMARY;
    stub({ summary: () => jsonOk({ data: summary }) });
    const client = renderHome();
    expect(await screen.findByTestId('home-hero')).toHaveTextContent('1,234');

    summary = { ...SUMMARY, emailsByVerb: { ...SUMMARY.emailsByVerb, archive: 6, delete: 1 } };
    await act(async () => {
      await resetMailboxScopedCache(client);
    });
    await waitFor(() => expect(screen.getByTestId('home-hero')).toHaveTextContent('7'));
    expect(screen.queryByText('1,234')).toBeNull();
  });

  it('Undo refreshes Home and drops the tray line without a reload', async () => {
    const generatedAt = '2026-10-11T00:00:00.000Z';
    const keysFor = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);
    const reportFor = (n: number) => ({
      ...REPORT_WITH_FIX,
      generatedAt,
      fix: { senderKeys: keysFor(n), sendersCount: n, inboxEmailCount: 40 },
      fallbackSenderCount: n,
    });
    const celebrationKey = 'dm-inbox-report-celebration:mb-1';
    localStorage.setItem(
      celebrationKey,
      JSON.stringify({
        archived: 40,
        senders: 7,
        verb: 'archive',
        actionId: 'act-1',
        actionHandle: 'action',
        senderKeys: keysFor(7),
        fixGeneratedAt: generatedAt,
      }),
    );
    let liveCount = 7;
    const tray = {
      rows: [] as Array<{
        token: string;
        actionKind: 'archive';
        createdAt: string;
        expiresAt: string;
        groupId: string;
        senderCount: number;
        memberCount: number;
        affectedCount: number;
        members: Array<{
          token: string;
          actionKind: 'archive';
          senderName: string;
          affectedCount: number;
        }>;
      }>,
    };
    stub({ report: () => jsonOk({ data: reportFor(liveCount) }) });
    addFetchHandlers([
      {
        method: 'GET',
        path: '/api/actions/act-1',
        respond: () =>
          jsonOk({
            data: {
              actionId: 'act-1',
              verb: 'archive',
              direction: 'forward',
              status: 'done',
              requestedCount: 40,
              affectedCount: 40,
              wakeAt: null,
              undoToken: 'undo-1',
              undoExpiresAt: '2026-11-11T00:00:00.000Z',
              undoExecutedAt: null,
              undoRevertedAt: null,
              errorCode: null,
            },
          }),
      },
      {
        method: 'POST',
        path: '/api/undo/undo-tray',
        respond: () => {
          // Immediate revert: no reverse job, so the status poll's
          // reconcile cannot refresh Home or the tray. Shared Undo refresh must.
          liveCount = 20;
          tray.rows = [];
          return jsonOk({
            data: {
              token: 'undo-1',
              actionKind: 'archive',
              reverted: true,
              expired: false,
              revertedAt: '2026-10-12T00:00:00.000Z',
              actionId: null,
            },
          });
        },
      },
      {
        method: 'GET',
        path: '/api/undo',
        respond: () => jsonOk({ data: tray.rows, meta: { nextCursor: null, limit: 50 } }),
      },
      {
        method: 'GET',
        path: '/api/actions/active',
        respond: () => jsonOk({ data: [] }),
      },
    ]);
    const client = createTestQueryClient();
    render(
      <QueryClientProvider client={client}>
        <HomeScreen />
        <InboxReportFirstLanding mailboxId="mb-1" onResolved={vi.fn()} />
        <ProductUndoTray mailboxId="mb-1" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Preview cleanup' })).toBeInTheDocument();
    await waitFor(() => expect(client.getQueryData(undoKeys.tray('mb-1'))).toEqual([]));
    tray.rows = [
      {
        token: 'undo-tray',
        actionKind: 'archive',
        createdAt: '2026-10-12T00:00:00.000Z',
        expiresAt: '2026-11-12T00:00:00.000Z',
        groupId: 'grp-1',
        senderCount: 13,
        memberCount: 13,
        affectedCount: 863,
        members: [
          {
            token: 'member-1',
            actionKind: 'archive',
            senderName: 'Skyline Airways',
            affectedCount: 100,
          },
        ],
      },
    ];
    await act(async () => {
      await client.invalidateQueries({ queryKey: undoKeys.all });
    });
    const trayLine = () => document.querySelector('[data-dm-undo-tray="pill"]');
    await waitFor(() => expect(trayLine()).toHaveTextContent('Archived 863 emails'));
    expect(trayLine()).toHaveTextContent('13 senders');

    fireEvent.click(screen.getByRole('button', { name: /^Undo Archive/ }));

    await waitFor(() => expect(screen.getAllByText('20 senders worth reviewing.')).toHaveLength(1));
    await waitFor(() => expect(document.querySelector('[data-dm-undo-tray]')).toBeNull());
    expect(localStorage.getItem(celebrationKey)).toBeNull();
    localStorage.removeItem(celebrationKey);
  });

  // The reverse job reports done before the report cache and the job list
  // have rebuilt. The first refetch is that mid-rebuild read. A page that
  // only invalidates once keeps it for the query staleTime.
  it('Undo on Home replaces the mid-rebuild count and tray without navigating', async () => {
    const generatedAt = '2026-10-11T00:00:00.000Z';
    const keysFor = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);
    const reportFor = (n: number) => ({
      ...REPORT_WITH_FIX,
      generatedAt,
      fix: { senderKeys: keysFor(n), sendersCount: n, inboxEmailCount: 40 },
      fallbackSenderCount: n,
    });
    const celebrationKey = 'dm-inbox-report-celebration:mb-1';
    localStorage.setItem(
      celebrationKey,
      JSON.stringify({
        archived: 822,
        senders: 13,
        verb: 'archive',
        actionId: 'act-1',
        actionHandle: 'action',
        senderKeys: keysFor(13),
        fixGeneratedAt: generatedAt,
      }),
    );
    const state = {
      live: false,
      rows: [] as Array<Record<string, unknown>>,
      jobs: [] as Array<Record<string, unknown>>,
    };
    stub({ report: () => jsonOk({ data: reportFor(state.live ? 20 : 7) }) });
    addFetchHandlers([
      {
        method: 'GET',
        path: '/api/undo',
        respond: () =>
          jsonOk({ data: state.live ? [] : state.rows, meta: { nextCursor: null, limit: 50 } }),
      },
      {
        method: 'GET',
        path: '/api/actions/active',
        respond: () => jsonOk({ data: state.live ? [] : state.jobs }),
      },
      {
        method: 'POST',
        path: '/api/undo/undo-tray',
        respond: () =>
          jsonOk({
            data: {
              token: 'undo-tray',
              actionKind: 'archive',
              reverted: false,
              expired: false,
              revertedAt: null,
              actionId: 'rev-1',
            },
          }),
      },
      {
        method: 'GET',
        path: '/api/actions/rev-1',
        respond: () => {
          // Later than the invalidate this response schedules, earlier than
          // the rebuild poll. The first read stays stale; the next one is live.
          setTimeout(() => {
            state.live = true;
          }, 250);
          return jsonOk({
            data: {
              actionId: 'rev-1',
              verb: 'archive',
              direction: 'reverse',
              status: 'done',
              requestedCount: 822,
              affectedCount: 822,
              wakeAt: null,
              undoToken: null,
              undoExpiresAt: null,
              undoExecutedAt: null,
              undoRevertedAt: '2026-10-12T00:00:00.000Z',
              errorCode: null,
            },
          });
        },
      },
    ]);
    const client = createTestQueryClient();
    render(
      <QueryClientProvider client={client}>
        <HomeScreen />
        <ProductUndoTray mailboxId="mb-1" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Preview cleanup' })).toBeInTheDocument();
    await waitFor(() => expect(client.getQueryData(undoKeys.tray('mb-1'))).toEqual([]));
    state.rows = [
      {
        token: 'undo-tray',
        actionKind: 'archive',
        createdAt: '2026-10-12T00:00:00.000Z',
        expiresAt: '2026-11-12T00:00:00.000Z',
        groupId: 'grp-archive',
        senderCount: 13,
        memberCount: 13,
        affectedCount: 822,
        members: [
          {
            token: 'member-1',
            actionKind: 'archive',
            senderName: 'Skyline Airways',
            affectedCount: 100,
          },
        ],
      },
    ];
    state.jobs = Array.from({ length: 14 }, (_, i) => ({
      groupId: `unsub-${i}`,
      verb: 'unsubscribe',
      mixedVerbs: false,
      running: true,
      total: 1,
      done: 0,
      failed: 0,
      senderCount: 1,
      leadSenderName: `List ${i + 1}`,
      startedAt: '2026-10-12T00:00:00.000Z',
    }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: undoKeys.all });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Show all recent actions' }));
    const openTray = () => document.querySelector('[data-dm-undo-tray="open"]');
    await waitFor(() =>
      expect(openTray()).toHaveTextContent('Archived · 822 emails · Skyline Airways + 12 others'),
    );
    expect(document.querySelectorAll('[data-dm-tray-notice="working"]')).toHaveLength(14);

    fireEvent.click(
      screen.getByRole('button', { name: 'Undo Archive for Skyline Airways + 12 others' }),
    );

    await waitFor(
      () => {
        expect(
          screen.getByRole('heading', { name: /20 senders worth reviewing/ }),
        ).toBeInTheDocument();
        expect(client.getQueryData(undoKeys.tray('mb-1'))).toEqual([]);
        expect(client.getQueryData(undoKeys.inFlight('mb-1'))).toEqual([]);
        // Restoration keeps its progress line until reconciliation releases
        // the latch, which can finish after the fresh query data renders.
        expect(document.querySelectorAll('[data-dm-tray-notice="working"]')).toHaveLength(0);
      },
      // Shorter than the tray's own 2s job poll. That poll would eventually
      // re-read the report when the jobs stop; this wait ends first, so a
      // single invalidate still leaves the mid-rebuild count on screen.
      { timeout: 1_200 },
    );
    expect(screen.queryByText(/Skyline Airways/)).toBeNull();
    expect(localStorage.getItem(celebrationKey)).toBeNull();
    localStorage.removeItem(celebrationKey);
  });

  it('shared Undo refreshes the compact snapshot without navigating', async () => {
    const generatedAt = '2026-10-11T00:00:00.000Z';
    const keysFor = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);
    const reportFor = (n: number) => ({
      ...REPORT_WITH_FIX,
      generatedAt,
      fix: { senderKeys: keysFor(n), sendersCount: n, inboxEmailCount: 40 },
      fallbackSenderCount: n,
    });
    const celebrationKey = 'dm-inbox-report-celebration:mb-1';
    localStorage.setItem(
      celebrationKey,
      JSON.stringify({
        archived: 471,
        senders: 13,
        verb: 'archive',
        actionId: 'act-1',
        actionHandle: 'action',
        senderKeys: keysFor(13),
        fixGeneratedAt: generatedAt,
      }),
    );
    const state = {
      live: false,
      rows: [] as Array<Record<string, unknown>>,
      jobs: [] as Array<Record<string, unknown>>,
    };
    installFetchStub([
      {
        method: 'GET',
        path: '/api/mailboxes/mb-1/inbox-report',
        respond: () => jsonOk({ data: reportFor(state.live ? 20 : 13) }),
      },
      {
        method: 'GET',
        path: '/api/actions/act-1',
        respond: () =>
          jsonOk({
            data: {
              actionId: 'act-1',
              verb: 'archive',
              direction: 'forward',
              status: 'done',
              requestedCount: 471,
              affectedCount: 471,
              wakeAt: null,
              undoToken: 'undo-celebrate',
              undoExpiresAt: '2026-11-11T00:00:00.000Z',
              undoExecutedAt: null,
              undoRevertedAt: null,
              errorCode: null,
            },
          }),
      },
      {
        method: 'GET',
        path: '/api/undo',
        respond: () =>
          jsonOk({ data: state.live ? [] : state.rows, meta: { nextCursor: null, limit: 50 } }),
      },
      {
        method: 'GET',
        path: '/api/actions/active',
        respond: () => jsonOk({ data: state.live ? [] : state.jobs }),
      },
      {
        method: 'POST',
        path: '/api/undo/undo-tray',
        respond: () =>
          jsonOk({
            data: {
              token: 'undo-tray',
              actionKind: 'archive',
              reverted: false,
              expired: false,
              revertedAt: null,
              actionId: 'rev-1',
            },
          }),
      },
      {
        method: 'GET',
        path: '/api/actions/rev-1',
        respond: () => {
          setTimeout(() => {
            state.live = true;
          }, 250);
          return jsonOk({
            data: {
              actionId: 'rev-1',
              verb: 'archive',
              direction: 'reverse',
              status: 'done',
              requestedCount: 471,
              affectedCount: 471,
              wakeAt: null,
              undoToken: null,
              undoExpiresAt: null,
              undoExecutedAt: null,
              undoRevertedAt: '2026-10-12T00:00:00.000Z',
              errorCode: null,
            },
          });
        },
      },
    ]);
    const client = createTestQueryClient();
    render(
      <QueryClientProvider client={client}>
        <InboxReportFirstLanding mailboxId="mb-1" onResolved={vi.fn()} />
        <ProductUndoTray mailboxId="mb-1" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('13 senders worth reviewing.')).toBeInTheDocument();
    expect(screen.queryByText('Archived 471 emails from 13 senders.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unsubscribe + archive 13 senders' })).toBeNull();
    await waitFor(() => expect(client.getQueryData(undoKeys.tray('mb-1'))).toEqual([]));
    state.rows = [
      {
        token: 'undo-tray',
        actionKind: 'archive',
        createdAt: '2026-10-12T00:00:00.000Z',
        expiresAt: '2026-11-12T00:00:00.000Z',
        groupId: 'grp-archive',
        senderCount: 8,
        memberCount: 8,
        affectedCount: 471,
        members: [
          {
            token: 'member-1',
            actionKind: 'archive',
            senderName: 'Pixel Games Store',
            affectedCount: 80,
          },
        ],
      },
    ];
    state.jobs = Array.from({ length: 14 }, (_, i) => ({
      groupId: `unsub-${i}`,
      verb: 'unsubscribe',
      mixedVerbs: false,
      running: true,
      total: 1,
      done: 0,
      failed: 0,
      senderCount: 1,
      leadSenderName: `List ${i + 1}`,
      startedAt: '2026-10-12T00:00:00.000Z',
    }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: undoKeys.all });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Show all recent actions' }));
    await waitFor(() =>
      expect(document.querySelector('[data-dm-undo-tray="open"]')).toHaveTextContent(
        'Archived · 471 emails · Pixel Games Store + 7 others',
      ),
    );
    expect(document.querySelectorAll('[data-dm-tray-notice="working"]')).toHaveLength(14);

    fireEvent.click(
      screen.getByRole('button', { name: 'Undo Archive for Pixel Games Store + 7 others' }),
    );

    await waitFor(
      () => {
        expect(screen.getByText('20 senders worth reviewing.')).toBeInTheDocument();
        expect(document.querySelector('[data-celebration]')).toBeNull();
        expect(client.getQueryData(undoKeys.tray('mb-1'))).toEqual([]);
        expect(client.getQueryData(undoKeys.inFlight('mb-1'))).toEqual([]);
        expect(document.querySelectorAll('[data-dm-tray-notice="working"]')).toHaveLength(0);
      },
      { timeout: 1_200 },
    );
    expect(screen.queryByText(/Pixel Games Store/)).toBeNull();
    expect(localStorage.getItem(celebrationKey)).toBeNull();
    localStorage.removeItem(celebrationKey);
  });
});
