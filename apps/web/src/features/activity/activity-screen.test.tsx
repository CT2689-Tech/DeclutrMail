/**
 * Tests for `ActivityScreen` (D55-D60, tracer-bullet).
 *
 * Covers:
 *   - D211 / D212 edge branches: loading, error, empty, populated
 *   - D55 default window (30d) when ?window= absent
 *   - D56 source filter chip click drives the URL + refetch
 *   - D58 undo state rendering — available / executed / expired /
 *     unavailable each map to the right affordance
 *   - D59 stats header renders the verb-aggregated counts
 *   - Pure helper (relativeTime) bucket boundaries
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { ActivityScreen, relativeTime } from './activity-screen';
import type { ActivityRowWire, ActivityStatsWire } from '@/lib/api/activity';

const NOW = new Date('2026-05-25T08:00:00Z').getTime();

// next/navigation shim — the screen reads useSearchParams + uses
// useRouter().replace to drive filter URL state.
const replaceMock = vi.fn();
let currentSearch = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const STATS_BASE: ActivityStatsWire = {
  archived: 12,
  unsubscribed: 4,
  kept: 3,
  later: 1,
  followupsDismissed: 0,
  needsAttention: 0,
};

function row(partial: Partial<ActivityRowWire>): ActivityRowWire {
  return {
    id: partial.id ?? 'a-1',
    occurredAt: partial.occurredAt ?? new Date(NOW - 1 * 60 * 60 * 1000).toISOString(),
    source: partial.source ?? 'manual',
    action: partial.action ?? 'archive',
    affectedCount: partial.affectedCount ?? 1,
    sender:
      partial.sender ??
      ({
        senderKey: 'sk-1',
        displayName: 'Sender One',
        email: 'one@example.com',
        domain: 'example.com',
      } as ActivityRowWire['sender']),
    undoState: partial.undoState ?? { kind: 'unavailable' },
  };
}

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <ActivityScreen />
    </QueryWrapper>,
  );
}

beforeEach(() => {
  installFetchStub([]);
  replaceMock.mockReset();
  currentSearch = '';
});
afterEach(() => resetFetchStub());

describe('ActivityScreen — edge states', () => {
  it('shows loading skeleton while the fetch is in-flight', () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => new Promise<Response>(() => {}),
      },
    ]);
    renderScreen();
    // The status region is the loading skeleton wrapper.
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('renders the error branch on 500 with a retry CTA', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => jsonServerError(),
      },
    ]);
    renderScreen();
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /couldn[’']t load your activity/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('renders the empty state when the page is empty', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              stats: STATS_BASE,
              window: '30d',
              source: 'all',
            },
          }),
      },
    ]);
    renderScreen();
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /no activity in this window/i }),
      ).toBeInTheDocument(),
    );
  });
});

describe('ActivityScreen — populated', () => {
  it('renders the D59 stats line with verb counts', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [row({})],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              stats: STATS_BASE,
              window: '30d',
              source: 'all',
            },
          }),
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText(/12 archived/i)).toBeInTheDocument());
    expect(screen.getByText(/4 unsubscribed/i)).toBeInTheDocument();
    expect(screen.getByText(/3 kept/i)).toBeInTheDocument();
  });

  it('D55 defaults to window=30d when no ?window= present', async () => {
    let observedUrl = '';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: (req, url) => {
          observedUrl = url.search;
          return jsonOk({
            data: [],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              stats: STATS_BASE,
              window: '30d',
              source: 'all',
            },
          });
        },
      },
    ]);
    renderScreen();
    await waitFor(() => expect(observedUrl).toContain('window=30d'));
  });

  it('D56 source chip click drives router.replace with ?source=', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              stats: STATS_BASE,
              window: '30d',
              source: 'all',
            },
          }),
      },
    ]);
    renderScreen();
    // Wait for the chips to mount.
    const triage = await screen.findByRole('button', { name: 'Triage' });
    await userEvent.click(triage);
    expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining('source=triage'));
  });
});

describe('ActivityScreen — D58 undo affordances', () => {
  it('renders "Undo →" button for `available`', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [
              row({
                undoState: {
                  kind: 'available',
                  token: '11111111-1111-1111-1111-111111111111',
                  expiresAt: new Date(NOW + 24 * 60 * 60 * 1000).toISOString(),
                },
              }),
            ],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              stats: STATS_BASE,
              window: '30d',
              source: 'all',
            },
          }),
      },
    ]);
    renderScreen();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /undo →/i })).toBeInTheDocument(),
    );
  });

  it('renders UNDONE pill for `executed`', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [
              row({
                undoState: { kind: 'executed', executedAt: new Date(NOW).toISOString() },
              }),
            ],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              stats: STATS_BASE,
              window: '30d',
              source: 'all',
            },
          }),
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText(/^UNDONE$/)).toBeInTheDocument());
  });

  it('renders UNDO EXPIRED for `expired`', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [
              row({
                undoState: { kind: 'expired', expiredAt: new Date(NOW).toISOString() },
              }),
            ],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              stats: STATS_BASE,
              window: '30d',
              source: 'all',
            },
          }),
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText(/UNDO EXPIRED/i)).toBeInTheDocument());
  });

  it('renders nothing for `unavailable`', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [row({ undoState: { kind: 'unavailable' } })],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              stats: STATS_BASE,
              window: '30d',
              source: 'all',
            },
          }),
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText(/Sender One/)).toBeInTheDocument());
    // No undo-cell content for `unavailable` — no button, no pill.
    expect(screen.queryByRole('button', { name: /undo →/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^UNDONE$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^UNDO EXPIRED$/)).not.toBeInTheDocument();
  });
});

describe('ActivityScreen — pure helpers', () => {
  it('relativeTime buckets days / hours / minutes / just-now', () => {
    expect(relativeTime(new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString(), NOW)).toBe('3d ago');
    expect(relativeTime(new Date(NOW - 2 * 60 * 60 * 1000).toISOString(), NOW)).toBe('2h ago');
    expect(relativeTime(new Date(NOW - 90 * 1000).toISOString(), NOW)).toBe('1m ago');
    expect(relativeTime(new Date(NOW).toISOString(), NOW)).toBe('just now');
  });
});
