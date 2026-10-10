/**
 * Tests for `FollowupsScreen` (D90, D91).
 *
 * Covers the three first-class edge branches per D211 / D212 (loading,
 * error, empty) and the populated-list branch with priority grouping.
 * Also pins D245's observation-window and resolution copy so the screen
 * cannot drift back to implying live Gmail or confirmed recipient state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import {
  FollowupsScreen,
  FollowupListItem,
  recipientLine,
  relativeTime,
  truncate,
} from './followups-screen';
import { followupsKeys } from './api/query-keys';

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
  feedbackRating: null,
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

describe('Followups evaluation clock', () => {
  afterEach(() => vi.useRealTimers());

  it('ages while mounted and accepts a new observation on the same row', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const row = { ...ROW_HIGH, lastEvaluatedAt: new Date(NOW - 5 * 60_000).toISOString() };
    const client = createTestQueryClient();
    const view = (nextRow: typeof row) => (
      <QueryWrapper client={client}>
        <FollowupListItem row={nextRow} mailboxEmail={null} />
      </QueryWrapper>
    );
    const { rerender } = render(view(row));
    expect(screen.getByText('Evaluated 5m ago')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('Evaluated 6m ago')).toBeInTheDocument();
    // Arrives between interval ticks, newer than the previous display clock.
    vi.setSystemTime(NOW + 90_000);
    rerender(view({ ...row, lastEvaluatedAt: new Date(NOW + 89_000).toISOString() }));
    expect(screen.queryByText('Evaluation time unavailable.')).not.toBeInTheDocument();
    expect(screen.getByText(/Evaluated/)).toHaveAttribute(
      'datetime',
      new Date(NOW + 89_000).toISOString(),
    );
  });
});

describe('FollowupsScreen — edge states', () => {
  it('shows a recorded evaluation as indexed-data evidence behind disclosure', async () => {
    const stamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => jsonOk({ data: [{ ...ROW_HIGH, lastEvaluatedAt: stamp }] }),
      },
    ]);
    renderScreen();
    const evaluated = await screen.findByText(/Evaluated .*ago/);
    expect(evaluated).toHaveAttribute('datetime', stamp);
    expect(evaluated.closest('details')).not.toHaveAttribute('open');
    expect(evaluated.closest('p')).toHaveTextContent(
      'from indexed mail. New replies may still be syncing.',
    );
    expect(screen.getByText(/Counts cover shown conversations, up to 100/)).toBeInTheDocument();
    expect(screen.queryByText(/Gmail checked|synced .*ago/i)).not.toBeInTheDocument();
  });

  it.each([undefined, null, 'invalid', '2999-01-01T00:00:00Z'])(
    'keeps unavailable or future evaluation evidence unknown (%s)',
    async (lastEvaluatedAt) => {
      installFetchStub([
        {
          method: 'GET',
          path: '/api/followups',
          respond: () => jsonOk({ data: [{ ...ROW_HIGH, lastEvaluatedAt }] }),
        },
      ]);
      renderScreen();
      expect(await screen.findByText(/Evaluation time unavailable/)).toBeInTheDocument();
      expect(screen.queryByText(/Evaluated .*ago/)).not.toBeInTheDocument();
    },
  );
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

  it('renders an alert on 500 and recovers the follow-up list when Retry succeeds', async () => {
    let attempts = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => {
          attempts += 1;
          return attempts === 1 ? jsonServerError() : jsonOk({ data: [ROW_LOW] });
        },
      },
    ]);

    renderScreen();
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: /couldn[’']t load your follow-ups/i }),
    ).toBeInTheDocument();
    expect(within(alert).getByText(/tracked follow-ups are unchanged/i)).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Lunch?')).toBeInTheDocument();
    expect(attempts).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps loaded conversations and expanded subjects after a failed background read', async () => {
    const subject =
      'A long conversation subject that exceeds sixty characters and stays expanded while the refresh is unavailable';
    let fail = false;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => (fail ? jsonServerError() : jsonOk({ data: [{ ...ROW_HIGH, subject }] })),
      },
    ]);
    const client = createTestQueryClient();
    render(
      <QueryWrapper client={client}>
        <FollowupsScreen />
      </QueryWrapper>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Read full subject' }));
    fail = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: followupsKeys.list() });
    });
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByText('Big Boss')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse subject' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(retry.closest('[role="status"]')).toHaveTextContent(/couldn.t refresh/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Collapse subject' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('does not retain conversations after a mailbox-scope refusal', async () => {
    let fail = false;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () =>
          fail
            ? new Response(JSON.stringify({ error: { code: 'NO_ACTIVE_MAILBOX' } }), {
                status: 409,
                headers: { 'content-type': 'application/json' },
              })
            : jsonOk({ data: [ROW_HIGH] }),
      },
    ]);
    const client = createTestQueryClient();
    render(
      <QueryWrapper client={client}>
        <FollowupsScreen />
      </QueryWrapper>,
    );
    await screen.findByText('Big Boss');
    fail = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: followupsKeys.list() });
    });
    await screen.findByRole('alert');
    expect(screen.queryByText('Big Boss')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the observation window in the empty state when no followups await', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => jsonOk({ data: [] }),
      },
    ]);

    renderScreen();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^no follow-ups$/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/last 60 days/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('FollowupsScreen — populated list', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('sets aside feedback-marked false positives and lets the user review them again', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => jsonOk({ data: [ROW_HIGH, { ...ROW_LOW, feedbackRating: 'not_followup' }] }),
      },
    ]);
    renderScreen();
    expect(await screen.findByText('Big Boss')).toBeInTheDocument();
    expect(screen.queryByText('Peer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 marked not a follow-up' }));
    expect(screen.getByText('Peer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide 1 marked not a follow-up' }));
    expect(screen.queryByText('Peer')).not.toBeInTheDocument();
  });

  it('does not call a fully set-aside queue empty of tracked conversations', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => jsonOk({ data: [{ ...ROW_LOW, feedbackRating: 'not_followup' }] }),
      },
    ]);
    renderScreen();
    expect(
      await screen.findByRole('heading', { name: 'No follow-ups to review' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/current suggestions were marked not a follow-up/)).toBeInTheDocument();
  });

  it('retains the full subject and exposes expansion without needing a hover tooltip', async () => {
    const subject =
      'A longer conversation subject about the upcoming launch and the final details that need a response';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => jsonOk({ data: [{ ...ROW_HIGH, subject }] }),
      },
    ]);
    renderScreen();
    const expand = await screen.findByRole('button', { name: 'Read full subject' });
    expect(screen.getByText(subject)).toBeInTheDocument();
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(expand);
    expect(screen.getByRole('button', { name: 'Collapse subject' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(document.getElementById(expand.getAttribute('aria-controls')!)).toHaveTextContent(
      subject,
    );
  });

  it('renders the header + grouped sections per D90', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => jsonOk({ data: [ROW_HIGH, ROW_LOW] }),
      },
    ]);

    renderScreen();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Follow-ups' }),
    ).toBeInTheDocument();

    await screen.findByText('Big Boss');
    // Both priority group headings render, each carrying its count once.
    expect(screen.getByRole('heading', { name: /over a week 1/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /1.3 days 1/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review first 1 over a week/i })).toHaveAttribute(
      'href',
      '#followups-overdue',
    );
    expect(screen.getByRole('link', { name: /keep an eye on 1 more recent/i })).toHaveAttribute(
      'href',
      '#followups-recent',
    );

    // Each row renders recipient + subject + Open-in-Gmail link.
    expect(await screen.findByText('Big Boss')).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: /useful follow-up/i })).toHaveLength(2);
    expect(screen.getByText('Q4 plans — please review')).toBeInTheDocument();
    expect(screen.getByText('Lunch?')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /open in gmail/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/?authuser=active%2Bmailbox%40example.com#all/thread-h1',
    );
    expect(links[0]?.getAttribute('href')).not.toContain('/u/0');
    const sentTime = document.querySelector(`time[datetime="${ROW_HIGH.sentAt}"]`);
    expect(sentTime).toHaveTextContent(/^Sent /);
  });

  it('explains observed state, refresh timing, and the false-positive control', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/followups',
        respond: () => jsonOk({ data: [ROW_HIGH] }),
      },
    ]);

    renderScreen();

    // The two behaviour-changing facts stay visible beside the list.
    const note = await screen.findByText(/about every six hours/i);
    expect(note).toHaveTextContent(/recent reply can still show/i);
    expect(screen.getByText(/nothing changes in Gmail/i)).toBeInTheDocument();
    expect(note).toHaveTextContent(/check the thread in Gmail before following up/i);
    expect(
      await screen.findByRole('button', {
        name: /mark resolved in declutrmail — big boss/i,
      }),
    ).toHaveAttribute('title', 'Mark resolved in DeclutrMail');
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

    fireEvent.click(
      screen.getByRole('button', { name: /mark resolved in declutrmail — big boss/i }),
    );

    // Optimistic removal — the row leaves without waiting for the POST.
    await waitFor(() => expect(screen.queryByText('Big Boss')).not.toBeInTheDocument());
    // The sibling row stays put.
    expect(screen.getByText('Peer')).toBeInTheDocument();
    // The mutation actually hit the wire and server truth was refetched
    // (success invalidates the list).
    await waitFor(() => expect(dismissCalls).toBe(1));
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
    // The emptied group's heading goes with its last row.
    expect(screen.queryByRole('heading', { name: /over a week/i })).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /mark resolved in declutrmail/i }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^no follow-ups$/i })).toBeInTheDocument(),
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

    fireEvent.click(
      screen.getByRole('button', { name: /mark resolved in declutrmail — big boss/i }),
    );

    // Optimistic removal first…
    await waitFor(() => expect(screen.queryByText('Big Boss')).not.toBeInTheDocument());
    releaseFailure();
    // …then the 500 triggers a fresh server read — the row returns, nothing
    // pretends to have worked.
    await waitFor(() => expect(screen.getByText('Big Boss')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /over a week 1/i })).toBeInTheDocument();
  });
});

it('shows a retryable error rather than false absence when dismissal and reconciliation both fail', async () => {
  let dismissed = false;
  let readsFail = false;
  installFetchStub([
    {
      method: 'GET',
      path: '/api/followups',
      respond: () => (readsFail ? jsonServerError() : jsonOk({ data: [ROW_HIGH] })),
    },
    {
      method: 'POST',
      path: `/api/followups/${ROW_HIGH.id}/dismiss`,
      respond: () => {
        dismissed = true;
        readsFail = true;
        return jsonServerError();
      },
    },
  ]);
  renderScreen();
  fireEvent.click(await screen.findByRole('button', { name: /mark resolved in declutrmail/i }));
  await waitFor(() => expect(dismissed).toBe(true));
  expect(
    await screen.findByRole('heading', { name: /couldn[’']t load your follow-ups/i }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /^no follow-ups$/i })).not.toBeInTheDocument();
  expect(
    screen.queryByText('No tracked conversation is waiting on a reply.'),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Marked resolved|Feedback saved/)).not.toBeInTheDocument();
  readsFail = false;
  fireEvent.click(screen.getByRole('button', { name: /try again/i }));
  expect(await screen.findByText('Big Boss')).toBeInTheDocument();
  resetFetchStub();
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
