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
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { ActivityScreen, relativeTime, rowsToCsv } from './activity-screen';
import type { ActivityRowWire, ActivityStatsWire } from '@/lib/api/activity';
import type { ActionRecoveryPreviewResult } from '@/lib/api/actions';

vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => ({
    me: { activeMailboxId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  }),
  getActiveMailboxEmail: () => 'active+mailbox@example.com',
}));

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
  noisePreventedPerMonth: null,
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
    rule: partial.rule ?? null,
    undoState: partial.undoState ?? { kind: 'unavailable' },
    executionState: partial.executionState ?? null,
  };
}

function renderScreen() {
  const client = createTestQueryClient();
  const utils = render(
    <QueryWrapper client={client}>
      <ActivityScreen />
    </QueryWrapper>,
  );
  // Expose the client so tests can force cache effects (e.g. a
  // background refetch) that have no DOM trigger in happy-dom.
  return { ...utils, client };
}

beforeEach(() => {
  installFetchStub([]);
  replaceMock.mockReset();
  currentSearch = '';
});
afterEach(() => {
  resetFetchStub();
  vi.restoreAllMocks();
});

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

  it('renders a recoverable alert on 500 and retries the request from a 44px CTA', async () => {
    let requests = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => {
          requests += 1;
          return requests === 1
            ? jsonServerError()
            : jsonOk({
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
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: /couldn[’']t load your activity/i }),
    ).toBeInTheDocument();

    const retry = within(alert).getByRole('button', { name: 'Try again' });
    expect(retry).toHaveStyle({ minHeight: '44px' });
    await userEvent.click(retry);

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /no activity in this window/i }),
      ).toBeInTheDocument(),
    );
    expect(requests).toBe(2);
  });

  it('keeps filter context on a controller validation 400 and resets its date', async () => {
    currentSearch = 'date_from=2026-05-20&source=manual&group=sender';
    let requests = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => {
          requests += 1;
          return new Response(
            JSON.stringify({
              error: {
                code: 'BAD_REQUEST',
                message: 'date_from must be a valid ISO-8601 date.',
              },
            }),
            {
              status: 400,
              headers: { 'content-type': 'application/json' },
            },
          );
        },
      },
    ]);
    renderScreen();

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: /check your activity filters/i }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'About Activity' })).getByText('Activity'),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Filters' })).toBeInTheDocument();

    const reset = within(alert).getByRole('button', { name: 'Reset filters' });
    expect(reset).toHaveStyle({ minHeight: '44px' });
    expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull();
    await userEvent.click(reset);

    expect(replaceMock).toHaveBeenCalledWith('/activity?source=manual&group=sender');
    expect(requests).toBe(1);
  });

  it('blocks a malformed deep link until reset, then fetches clean filters on rerender', async () => {
    currentSearch = 'date_from=not-a-date&source=manual&group=sender';
    const requestedUrls: URL[] = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: (_req, url) => {
          requestedUrls.push(url);
          return jsonOk({
            data: [row({})],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              stats: STATS_BASE,
              allTimeStats: STATS_BASE,
              window: '30d',
              source: 'manual',
            },
          });
        },
      },
    ]);
    const view = renderScreen();

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: /check your activity filters/i }),
    ).toBeInTheDocument();
    expect(requestedUrls).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Manual' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Grouped' })).toHaveAttribute('aria-pressed', 'true');
    expect(alert.parentElement).not.toHaveStyle({ padding: '20px 24px 28px' });

    await userEvent.click(within(alert).getByRole('button', { name: 'Reset filters' }));
    expect(replaceMock).toHaveBeenCalledWith('/activity?source=manual&group=sender');
    expect(requestedUrls).toHaveLength(0);

    // next/navigation owns the real URL update. Mirror that transition in
    // the test and rerender with the same query client so the disabled query
    // becomes enabled without losing its cache identity.
    currentSearch = 'source=manual&group=sender';
    view.rerender(
      <QueryWrapper client={view.client}>
        <ActivityScreen />
      </QueryWrapper>,
    );

    await waitFor(() => expect(requestedUrls).toHaveLength(1));
    expect(requestedUrls[0]!.searchParams.get('source')).toBe('manual');
    expect(requestedUrls[0]!.searchParams.has('date_from')).toBe(false);
    expect(requestedUrls[0]!.searchParams.has('date_to')).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await screen.findByText('Sender One')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manual' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Grouped' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('blocks a reversed valid date range before making an API request', async () => {
    currentSearch = 'date_from=2026-05-20&date_to=2026-05-01';
    let requests = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => {
          requests += 1;
          return jsonOk({ data: [], meta: {} });
        },
      },
    ]);
    renderScreen();

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: /check your activity filters/i }),
    ).toBeInTheDocument();
    expect(requests).toBe(0);
  });

  it('hides cached rows, export data, and bulk actions when a raw date becomes malformed', async () => {
    currentSearch = 'source=manual';
    let requests = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => {
          requests += 1;
          return jsonOk({
            data: [row({})],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              stats: STATS_BASE,
              allTimeStats: STATS_BASE,
              window: '30d',
              source: 'manual',
            },
          });
        },
      },
    ]);
    const view = renderScreen();

    expect(await screen.findByText('Sender One')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /select activity row/i }));
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
    expect(requests).toBe(1);

    currentSearch = 'date_from=still-not-a-date&source=manual';
    view.rerender(
      <QueryWrapper client={view.client}>
        <ActivityScreen />
      </QueryWrapper>,
    );

    await screen.findByRole('alert');
    expect(requests).toBe(1);
    expect(screen.queryByText('Sender One')).toBeNull();
    expect(screen.queryByRole('status', { name: 'Activity metrics' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  it('does not mislabel a non-validation 4xx as a filter problem', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          new Response(
            JSON.stringify({
              error: { code: 'RATE_LIMITED', message: 'Too many requests' },
            }),
            {
              status: 429,
              headers: { 'content-type': 'application/json' },
            },
          ),
      },
    ]);
    renderScreen();

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: /couldn[’']t load your activity/i }),
    ).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(within(alert).queryByRole('button', { name: 'Reset filters' })).toBeNull();
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
  it('explains the difference between Activity Undo and provider recovery', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => jsonOk({ data: [row({})], meta: META_BASE }),
      },
    ]);
    renderScreen();

    expect(await screen.findByText('Which Undo or recovery option applies?')).toBeInTheDocument();
    expect(screen.getByText(/Gmail Trash recovery is a separate fallback/i)).toBeInTheDocument();
  });

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
    // tile pairs a label (Archived / Unsubscribes / Kept …) with the
    // window count displayed as a large display-font numeral. Labels
    // also appear on the verb-filter chip row, so `getAllByText` is
    // intentional — we assert the labels render somewhere. The
    // unsubscribe bucket counts requests, so the honest label is
    // "Unsubscribes", never the success-claiming "Unsubscribed" (D9).
    await waitFor(() => expect(screen.getAllByText(/^Archived$/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/^Unsubscribes$/).length).toBeGreaterThan(0);
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

  it('D56 — renders a distinct endpoint-accepted row for the outcome action', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [row({ id: 'a-confirmed', action: 'unsubscribe_confirmed', affectedCount: 0 })],
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
    // The outcome row renders its own label, distinct from the intent's
    // "Unsubscribe requested" — and the confirmed row shows no count (0 affected).
    await waitFor(() =>
      expect(screen.getByText(/^Unsubscribe endpoint accepted request$/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/email/)).not.toBeInTheDocument();
  });

  it('D9 — the intent row records the request, never success', async () => {
    // A one-click POST can still fail and a mailto is manual (D230), so the
    // intent row must not claim completion — otherwise a FAILED unsubscribe
    // reads as done. The intent renders "Unsubscribe requested"; only the
    // separate `unsubscribe_confirmed` row records endpoint acceptance. (The stats
    // tile + verb chip legitimately keep the aggregate "Unsubscribed"
    // label, so we assert the ROW label positively rather than the absence
    // of "Unsubscribed" anywhere on the page.)
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [row({ id: 'a-intent', action: 'unsubscribe', affectedCount: 0 })],
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
      expect(screen.getByText(/^Unsubscribe request recorded$/)).toBeInTheDocument(),
    );
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
      'Occurred At,Verb,Source,Sender Name,Sender Email,Affected Messages,Execution Status,Undo State',
    );
    expect(lines[1]).toContain('"Smith, John"');
    expect(lines[2]).toContain('"Quote ""Co"""');
    expect(lines[1]).toContain('Archived');
    expect(lines[2]).toContain('Moved to Gmail Trash');
  });

  it('exports unresolved rows with execution-aware labels and status', () => {
    const csv = rowsToCsv([
      row({
        action: 'archive',
        executionState: {
          kind: 'in_progress',
          actionId: '11111111-1111-1111-1111-111111111111',
          requestedCount: 2,
          isRecovery: true,
          status: 'queued',
        },
      }),
      row({
        id: 'failed-later',
        action: 'later',
        executionState: {
          kind: 'failed',
          actionId: '22222222-2222-2222-2222-222222222222',
          rootActionId: '22222222-2222-2222-2222-222222222222',
          requestedCount: 1,
          errorCode: null,
          resolution: 'review',
        },
      }),
    ]);

    expect(csv).toContain('Archiving…');
    expect(csv).toContain('Recovery queued');
    expect(csv).toContain('Later failed');
    expect(csv).toContain('Failed · review available');
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

describe('ActivityScreen — outcome-aware recovery', () => {
  it('uses progress and failed labels instead of completed-outcome copy', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [
              row({
                id: 'queued-archive',
                action: 'archive',
                executionState: {
                  kind: 'in_progress',
                  actionId: '11111111-1111-1111-1111-111111111111',
                  requestedCount: 2,
                  isRecovery: false,
                  status: 'queued',
                },
              }),
              row({
                id: 'failed-delete',
                action: 'delete',
                executionState: {
                  kind: 'failed',
                  actionId: '22222222-2222-2222-2222-222222222222',
                  rootActionId: '22222222-2222-2222-2222-222222222222',
                  requestedCount: 1,
                  errorCode: null,
                  resolution: 'support',
                },
              }),
            ],
            meta: META_BASE,
          }),
      },
    ]);
    renderScreen();

    expect(await screen.findByText('Archiving…')).toBeInTheDocument();
    expect(screen.getByText('Delete failed')).toBeInTheDocument();
    expect(screen.getByText('Running…')).toBeInTheDocument();
  });

  it('verifies provider state before enqueueing one idempotent recovery attempt', async () => {
    let recoveryPosts = 0;
    const idempotencyKeys: string[] = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [
              row({
                action: 'archive',
                affectedCount: 3,
                executionState: {
                  kind: 'failed',
                  actionId: '11111111-1111-1111-1111-111111111111',
                  rootActionId: '11111111-1111-1111-1111-111111111111',
                  requestedCount: 3,
                  errorCode: 'GMAIL_RATE_LIMITED',
                  resolution: 'review',
                },
              }),
            ],
            meta: META_BASE,
          }),
      },
      {
        method: 'POST',
        path: '/api/actions/11111111-1111-1111-1111-111111111111/recovery-preview',
        respond: () =>
          jsonOk({
            data: recoveryPreview({ status: 'verifying', outcome: null }),
          }),
      },
      {
        method: 'GET',
        path: '/api/actions/recovery-previews/22222222-2222-2222-2222-222222222222',
        respond: () =>
          jsonOk({
            data: recoveryPreview({
              status: 'ready',
              outcome: 'partial',
              remainingCount: 2,
              alreadyAppliedCount: 1,
            }),
          }),
      },
      {
        method: 'POST',
        path: '/api/actions/recovery-previews/22222222-2222-2222-2222-222222222222/retry',
        respond: async (req) => {
          recoveryPosts += 1;
          idempotencyKeys.push(req.headers.get('Idempotency-Key') ?? '');
          await new Promise((resolve) => setTimeout(resolve, 20));
          if (recoveryPosts === 1) return jsonServerError('queue_unavailable');
          return jsonOk({
            data: {
              previewId: '22222222-2222-2222-2222-222222222222',
              rootActionId: '11111111-1111-1111-1111-111111111111',
              actionId: '33333333-3333-3333-3333-333333333333',
              attempt: 1,
              status: 'queued',
              replayed: false,
            },
          });
        },
      },
    ]);
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: /review and try again/i }));
    const dialog = await screen.findByRole('dialog', { name: /review failed archived/i });
    expect(within(dialog).getByText(/checks Gmail's current label state/i)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByText('2')).toBeInTheDocument());
    expect(within(dialog).getByText('1')).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: /try this action again/i });
    await userEvent.dblClick(confirm);
    await waitFor(() => expect(recoveryPosts).toBe(1));
    expect(idempotencyKeys[0]!.length).toBeGreaterThanOrEqual(8);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /could not confirm that the queued attempt reached the worker/i,
    );
    await userEvent.click(confirm);
    await waitFor(() => expect(recoveryPosts).toBe(2));
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    await waitFor(() =>
      expect(screen.queryByTestId('action-recovery-dialog')).not.toBeInTheDocument(),
    );
  });

  it('requires a future return time when the failed Later schedule has passed', async () => {
    let confirmedWakeAt: string | undefined;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [
              row({
                action: 'later',
                executionState: {
                  kind: 'failed',
                  actionId: '11111111-1111-1111-1111-111111111111',
                  rootActionId: '11111111-1111-1111-1111-111111111111',
                  requestedCount: 1,
                  errorCode: 'GMAIL_PROVIDER_ERROR',
                  resolution: 'review',
                },
              }),
            ],
            meta: META_BASE,
          }),
      },
      {
        method: 'POST',
        path: '/api/actions/11111111-1111-1111-1111-111111111111/recovery-preview',
        respond: () =>
          jsonOk({
            data: recoveryPreview({
              verb: 'later',
              status: 'ready',
              outcome: 'not_applied',
              requiresNewWakeAt: true,
            }),
          }),
      },
      {
        method: 'GET',
        path: '/api/actions/recovery-previews/22222222-2222-2222-2222-222222222222',
        respond: () =>
          jsonOk({
            data: recoveryPreview({
              verb: 'later',
              status: 'ready',
              outcome: 'not_applied',
              requiresNewWakeAt: true,
            }),
          }),
      },
      {
        method: 'POST',
        path: '/api/actions/recovery-previews/22222222-2222-2222-2222-222222222222/retry',
        respond: async (req) => {
          confirmedWakeAt = ((await req.json()) as { wakeAt?: string }).wakeAt;
          return jsonOk({
            data: {
              previewId: '22222222-2222-2222-2222-222222222222',
              rootActionId: '11111111-1111-1111-1111-111111111111',
              actionId: '33333333-3333-3333-3333-333333333333',
              attempt: 1,
              status: 'queued',
              replayed: false,
            },
          });
        },
      },
    ]);
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: /review and try again/i }));
    const dialog = await screen.findByRole('dialog', { name: /review failed moved to later/i });
    const wakeInput = within(dialog).getByLabelText(/new return time/i);
    expect((wakeInput as HTMLInputElement).value.length).toBeGreaterThan(0);
    await userEvent.click(within(dialog).getByRole('button', { name: /try this action again/i }));
    await waitFor(() => expect(confirmedWakeAt).toBeDefined());
    expect(new Date(confirmedWakeAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('rechecks Gmail and requests a new return time when a ready Later preview expires', async () => {
    let previewStarts = 0;
    const previewResult = () =>
      recoveryPreview({
        verb: 'later',
        status: 'ready',
        outcome: 'not_applied',
        requiresNewWakeAt: previewStarts > 1,
        wakeAt: previewStarts > 1 ? null : new Date(Date.now() + 60_000).toISOString(),
      });
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [
              row({
                action: 'later',
                executionState: {
                  kind: 'failed',
                  actionId: '11111111-1111-1111-1111-111111111111',
                  rootActionId: '11111111-1111-1111-1111-111111111111',
                  requestedCount: 1,
                  errorCode: 'GMAIL_PROVIDER_ERROR',
                  resolution: 'review',
                },
              }),
            ],
            meta: META_BASE,
          }),
      },
      {
        method: 'POST',
        path: '/api/actions/11111111-1111-1111-1111-111111111111/recovery-preview',
        respond: () => {
          previewStarts += 1;
          return jsonOk({ data: previewResult() });
        },
      },
      {
        method: 'GET',
        path: '/api/actions/recovery-previews/22222222-2222-2222-2222-222222222222',
        respond: () => jsonOk({ data: previewResult() }),
      },
      {
        method: 'POST',
        path: '/api/actions/recovery-previews/22222222-2222-2222-2222-222222222222/retry',
        respond: () =>
          new Response(JSON.stringify({ code: 'LATER_WAKE_TIME_REQUIRED' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: /review and try again/i }));
    const dialog = await screen.findByRole('dialog', { name: /review failed moved to later/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /try this action again/i }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /saved return time has passed.*nothing was queued/i,
    );
    expect(within(dialog).getByRole('button', { name: /try this action again/i })).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('button', { name: /check Gmail again/i }));
    await waitFor(() => expect(previewStarts).toBe(2));
    expect(await within(dialog).findByLabelText(/new return time/i)).toBeInTheDocument();
  });

  it('shows a no-change outcome without a blind retry', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [
              row({
                id: 'no-change',
                action: 'archive',
                executionState: {
                  kind: 'failed',
                  actionId: '11111111-1111-1111-1111-111111111111',
                  rootActionId: '11111111-1111-1111-1111-111111111111',
                  requestedCount: 1,
                  errorCode: null,
                  resolution: 'review',
                },
              }),
            ],
            meta: META_BASE,
          }),
      },
      {
        method: 'POST',
        path: '/api/actions/11111111-1111-1111-1111-111111111111/recovery-preview',
        respond: () =>
          jsonOk({
            data: recoveryPreview({
              status: 'consumed',
              outcome: 'no_change_needed',
              targetCount: 0,
              verifiedCount: 0,
              remainingCount: 0,
            }),
          }),
      },
      {
        method: 'GET',
        path: '/api/actions/recovery-previews/22222222-2222-2222-2222-222222222222',
        respond: () =>
          jsonOk({
            data: recoveryPreview({
              status: 'consumed',
              outcome: 'no_change_needed',
              targetCount: 0,
              verifiedCount: 0,
              remainingCount: 0,
            }),
          }),
      },
    ]);
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: /review and try again/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/nothing is left to retry/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /try this action again/i })).toBeNull();
  });

  it('never exposes generic recovery for an unsubscribe failure', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [
              row({
                action: 'unsubscribe_failed',
                executionState: {
                  kind: 'failed',
                  actionId: '55555555-5555-5555-5555-555555555555',
                  rootActionId: '55555555-5555-5555-5555-555555555555',
                  requestedCount: 1,
                  errorCode: 'UNSUB_PROVIDER_ERROR',
                  resolution: 'support',
                },
              }),
            ],
            meta: META_BASE,
          }),
      },
    ]);
    renderScreen();

    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /review and try again/i })).toBeNull();
  });

  it('offers the real Gmail reconnect flow after fresh verification requires it', async () => {
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [
              row({
                action: 'archive',
                executionState: {
                  kind: 'failed',
                  actionId: '11111111-1111-1111-1111-111111111111',
                  rootActionId: '11111111-1111-1111-1111-111111111111',
                  requestedCount: 1,
                  errorCode: 'GMAIL_REAUTH_REQUIRED',
                  resolution: 'review',
                },
              }),
            ],
            meta: META_BASE,
          }),
      },
      {
        method: 'POST',
        path: '/api/actions/11111111-1111-1111-1111-111111111111/recovery-preview',
        respond: () =>
          jsonOk({
            data: recoveryPreview({ status: 'verifying', outcome: null }),
          }),
      },
      {
        method: 'GET',
        path: '/api/actions/recovery-previews/22222222-2222-2222-2222-222222222222',
        respond: () =>
          jsonOk({
            data: recoveryPreview({
              status: 'failed',
              outcome: 'reconnect_required',
              errorCode: 'GMAIL_REAUTH_REQUIRED',
            }),
          }),
      },
    ]);
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: /review and try again/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/return to Activity/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /reconnect Gmail/i }));
    expect(assignSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/auth/google/connect-mailbox/start?reconnectMailboxId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
    );
  });
});

