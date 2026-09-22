import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';

import type { Me } from '@/features/auth/api/me-contract';
import { resetMailboxScopedCache } from '@/features/mailboxes/api/reset-mailbox-cache';
import { makeQueryClient } from '@/lib/query-client';
import { installFetchStub, jsonOk, jsonServerError } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';

import { HomeScreen } from './home-screen';

const authCell: { me: Me } = { me: meFor('pro', 'ready') };

vi.mock('@/features/auth/auth-provider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ me: authCell.me }) };
});
vi.mock('@/features/mailboxes/no-active-mailbox', () => ({
  NoActiveMailbox: () => <div data-testid="no-active-mailbox" />,
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

interface Stub {
  summary?: () => Response;
  queueLength?: number;
  screenerPending?: number;
}

function stub({ summary, queueLength = 0, screenerPending = 0 }: Stub = {}) {
  const calls = { summary: [] as string[], triage: 0, screener: 0 };
  installFetchStub([
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
  ]);
  return calls;
}

function renderHome(client: QueryClient = createTestQueryClient()) {
  render(
    <QueryClientProvider client={client}>
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
  it('shows the all-time cleared total and continues Triage', async () => {
    const calls = stub({ queueLength: 2, screenerPending: 4 });
    renderHome();

    expect(screen.getByRole('status', { name: 'Loading Home' })).toBeInTheDocument();
    expect(await screen.findByTestId('home-hero')).toHaveTextContent('1,234');
    expect(calls.summary).toEqual(['?window=all']);
    const link = screen.getByRole('link', { name: 'Review 2 today' });
    expect(link).toHaveAttribute('href', '/triage');
    expect(link).toHaveTextContent('Review 2 today');
    expect(screen.getByRole('link', { name: /Journal 0/ })).toHaveAttribute(
      'href',
      '/senders?sender=sender-0',
    );
    expect(screen.getByText('Last 90 days')).toBeInTheDocument();
    expect(calls.triage).toBe(1);
  });

  it('offers the Screener when Triage is clear', async () => {
    stub({ queueLength: 0, screenerPending: 4 });
    renderHome();
    const link = await screen.findByRole('link', { name: 'Review 4 new' });
    expect(link).toHaveAttribute('href', '/screener');
    expect(link).toHaveTextContent('Review 4 new');
  });

  it('never reads the Screener for a tier without it', async () => {
    authCell.me = meFor('free', 'ready');
    const calls = stub({ screenerPending: 4 });
    renderHome();
    expect(await screen.findByRole('link', { name: 'Review senders' })).toHaveAttribute(
      'href',
      '/senders',
    );
    expect(calls.triage).toBe(1);
    expect(calls.screener).toBe(0);
  });

  it('shows existing review work before any cleanup history, without an achievement count', async () => {
    stub({ summary: () => jsonOk({ data: EMPTY_SUMMARY }), queueLength: 2 });
    renderHome();
    expect(await screen.findByRole('link', { name: /Journal 0/ })).toHaveAttribute(
      'href',
      '/senders?sender=sender-0',
    );
    expect(screen.queryByTestId('home-hero')).toBeNull();
    expect(screen.getByRole('link', { name: 'Review 2 today' })).toBeInTheDocument();
  });

  it('new user: no number, a title and the button', async () => {
    stub({ summary: () => jsonOk({ data: EMPTY_SUMMARY }) });
    renderHome();
    expect(await screen.findByText('Nothing cleared yet')).toBeInTheDocument();
    expect(screen.queryByTestId('home-hero')).toBeNull();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/senders');
  });

  it('new user whose mailbox is still syncing', async () => {
    authCell.me = meFor('pro', 'syncing');
    stub({ summary: () => jsonOk({ data: EMPTY_SUMMARY }) });
    renderHome();
    expect(await screen.findByText('Reading your inbox')).toBeInTheDocument();
  });

  it('new user whose scan failed: says so and links to Gmail accounts', async () => {
    authCell.me = meFor('pro', 'failed');
    stub({ summary: () => jsonOk({ data: EMPTY_SUMMARY }) });
    renderHome();
    expect(await screen.findByText('Gmail scan failed')).toBeInTheDocument();
    expect(screen.queryByText('Nothing cleared yet')).toBeNull();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/settings#mailboxes');
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
      expect(screen.queryByText(/couldn't load Home/)).toBeNull();
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
    expect(calls).toEqual({ summary: [], triage: 0, screener: 0 });
  });

  it('server failure: error state, and Try again recovers', async () => {
    let fail = true;
    stub({ summary: () => (fail ? jsonServerError() : jsonOk({ data: SUMMARY })) });
    renderHome();
    expect(await screen.findByText(/couldn't load Home/)).toBeInTheDocument();

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
    expect(await screen.findByText(/couldn't load Home/)).toBeInTheDocument();
    expect(calls.summary).toHaveLength(1);
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
});
