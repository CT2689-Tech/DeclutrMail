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

import { ActivityScreen, relativeTime, rowsToCsv } from './activity-screen';
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

  deleted: 0,
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
    // The redesigned metrics block renders one tile per verb. Each
    // tile pairs a label (Archived / Unsubscribed / Kept …) with the
    // window count displayed as a large display-font numeral. Labels
    // also appear on the verb-filter chip row, so `getAllByText` is
    // intentional — we assert the labels render somewhere.
    await waitFor(() => expect(screen.getAllByText(/^Archived$/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/^Unsubscribed$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Kept$/).length).toBeGreaterThan(0);
    // Counts render as standalone numerals — assert the trio.
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
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
    // The redesigned UndoCell renders "Undo" + a `↺` arrow span; the
    // accessible name is "Undo ↺" — match the verb only.
    await waitFor(() => expect(screen.getByRole('button', { name: /^undo/i })).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText(/^Undone$/)).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText(/^Expired$/i)).toBeInTheDocument());
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
    expect(screen.queryByRole('button', { name: /^undo/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Undone$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Expired$/i)).not.toBeInTheDocument();
  });
});

describe('ActivityScreen — pure helpers', () => {
  it('relativeTime buckets days / hours / minutes / just-now', () => {
    expect(relativeTime(new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString(), NOW)).toBe('3d ago');
    expect(relativeTime(new Date(NOW - 2 * 60 * 60 * 1000).toISOString(), NOW)).toBe('2h ago');
    expect(relativeTime(new Date(NOW - 90 * 1000).toISOString(), NOW)).toBe('1m ago');
    expect(relativeTime(new Date(NOW).toISOString(), NOW)).toBe('just now');
  });

  it('rowsToCsv emits header + one line per row + RFC-4180-quotes commas/quotes', () => {
    const rows: ActivityRowWire[] = [
      row({
        id: 'r-1',
        action: 'archive',
        affectedCount: 3,
        sender: {
          senderKey: 'sk-comma',
          displayName: 'Smith, John',
          email: 'sj@example.com',
          domain: 'example.com',
        },
      }),
      row({
        id: 'r-2',
        action: 'delete',
        affectedCount: 1,
        sender: {
          senderKey: 'sk-quote',
          displayName: 'Quote "Co"',
          email: 'q@example.com',
          domain: 'example.com',
        },
      }),
    ];
    const csv = rowsToCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'Occurred At,Verb,Source,Sender Name,Sender Email,Affected Messages,Undo State',
    );
    expect(lines[1]).toContain('"Smith, John"');
    expect(lines[2]).toContain('"Quote ""Co"""');
    expect(lines[1]).toContain('Archived');
    expect(lines[2]).toContain('Deleted');
  });
});

// ── B-track Activity power-options ───────────────────────────────────

const META_BASE = {
  pagination: { nextCursor: null, hasMore: false, limit: 25 },
  stats: STATS_BASE,
  allTimeStats: STATS_BASE,
  window: '30d',
  source: 'all',
  verbs: [],
  senderQuery: '',
  dateFrom: null,
  dateTo: null,
};

describe('ActivityScreen — B8 verb filter', () => {
  it('verb chip click drives router.replace with ?verb=', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => jsonOk({ data: [], meta: META_BASE }),
      },
    ]);
    renderScreen();
    const archivedChip = await screen.findByRole('button', { name: /^Archived$/ });
    await userEvent.click(archivedChip);
    expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining('verb=archive'));
  });

  it('clicking the same verb twice deselects it (URL clears)', async () => {
    currentSearch = 'verb=archive';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => jsonOk({ data: [], meta: { ...META_BASE, verbs: ['archive'] } }),
      },
    ]);
    renderScreen();
    const archivedChip = await screen.findByRole('button', { name: /^Archived$/ });
    expect(archivedChip).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(archivedChip);
    expect(replaceMock).toHaveBeenCalledWith(expect.not.stringContaining('verb='));
  });
});

describe('ActivityScreen — B9 sender search', () => {
  it('debounced typing eventually pushes ?sender_q=', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => jsonOk({ data: [], meta: META_BASE }),
      },
    ]);
    renderScreen();
    const input = await screen.findByLabelText(/search sender/i);
    await userEvent.type(input, 'aber');
    await waitFor(
      () => expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining('sender_q=aber')),
      { timeout: 1000 },
    );
  });
});

describe('ActivityScreen — B10 date range', () => {
  it('typing into the From input pushes ?date_from=', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => jsonOk({ data: [], meta: META_BASE }),
      },
    ]);
    renderScreen();
    const fromInput = (await screen.findByText('From')).parentElement!.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement;
    expect(fromInput).toBeInTheDocument();
    await userEvent.type(fromInput, '2026-05-01');
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining('date_from=')),
    );
  });
});

describe('ActivityScreen — B16 all-time totals', () => {
  it('renders BOTH a window stats line AND an all-time stats line', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [row({})],
            meta: {
              ...META_BASE,
              stats: { ...STATS_BASE, archived: 5 },
              allTimeStats: { ...STATS_BASE, archived: 42 },
            },
          }),
      },
    ]);
    renderScreen();
    // The redesigned metrics block shows each verb tile with a window
    // count above a "/ N all time" footnote. The window count 5 + the
    // all-time count 42 both render; the footnote reads "/ 42 all time".
    await waitFor(() => expect(screen.getByText(/\/ 42 all time/)).toBeInTheDocument());
    expect(screen.getAllByText('5').length).toBeGreaterThan(0);
  });
});

describe('ActivityScreen — B7 multi-select + bulk undo', () => {
  it('selecting a row reveals the bulk action bar with a count', async () => {
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
            meta: META_BASE,
          }),
      },
    ]);
    renderScreen();
    const checkbox = await screen.findByRole('checkbox', { name: /select activity row/i });
    await userEvent.click(checkbox);
    // BulkActionBar header: "Selection 1 row" + accent "Undo 1" CTA.
    expect(screen.getByText(/^1 row$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /undo 1/i })).toBeInTheDocument();
  });
});

describe('ActivityScreen — B11 group by sender', () => {
  it('toggling the group chip pushes ?group=sender', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => jsonOk({ data: [], meta: META_BASE }),
      },
    ]);
    renderScreen();
    // The toolbar "Group" chip toggles between "Group" (off) and
    // "Grouped" (on). Match the off-state label.
    const groupChip = await screen.findByRole('button', { name: /^Group$/ });
    await userEvent.click(groupChip);
    expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining('group=sender'));
  });
});

describe('ActivityScreen — B12 Open in Gmail', () => {
  it('renders a per-row Gmail search link', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => jsonOk({ data: [row({})], meta: META_BASE }),
      },
    ]);
    renderScreen();
    const link = await screen.findByRole('link', { name: /gmail/i });
    expect(link).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/u/0/#search/from:one%40example.com',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('title', 'Open Sender One in Gmail');
  });
});