function recoveryPreview(
  partial: Partial<ActionRecoveryPreviewResult>,
): ActionRecoveryPreviewResult {
  return {
    previewId: '22222222-2222-2222-2222-222222222222',
    actionId: '11111111-1111-1111-1111-111111111111',
    rootActionId: '11111111-1111-1111-1111-111111111111',
    verb: 'archive',
    status: 'ready',
    outcome: 'not_applied',
    targetCount: 3,
    remainingCount: 3,
    alreadyAppliedCount: 0,
    unavailableCount: 0,
    verifiedCount: 3,
    errorCode: null,
    wakeAt: null,
    requiresNewWakeAt: false,
    expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
    recoveryActionId: null,
    ...partial,
  };
}

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

// ── U27 — D57 rule attribution + infinite scroll ─────────────────────

describe('ActivityScreen — D57 rule attribution', () => {
  it('renders "by Autopilot · <rule name>" for autopilot rows with a rule', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({
            data: [
              row({
                source: 'autopilot',
                rule: {
                  id: '22222222-2222-2222-2222-222222222222',
                  name: 'Newsletter graveyard',
                },
              }),
            ],
            meta: META_BASE,
          }),
      },
    ]);
    renderScreen();
    await waitFor(() =>
      expect(screen.getByText('by Autopilot · Newsletter graveyard')).toBeInTheDocument(),
    );
  });

  it('falls back to plain "by Autopilot" when the rule was deleted (rule=null)', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () =>
          jsonOk({ data: [row({ source: 'autopilot', rule: null })], meta: META_BASE }),
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('by Autopilot')).toBeInTheDocument());
  });

  it('keeps the "via <source>" form for non-autopilot rows', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => jsonOk({ data: [row({ source: 'manual' })], meta: META_BASE }),
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('via Manual')).toBeInTheDocument());
  });
});

