/**
 * Tests for `FollowupsScreen` (D90, D91).
 *
 * Covers the three first-class edge branches per D211 / D212 (loading,
 * error, empty) and the populated-list branch with priority grouping.
 * Also pins the D91 empty-state copy so a future microcopy edit can
 * only land via a deliberate test update.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { FollowupsScreen, recipientLine, relativeTime, truncate } from './followups-screen';

vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => ({ me: {} }),
  getActiveMailboxEmail: () => 'active+mailbox@example.com',
}));

const NOW = new Date('2026-05-25T08:00:00Z').getTime();

const ROW_HIGH = {
  id: 'h1',
  providerThreadId: 'thread-h1',
  recipientEmail: 'boss@example.com',
  recipientDisplayName: 'Big Boss',
  subject: 'Q4 plans — please review',
  sentAt: new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString(),
  priority: 'high' as const,
  status: 'awaiting' as const,
  dismissedAt: null,
  createdAt: new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString(),
  updatedAt: new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString(),
};

const ROW_LOW = {
  ...ROW_HIGH,
  id: 'l1',
  providerThreadId: 'thread-l1',
  recipientEmail: 'peer@example.com',
  recipientDisplayName: 'Peer',
  subject: 'Lunch?',
  sentAt: new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString(),
  priority: 'low' as const,
};

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <FollowupsScreen />
    </QueryWrapper>,
  );
}

describe('FollowupsScreen — edge states', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('shows a loading skeleton while the initial fetch is in-flight', () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => new Promise<Response>(() => {}),
      },
    ]);

    renderScreen();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the error branch with a retry CTA on 500', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => jsonServerError(),
      },
    ]);

    renderScreen();
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /couldn[’']t load your followups/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('D91 — renders the empty state with the canonical copy when no followups await', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => jsonOk({ data: [] }),
      },
    ]);

    renderScreen();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /no follow-ups waiting\./i })).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/we watch your sent folder for emails that haven/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/nothing.s overdue right now\./i)).toBeInTheDocument();
  });
});

describe('FollowupsScreen — populated list', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('renders the stats summary line + grouped sections per D90', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => jsonOk({ data: [ROW_HIGH, ROW_LOW] }),
      },
    ]);

    renderScreen();

    // Stats summary line — total + "over a week" counts.
    await waitFor(() => expect(screen.getByText(/2 threads awaiting reply/i)).toBeInTheDocument());
    expect(screen.getByText(/1 over a week/i)).toBeInTheDocument();

    // Both priority group headings render.
    expect(screen.getByRole('heading', { name: /over a week · 1/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /1.3 days · 1/i })).toBeInTheDocument();

    // Each row renders recipient + subject + Open-in-Gmail link.
    expect(screen.getByText('Big Boss')).toBeInTheDocument();
    expect(screen.getByText('Q4 plans — please review')).toBeInTheDocument();
    expect(screen.getByText('Lunch?')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /open in gmail/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/?authuser=active%2Bmailbox%40example.com#all/thread-h1',
    );
    expect(links[0]?.getAttribute('href')).not.toContain('/u/0');
  });
});

describe('FollowupsScreen — D88 dismiss', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  function dismissResult(id: string, alreadyDismissed = false) {
    return jsonOk({
      data: {
        id,
        status: 'dismissed',
        dismissedAt: new Date(NOW).toISOString(),
        alreadyDismissed,
      },
    });
  }

  it('removes the row optimistically and POSTs to the dismiss endpoint', async () => {
    let listCalls = 0;
    let dismissCalls = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => {
          listCalls += 1;
          return jsonOk({ data: dismissCalls > 0 ? [ROW_LOW] : [ROW_HIGH, ROW_LOW] });
        },
      },
      {
        method: 'POST',
        path: `/api/followups/${ROW_HIGH.id}/dismiss`,
        respond: () => {
          dismissCalls += 1;
          return dismissResult(ROW_HIGH.id);
        },
      },
    ]);

    renderScreen();
    await waitFor(() => expect(screen.getByText('Big Boss')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /mark resolved — big boss/i }));

    // Optimistic removal — the row leaves without waiting for the POST.
    await waitFor(() => expect(screen.queryByText('Big Boss')).not.toBeInTheDocument());
    // The sibling row stays put.
    expect(screen.getByText('Peer')).toBeInTheDocument();
    // The mutation actually hit the wire and server truth was refetched
    // (success invalidates the list).
    await waitFor(() => expect(dismissCalls).toBe(1));
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
    // Stats summary reflects the surviving row.
    expect(screen.getByText(/1 thread awaiting reply/i)).toBeInTheDocument();
  });

  it('transitions to the D91 empty state when the last row is dismissed', async () => {
    let dismissed = false;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => jsonOk({ data: dismissed ? [] : [ROW_HIGH] }),
      },
      {
        method: 'POST',
        path: `/api/followups/${ROW_HIGH.id}/dismiss`,
        respond: () => {
          dismissed = true;
          return dismissResult(ROW_HIGH.id);
        },
      },
    ]);

    renderScreen();
    await waitFor(() => expect(screen.getByText('Big Boss')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /mark resolved/i }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /no follow-ups waiting\./i })).toBeInTheDocument(),
    );
    expect(screen.queryByText('Big Boss')).not.toBeInTheDocument();
  });

  it('rolls the row back when the dismiss fails', async () => {
    // Hold the 500 behind a manual deferred so the optimistic removal
    // is observable before the failure lands.
    let releaseFailure: () => void = () => {};
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => jsonOk({ data: [ROW_HIGH, ROW_LOW] }),
      },
      {
        method: 'POST',
        path: `/api/followups/${ROW_HIGH.id}/dismiss`,
        respond: async () => {
          await failureGate;
          return jsonServerError();
        },
      },
    ]);

    renderScreen();
    await waitFor(() => expect(screen.getByText('Big Boss')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /mark resolved — big boss/i }));

    // Optimistic removal first…
    await waitFor(() => expect(screen.queryByText('Big Boss')).not.toBeInTheDocument());
    releaseFailure();
    // …then the 500 rolls the snapshot back — the row returns, nothing
    // pretends to have worked.
    await waitFor(() => expect(screen.getByText('Big Boss')).toBeInTheDocument());
    expect(screen.getByText(/2 threads awaiting reply/i)).toBeInTheDocument();
  });
});

describe('FollowupsScreen — pure helpers', () => {
  it('recipientLine prefers display name, falls back to email', () => {
    expect(
      recipientLine({ recipientDisplayName: 'Big Boss', recipientEmail: 'boss@example.com' }),
    ).toEqual({ name: 'Big Boss', domain: 'example.com' });
    expect(
      recipientLine({ recipientDisplayName: '   ', recipientEmail: 'boss@example.com' }),
    ).toEqual({ name: 'boss@example.com', domain: 'example.com' });
  });

  it('truncate respects the 60-char limit per D90', () => {
    expect(truncate('short subject', 60)).toBe('short subject');
    const long = 'a'.repeat(80);
    const truncated = truncate(long, 60);
    expect(truncated.length).toBe(60);
    expect(truncated.endsWith('…')).toBe(true);
  });

  it('relativeTime buckets the common cases', () => {
    expect(relativeTime(new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString(), NOW)).toBe(
      '10d ago',
    );
    expect(relativeTime(new Date(NOW - 5 * 60 * 60 * 1000).toISOString(), NOW)).toBe('5h ago');
    expect(relativeTime(new Date(NOW - 90 * 1000).toISOString(), NOW)).toBe('1m ago');
    expect(relativeTime(new Date(NOW).toISOString(), NOW)).toBe('just now');
  });
});