describe('ActivityScreen — U27 infinite scroll', () => {
  it('appends the next page on "Load more" and then shows the end marker', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: (_req, url) => {
          const cursor = url.searchParams.get('cursor');
          if (!cursor) {
            return jsonOk({
              data: [row({ id: 'p1-1' })],
              meta: {
                ...META_BASE,
                pagination: { nextCursor: 'cursor-page-2', hasMore: true, limit: 25 },
              },
            });
          }
          expect(cursor).toBe('cursor-page-2');
          return jsonOk({
            data: [
              row({
                id: 'p2-1',
                sender: {
                  senderKey: 'sk-2',
                  displayName: 'Sender Two',
                  email: 'two@example.com',
                  domain: 'example.com',
                },
              }),
            ],
            meta: META_BASE,
          });
        },
      },
    ]);
    renderScreen();
    // Page 1 rendered + load-more affordance present (hasMore=true).
    await waitFor(() => expect(screen.getByText('Sender One')).toBeInTheDocument());
    const loadMore = screen.getByRole('button', { name: /^load more$/i });
    await userEvent.click(loadMore);
    // Page 2 appends below page 1 — both rows visible.
    await waitFor(() => expect(screen.getByText('Sender Two')).toBeInTheDocument());
    expect(screen.getByText('Sender One')).toBeInTheDocument();
    // Page 2's nextCursor=null → end-of-list marker with the loaded count.
    await waitFor(() =>
      expect(screen.getByText(/end of activity · 2 rows loaded/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /^load more$/i })).not.toBeInTheDocument();
  });

  it('shows the end-of-list marker instead of Load more on a single full page', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => jsonOk({ data: [row({})], meta: META_BASE }),
      },
    ]);
    renderScreen();
    await waitFor(() =>
      expect(screen.getByText(/end of activity · 1 row loaded/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /^load more$/i })).not.toBeInTheDocument();
  });

  // D211 partial-error — the edge state this slice promotes to
  // required: page 1 loaded, page 2 did not. The amber inline retry
  // must be scoped to NEXT-PAGE failures only (isFetchNextPageError);
  // a failed background refetch retains the rows and must not trip it.
  it('keeps loaded rows and renders the amber inline retry when fetchNextPage 5xx-fails', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: (_req, url) => {
          // Page 1 (no cursor) succeeds; the cursor'd next page 500s.
          if (url.searchParams.get('cursor')) return jsonServerError();
          return jsonOk({
            data: [row({ id: 'p1-1' })],
            meta: {
              ...META_BASE,
              pagination: { nextCursor: 'cursor-page-2', hasMore: true, limit: 25 },
            },
          });
        },
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Sender One')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^load more$/i }));
    // Amber inline retry renders in the tail region…
    const retry = await screen.findByRole('button', { name: /couldn[’']t load more/i });
    expect(retry).toBeInTheDocument();
    // …while the loaded page-1 rows stay on screen (no full-screen error).
    expect(screen.getByText('Sender One')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /couldn[’']t load your activity/i }),
    ).not.toBeInTheDocument();
  });

  it('does NOT show the amber retry when a background refetch fails (error is next-page-scoped)', async () => {
    let calls = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => {
          calls += 1;
          // First load succeeds with more pages available; the
          // background refetch of the loaded page then 500s — the
          // 1.5s in-flight poll / refetchOnWindowFocus failure class.
          if (calls === 1) {
            return jsonOk({
              data: [row({ id: 'p1-1' })],
              meta: {
                ...META_BASE,
                pagination: { nextCursor: 'cursor-page-2', hasMore: true, limit: 25 },
              },
            });
          }
          return jsonServerError();
        },
      },
    ]);
    const { client } = renderScreen();
    await waitFor(() => expect(screen.getByText('Sender One')).toBeInTheDocument());
    // Force the background refetch (no DOM trigger for focus/poll here).
    await act(() => client.refetchQueries({ queryKey: ['activity'] }));
    expect(calls).toBeGreaterThan(1);
    // refetchQueries resolves BEFORE the query observer notifies React —
    // flush a macrotask so the component has re-rendered with the
    // post-refetch error state. Without this the assertions below pass
    // vacuously (verified: the un-fixed `isError` gate shows the amber
    // one tick after refetchQueries resolves).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    // Query-wide isError is now true with data retained — the rows stay,
    // the plain "Load more" affordance remains, and the amber
    // "Couldn't load more" retry must NOT render (pins the
    // isFetchNextPageError gate).
    expect(screen.getByText('Sender One')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^load more$/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /couldn[’']t load more/i }),
    ).not.toBeInTheDocument();
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
      'https://mail.google.com/mail/?authuser=active%2Bmailbox%40example.com#search/from%3A%22one%40example.com%22',
    );
    expect(link.getAttribute('href')).not.toContain('/u/0');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('title', 'Open Sender One in Gmail');
  });
});

describe('ActivityScreen — D60 mobile filter drawer', () => {
  // useIsAtMost('sm') reads window.matchMedia('(max-width: 900px)'). Force
  // it to match so the mobile card + bottom-sheet layout renders.
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: /max-width:\s*900px/.test(query),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          onchange: null,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('collapses the inline filter bands into a Filters trigger + opens the drawer', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => jsonOk({ data: [row({ action: 'archive' })], meta: META_BASE }),
      },
    ]);
    renderScreen();

    // Trigger present; the inline source chips are NOT rendered directly
    // (they live inside the closed drawer).
    const trigger = await screen.findByRole('button', { name: /^filters/i });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(trigger);

    // Drawer is a modal dialog holding the bands + an explicit results button.
    const dialog = await screen.findByRole('dialog', { name: /activity filters/i });
    expect(within(dialog).getByRole('button', { name: 'Autopilot' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Archived' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /view results/i })).toBeInTheDocument();
  });

  it('a source chip inside the drawer drives the filter URL', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/activity',
        respond: () => jsonOk({ data: [row({})], meta: META_BASE }),
      },
    ]);
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^filters/i }));
    const dialog = await screen.findByRole('dialog', { name: /activity filters/i });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Autopilot' }));
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining('source=autopilot')),
    );
  });
});
