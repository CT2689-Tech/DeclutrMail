/**
 * Tests for `SenderDetailRoute` — the page wired to the four
 * sender-scoped queries.
 *
 * Covers:
 *   • All-four-succeed → ready state with factual wire data and no fixture suggestion
 *   • Detail 404 → not-found UI
 *   • Detail 500 → error UI with retry copy
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ACTION_OVERDUE_MS, SenderDetailRoute } from './sender-detail-page';
import { sendersKeys } from '../api/query-keys';
import { activityKeys } from '@/features/activity/api/query-keys';
import { UNDO_DONE_TOAST } from '@/lib/action-error-copy';
import { useRevertUndo } from '@/lib/api/use-action';
import {
  addFetchHandlers,
  installFetchStub,
  jsonNotFound,
  jsonOk,
  jsonServerError,
  resetFetchStub,
} from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import {
  MAILBOX_SCOPE_RESET_EVENT,
  resetMailboxScopedCache,
} from '@/features/mailboxes/api/reset-mailbox-cache';

// Toast is the user-visible surface the overdue-release cases assert on.
// Partial mock — every other export from the shared package stays real.
const h = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: h.toast };
});

// `useSearchParams` is read by the mount-event effect (D38 session-3).
// The test toggles `currentSearch` per-case to exercise the `?from=`
// parsing branches without re-mocking the module.
let currentSearch = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const authState = vi.hoisted(() => {
  const me = {
    user: { id: 'user-1', email: 'owner@example.com', workspaceId: 'workspace-1' },
    mailboxes: [
      {
        id: 'mailbox-active',
        email: 'active+work@gmail.com',
        status: 'active' as const,
        connectedAt: '2026-01-01T00:00:00.000Z',
        readiness: 'ready' as const,
      },
    ],
    activeMailboxId: 'mailbox-active',
    tier: 'pro' as const,
    cleanupRemaining: null,
  };

  return {
    fixture: { me },
    current: { me } as { me: typeof me } | null,
  };
});

vi.mock('@/features/auth/auth-provider', () => ({
  getActiveMailboxEmail: (me: (typeof authState.fixture)['me']) =>
    me.mailboxes.find((mailbox) => mailbox.id === me.activeMailboxId)?.email ?? me.user.email,
  useOptionalAuth: () => authState.current,
}));

const trackMock = vi.fn();
vi.mock('@/lib/posthog', () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

const addBreadcrumbMock = vi.fn();
const captureFeatureExceptionMock = vi.fn();
vi.mock('@/lib/sentry', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbMock(...args),
  captureFeatureException: (...args: unknown[]) => captureFeatureExceptionMock(...args),
}));
import type { SenderDetailDto } from '@/lib/api/senders';

// Typed against the wire contract — see the note on `ROW` in
// senders-screen.test.tsx.

const DETAIL: SenderDetailDto = {
  id: 'linkedin',
  displayName: 'LinkedIn',
  email: 'noreply@linkedin.com',
  domain: 'linkedin.com',
  brandMark: false,
  gmailCategory: 'social' as const,
  lastSeenAt: '2026-05-23T00:00:00.000Z',
  firstSeenAt: '2023-05-23T00:00:00.000Z',
  monthlyVolume: 64,
  // Required on the wire (`SenderDetailDto`) and always sent by
  // `SendersReadService.getById`. This fixture reaches the app as
  // `unknown` through `jsonOk`, so nothing type-checks it against the
  // contract and it can silently omit a field the real API guarantees —
  // as it did for `totalReceived` until the confirm modal's context
  // strip started reading it (2026-08-21). Fields the UI renders belong
  // here even when today's assertions don't name them.
  totalReceived: 2_048,
  wroteToCount: 0,
  readRate: 0,
  volumeTrend: 'steady' as const,
  unsubscribeMethod: 'mailto' as const,
  lastReview: null,
  protectionFlags: {
    isProtected: false,
    protectionReason: null,
    protectionSetAt: null,
  },
};

const MESSAGE = {
  id: 'm-1',
  providerMessageId: 'p-1',
  providerThreadId: 't-1',
  subject: 'Top notifications this week',
  snippet: 'You have 5 new notifications waiting for you.',
  internalDate: '2026-05-22T00:00:00.000Z',
  isUnread: true,
};

// Codex adversarial review: this used to be `YYYY-MM-DD` (with a `-01`
// day suffix); the real API sends `YYYY-MM` (`senders.read-service.ts`'s
// `row.yearMonth.slice(0, 7)`) — see the corrected comment on
// `TimeseriesPointDto`. The stale format silently failed to match
// `isCurrentYearMonth`'s `/^(\d{4})-(\d{2})$/` regex, so no test here
// ever exercised the "current month" branch through this fixture.
const TIMESERIES = Array.from({ length: 12 }, (_, i) => ({
  yearMonth: `2025-${String(i + 1).padStart(2, '0')}`,
  volume: 60,
  readCount: 1,
}));

const HISTORY_ROW = {
  id: 'h-1',
  action: 'archive' as const,
  source: 'manual' as const,
  occurredAt: '2026-05-20T00:00:00.000Z',
  affectedCount: 12,
};

function installHappyPath(message = MESSAGE) {
  installFetchStub([
    {
      method: 'GET',
      path: /^\/api\/senders\/[^/]+$/,
      respond: () => jsonOk({ data: DETAIL }),
    },
    {
      method: 'GET',
      path: /^\/api\/senders\/[^/]+\/messages$/,
      respond: () =>
        jsonOk({
          data: [message],
          meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
        }),
    },
    {
      method: 'GET',
      path: /^\/api\/senders\/[^/]+\/timeseries$/,
      respond: () => jsonOk({ data: TIMESERIES }),
    },
    {
      method: 'GET',
      path: /^\/api\/senders\/[^/]+\/history$/,
      respond: () =>
        jsonOk({
          data: [HISTORY_ROW],
          meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
        }),
    },
  ]);
}

let lastClient: ReturnType<typeof createTestQueryClient>;

function renderDetail(id = 'linkedin') {
  const client = createTestQueryClient();
  lastClient = client;
  return render(
    <QueryWrapper client={client}>
      <SenderDetailRoute id={id} />
    </QueryWrapper>,
  );
}

describe('SenderDetailRoute', () => {
  beforeEach(() => {
    installFetchStub([]);
    currentSearch = '';
    authState.current = authState.fixture;
    trackMock.mockClear();
    addBreadcrumbMock.mockClear();
  });
  afterEach(() => resetFetchStub());

  it('renders the page once all four queries resolve', async () => {
    installHappyPath();
    renderDetail();

    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());
    // Identity, the one 90-day count, and the recent-message subject are
    // wire-backed. The endpoint has no recommendation payload, so no
    // fixture suggestion may appear even though this sender's facts used
    // to synthesize one.
    expect(screen.getByRole('heading', { level: 1, name: 'LinkedIn' })).toBeInTheDocument();
    expect(screen.getByText('noreply@linkedin.com')).toBeInTheDocument();
    expect(screen.getByTestId('sender-detail-window-count')).toHaveTextContent('64');
    expect(screen.getByText(/top notifications this week/i)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Optional suggestion/ })).not.toBeInTheDocument();
    // The Gmail category eyebrow is gone from this surface.
    expect(screen.queryByText('Gmail: Social')).not.toBeInTheDocument();
    expect(screen.queryByText(/confidence \d+%/i)).not.toBeInTheDocument();
  });

  /**
   * QA-sender-detail-20260902-05: aria-label and title described the
   * "Open all in Gmail" link two different ways to two different users
   * ("open all messages" vs. "search every email"), and "all"/"every"
   * overclaim what a `from:` search actually reaches (Gmail's default
   * search excludes Spam and Trash).
   */
  it('describes the Gmail deep link the same way to every user, without overclaiming scope', async () => {
    installHappyPath();
    renderDetail();

    const link = await screen.findByRole('link', {
      name: 'Open a Gmail search for email from this sender',
    });
    expect(link).toHaveAttribute('title', 'Open a Gmail search for email from this sender');
    expect(screen.queryByText(/open all in gmail/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/search every email/i)).not.toBeInTheDocument();
  });

  /**
   * QA-sender-detail-20260902-02: "we never render bodies" sat directly
   * above each row's Gmail-snippet text. The rows speak for themselves
   * now — no caption at all.
   */
  it('never claims "no bodies" beside the rendered Gmail preview snippet', async () => {
    installHappyPath();
    renderDetail();

    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());
    expect(screen.getByText(MESSAGE.snippet)).toBeInTheDocument();
    expect(screen.queryByText(/never render bodies/i)).not.toBeInTheDocument();
  });

  function installWith(detail: Partial<SenderDetailDto>, timeseries: unknown[] = TIMESERIES) {
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: () => jsonOk({ data: { ...DETAIL, ...detail } }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/messages$/,
        respond: () =>
          jsonOk({
            data: [MESSAGE],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/timeseries$/,
        respond: () => jsonOk({ data: timeseries }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/history$/,
        respond: () =>
          jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
    ]);
  }

  // The one number is the 90-day count, stated once; the sentence under
  // it names the window and adds only the lifetime total.
  it('states the 90-day count once, with its window and the lifetime total', async () => {
    installWith({ monthlyVolume: 64, totalReceived: 2_048 });
    renderDetail();

    const count = await screen.findByTestId('sender-detail-window-count');
    expect(count).toHaveTextContent(/^64$/);
    const sentence = count.nextElementSibling!;
    expect(sentence).toHaveTextContent(/emails in the last 90 days/);
    expect(sentence).toHaveTextContent('2,048 received · all time');
    expect((document.body.textContent ?? '').match(/in the last 90 days/g)).toHaveLength(1);
    // No derived cadence, and no percentage in the headline.
    expect(sentence).not.toHaveTextContent(/%|\/mo/);
  });

  it('says "email", not "emails", for a count of one', async () => {
    installWith({ monthlyVolume: 1 });
    renderDetail();
    const count = await screen.findByTestId('sender-detail-window-count');
    expect(count.nextElementSibling).toHaveTextContent(/^email in the last 90 days/);
  });

  it('shows an em-dash, never a fabricated 0, when the wire has no 90-day count', async () => {
    installWith({ monthlyVolume: null });
    renderDetail();
    expect(await screen.findByTestId('sender-detail-window-count')).toHaveTextContent('—');
  });

  // The four stats that left the list row all live here.
  it('shows read rate, trend, last seen and "you wrote" in the stats row', async () => {
    installWith({ readRate: 0.42, wroteToCount: 3 });
    renderDetail();

    const stats = within(await screen.findByLabelText('Sender stats'));
    expect(stats.getByText(/Marked read/).nextElementSibling).toHaveTextContent('42%');
    expect(
      stats.getByText('12-month trend').nextElementSibling?.querySelector('svg'),
    ).not.toBeNull();
    expect(stats.getByText('Last seen').nextElementSibling).toHaveTextContent(
      /ago|today|yesterday/,
    );
    expect(stats.getByText('You wrote').nextElementSibling).toHaveTextContent('3×');
    expect(screen.getByLabelText('Now')).toHaveTextContent('Currently in your inbox');
    expect(screen.getByText('Monthly values').closest('details')).toHaveTextContent(
      TIMESERIES[0]!.yearMonth,
    );
  });

  it('shows "—" for a read rate the wire does not know, never 0%', async () => {
    installWith({ readRate: null }, []);
    renderDetail();

    const stats = within(await screen.findByLabelText('Sender stats'));
    expect(stats.getByText(/Marked read/).nextElementSibling).toHaveTextContent(/^—$/);
    expect(stats.getByText('12-month trend').nextElementSibling).toHaveTextContent(/^—$/);
  });

  // F012 / ADR-0037 — the sweeper split must stay VISIBLE (a line, not a
  // tooltip) whenever there is something to disclose. Facts pinned, not
  // the sentence.
  it('shows the sweeper split as visible text only when its count is above zero', async () => {
    installWith({ readRateSweeperMarked: 20819 });
    const first = renderDetail();

    const note = await screen.findByText(/marked read by another tool/);
    expect(note).toHaveTextContent('20,819');
    expect(note).toHaveTextContent(/not counted/);
    first.unmount();

    installWith({ readRateSweeperMarked: 0 });
    renderDetail();
    await screen.findByTestId('sender-detail-window-count');
    expect(screen.queryByText(/marked read by another tool/)).not.toBeInTheDocument();
  });

  /**
   * QA-sender-detail-20260902-01: the hero used to fall back to "Hasn't
   * mailed you yet." for ANY empty 12-month timeseries, including a
   * sender who genuinely has mail history — just outside the window.
   * `totalReceived > 0` with an empty timeseries is exactly that shape.
   */
  it('shows a dormant-sender hero, not "never mailed", for a sender with history outside the 12-month window', async () => {
    installFetchStub([
      { method: 'GET', path: /^\/api\/senders\/[^/]+$/, respond: () => jsonOk({ data: DETAIL }) },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/messages$/,
        respond: () =>
          jsonOk({
            data: [MESSAGE],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/timeseries$/,
        respond: () => jsonOk({ data: [] }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/history$/,
        respond: () =>
          jsonOk({
            data: [HISTORY_ROW],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
    ]);
    renderDetail();

    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());
    // Still a sender with history: the count + lifetime total render,
    // and "Last seen" carries how long ago — never the "never" sentence.
    expect(screen.getByTestId('sender-detail-window-count')).toBeInTheDocument();
    expect(screen.getByText(/2,048 received · all time/)).toBeInTheDocument();
    expect(screen.queryByText(/Hasn.t mailed you yet\./)).not.toBeInTheDocument();
  });

  it('keeps "Hasn\'t mailed you yet." for a sender who genuinely never mailed', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: () => jsonOk({ data: { ...DETAIL, totalReceived: 0 } }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/messages$/,
        respond: () =>
          jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/timeseries$/,
        respond: () => jsonOk({ data: [] }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/history$/,
        respond: () =>
          jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
    ]);
    renderDetail();

    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());
    expect(screen.getByText(/Hasn.t mailed you yet\./)).toBeInTheDocument();
    // No headline number for a sender with no mail at all.
    expect(screen.queryByTestId('sender-detail-window-count')).not.toBeInTheDocument();
  });

  it('shows the action it has, with the real message count', async () => {
    installHappyPath();
    renderDetail();

    await waitFor(() => expect(screen.getByText('Archived')).toBeInTheDocument());
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText(/12 messages/)).toBeInTheDocument();
  });

  /**
   * The defect this page shipped with (founder screenshot 2026-08-19):
   * the timeline was built from `triage_decisions`, so a sender the user
   * had never acted on rendered "Triage Kept · op <uuid>" while Activity
   * showed nothing had happened. History now comes from `activity_log`,
   * so an untouched sender says exactly that.
   */
  /**
   * QA-activity-20260918-02: an Archive the user had undone rendered here
   * as a live decision while Activity marked the same record Undone.
   */
  it('marks an undone action and never calls it the current decision', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: () => jsonOk({ data: DETAIL }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/messages$/,
        respond: () =>
          jsonOk({
            data: [MESSAGE],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/timeseries$/,
        respond: () => jsonOk({ data: TIMESERIES }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/history$/,
        respond: () =>
          jsonOk({
            data: [
              {
                id: 'op-undone',
                action: 'archive',
                source: 'manual',
                occurredAt: '2026-05-12T09:00:00.000Z',
                affectedCount: 47,
                revertedAt: '2026-05-13T10:00:00.000Z',
              },
              {
                id: 'op-standing',
                action: 'keep',
                source: 'manual',
                occurredAt: '2026-05-10T09:00:00.000Z',
                affectedCount: 0,
                revertedAt: null,
              },
            ],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
    ]);
    renderDetail();

    const undoneRow = (await screen.findByTitle('op op-undone')).closest('li');
    const standingRow = screen.getByTitle('op op-standing').closest('li');
    expect(undoneRow).toHaveTextContent('Undone');
    expect(standingRow).not.toHaveTextContent('Undone');
    // The newest row is undone, so "current" belongs to the older one.
    expect(undoneRow).not.toHaveAttribute('data-current');
    expect(standingRow).toHaveAttribute('data-current', 'true');
  });

  it('claims no decision for a sender nobody has acted on', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: () => jsonOk({ data: DETAIL }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/messages$/,
        respond: () =>
          jsonOk({
            data: [MESSAGE],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/timeseries$/,
        respond: () => jsonOk({ data: TIMESERIES }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/history$/,
        respond: () =>
          jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
    ]);
    renderDetail();

    await waitFor(() => expect(screen.getByText(/Nothing decided yet/i)).toBeInTheDocument());
    for (const claim of [
      'Keep decision saved',
      'Archived',
      'Unsubscribe request recorded',
      'Moved to Later',
    ]) {
      expect(screen.queryByText(claim)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/^op /)).not.toBeInTheDocument();
  });

  /**
   * D39 + D245: the engine's read is disclosed BESIDE the fact-derived
   * highlight, never in place of it. Before this landed, the detail wire
   * carried no recommendation at all, so the banner rendered only for
   * mock fixtures and a connected account saw nothing.
   */
  it('discloses the engine suggestion, collapsed, with its age', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: () =>
          jsonOk({
            data: {
              ...DETAIL,
              recommendation: {
                verdict: 'keep',
                confidence: 0.88,
                reasoning: 'You read every message from this sender.',
                generatedBy: 'llm_haiku',
                scoredAt: '2026-05-20T10:00:00.000Z',
              },
            },
          }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/messages$/,
        respond: () =>
          jsonOk({
            data: [MESSAGE],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/timeseries$/,
        respond: () => jsonOk({ data: TIMESERIES }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/history$/,
        respond: () =>
          jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
    ]);
    renderDetail();

    const details = await screen.findByRole('group', { name: 'Optional suggestion: Keep' });
    const summary = details.querySelector('summary')!;
    // QA-sender-detail-20260902-08: "scored" renamed to "Last checked".
    expect(summary).toHaveTextContent(/Last checked/);
    expect(details).not.toHaveAttribute('open');
    // The suggestion never claims the user did anything.
    expect(screen.queryByText(/^op /)).not.toBeInTheDocument();
  });

  it('shows no suggestion for a sender the engine has never scored', async () => {
    installHappyPath();
    renderDetail();

    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());
    expect(screen.queryByRole('group', { name: /Optional suggestion/ })).not.toBeInTheDocument();
  });

  // D226 — every mail-changing verb stops at the preview; none mutates on
  // click. (Keep is the exception by design, D40 — covered below.)
  it.each([
    ['Archive', 'A'],
    ['Unsubscribe', 'U'],
    ['Later', 'L'],
    ['Delete', 'D'],
  ] as const)('%s opens the preview before anything changes', async (verb, key) => {
    installHappyPath();
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: `${verb} (${key})` }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('opens the same preview from the keyboard shortcut', async () => {
    installHappyPath();
    renderDetail();

    await screen.findByRole('button', { name: 'Archive (A)' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('renders the not-found UI when the detail endpoint returns 404', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: () => jsonNotFound('sender_not_found'),
      },
      // Children handlers are not strictly required (the page short-
      // circuits on 404), but installing inert stubs prevents the
      // "no_handler" fallback from polluting the console.
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/(messages|timeseries|history)$/,
        respond: () =>
          jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
    ]);

    renderDetail('ghost');
    await waitFor(() => expect(screen.getByText(/sender not found/i)).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // QA-sender-detail-20260903-01: all four sender-scoped queries hit the
  // same `CurrentMailboxGuard` and 404 for the identical reason (foreign
  // or nonexistent sender id), but resolve as four independent promises
  // with no ordering guarantee. The old guard checked ONLY `detail`'s own
  // error — if a SIBLING settled its 404 first while `detail` was still
  // in flight, the page fell through to the generic "We couldn't load
  // this sender" error state instead of the purpose-built not-found UI,
  // live-reproduced twice on an identical URL. This test forces that
  // exact ordering: `messages` 404s immediately, `detail` stays pending
  // until released mid-test.
  it('shows not-found (not the generic error) when a sibling query 404s before `detail` settles', async () => {
    // Promise executors run synchronously, so `releaseDetail` is always
    // assigned by the time `new Promise` returns — the definite-assignment
    // assertion just tells TS what the language already guarantees here.
    let releaseDetail!: () => void;
    const detailPending = new Promise<void>((resolve) => {
      releaseDetail = resolve;
    });
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: async () => {
          await detailPending;
          return jsonNotFound('sender_not_found');
        },
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/(messages|timeseries|history)$/,
        respond: () => jsonNotFound('sender_not_found'),
      },
    ]);

    renderDetail('ghost');

    // Sibling 404s have already landed; `detail` is still pending. The
    // race this test exists to close: this must already be the
    // not-found UI, never the generic "We couldn't load this sender"
    // retry state.
    await waitFor(() => expect(screen.getByText(/sender not found/i)).toBeInTheDocument());
    expect(screen.queryByText(/we couldn't load this sender/i)).not.toBeInTheDocument();

    // Release `detail`'s own 404 and confirm the page stays correct —
    // no flash back to a loading or error state once it settles too.
    releaseDetail();
    await waitFor(() => expect(screen.getByText(/sender not found/i)).toBeInTheDocument());
    expect(screen.queryByText(/we couldn't load this sender/i)).not.toBeInTheDocument();
  });

  // D38 session-3 — instrument coverage.

  it('fires `sender_detail_opened` exactly once with source from ?from', async () => {
    currentSearch = 'from=senders_table';
    installHappyPath();
    renderDetail();

    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());

    const senderOpenedCalls = trackMock.mock.calls.filter(
      ([name]) => name === 'sender_detail_opened',
    );
    expect(senderOpenedCalls).toHaveLength(1);
    expect(senderOpenedCalls[0]?.[1]).toEqual({
      sender_id: 'linkedin',
      source: 'senders_table',
    });

    const breadcrumbCalls = addBreadcrumbMock.mock.calls.filter(([crumb]) =>
      (crumb as { message?: string }).message?.startsWith('sender-detail-opened'),
    );
    expect(breadcrumbCalls).toHaveLength(1);
  });

  it('falls back to source="search" when ?from is missing or invalid', async () => {
    currentSearch = 'from=not_in_enum';
    installHappyPath();
    renderDetail();

    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());

    const call = trackMock.mock.calls.find(([name]) => name === 'sender_detail_opened');
    expect(call?.[1]).toEqual({ sender_id: 'linkedin', source: 'search' });
  });

  it('fires `gmail_deep_link_opened` with source=recent_messages_row on row click', async () => {
    installHappyPath();
    renderDetail();

    const subjectLink = await waitFor(() => screen.getByText(/top notifications this week/i));
    fireEvent.click(subjectLink);

    const deepLinkCalls = trackMock.mock.calls.filter(
      ([name]) => name === 'gmail_deep_link_opened',
    );
    expect(deepLinkCalls).toHaveLength(1);
    expect(deepLinkCalls[0]?.[1]).toEqual({
      source: 'recent_messages_row',
      deep_link_kind: 'thread',
    });
  });

  it('binds sender search and message links to the active mailbox without /u/0', async () => {
    installHappyPath();
    renderDetail();

    const openAll = await waitFor(() =>
      screen.getByRole('link', { name: /open a gmail search for email from this sender/i }),
    );
    const message = screen.getByRole('link', { name: /top notifications this week/i });

    expect(openAll.getAttribute('href')).toBe(
      'https://mail.google.com/mail/?authuser=active%2Bwork%40gmail.com#search/' +
        'from%3A%22noreply%40linkedin.com%22',
    );
    expect(message.getAttribute('href')).toBe(
      'https://mail.google.com/mail/?authuser=active%2Bwork%40gmail.com#all/p-1',
    );
    expect(openAll.getAttribute('href')).not.toContain('/u/0');
    expect(message.getAttribute('href')).not.toContain('/u/0');

    fireEvent.click(openAll);
    expect(trackMock).toHaveBeenCalledWith('gmail_deep_link_opened', {
      source: 'sender_detail_open_all',
      deep_link_kind: 'all_from_sender',
    });
  });

  it('uses the sender, subject, and received-at fallback when no provider message id exists', async () => {
    installHappyPath({ ...MESSAGE, providerMessageId: '' });
    renderDetail();

    const message = await waitFor(() =>
      screen.getByRole('link', { name: /top notifications this week/i }),
    );
    expect(message.getAttribute('href')).toBe(
      'https://mail.google.com/mail/?authuser=active%2Bwork%40gmail.com#search/' +
        'from%3A%22noreply%40linkedin.com%22%20' +
        'subject%3A%22Top%20notifications%20this%20week%22%20' +
        'after%3A2026%2F05%2F21%20before%3A2026%2F05%2F23',
    );
    expect(message.getAttribute('href')).not.toContain('/u/0');
  });

  it('hides Gmail links when rendered without authenticated mailbox context', async () => {
    authState.current = null;
    installHappyPath();
    renderDetail();

    const subject = await waitFor(() => screen.getByText(/top notifications this week/i));
    expect(subject.closest('a')).toBeNull();
    expect(
      screen.queryByRole('link', { name: /open a gmail search for email from this sender/i }),
    ).not.toBeInTheDocument();
  });

  it('renders an alert on 500 and recovers the sender detail when Retry succeeds', async () => {
    let detailAttempts = 0;
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: () => {
          detailAttempts += 1;
          return detailAttempts <= 4 ? jsonServerError() : jsonOk({ data: DETAIL });
        },
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/(messages|timeseries|history)$/,
        respond: () =>
          jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
    ]);

    renderDetail();
    // Production keeps the shared 1s + 2s + 4s retry backoff for a
    // transient 5xx, so the designed state appears after four failed
    // attempts. The user-triggered retry is the fifth and succeeds.
    const alert = await screen.findByRole('alert', {}, { timeout: 10000 });
    const heading = within(alert).getByRole('heading', { name: /couldn[’']t load this sender/i });
    expect(heading).toBeInTheDocument();
    // QA-sender-detail-20260902-09: the body used to repeat the title's
    // own sentence ("We couldn't load this sender." as the first words
    // of the description, right under a heading that says the same
    // thing). Assert the fixed reassurance line instead, and that it
    // does NOT restate the heading.
    const description = within(alert).getByText(/nothing in your mailbox changed/i);
    expect(description).toBeInTheDocument();
    expect(description.textContent).not.toMatch(/couldn[’']t load this sender/i);

    // QA-sender-detail-20260902-17: "Try again" used to be the only
    // action — a dead end for an error that keeps recurring.
    expect(screen.getByRole('link', { name: /back to senders/i })).toHaveAttribute(
      'href',
      '/senders',
    );

    fireEvent.click(within(alert).getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());
    expect(detailAttempts).toBe(5);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  }, 15000);

  /**
   * QA-sender-detail-20260902-09, defect found by Codex adversarial
   * review: the error-state guard used to fire on bare `detail.isError`,
   * with no check for whether cached data was still around. A background
   * refetch failing right after a successful action (e.g. the invalidation
   * that follows an Archive) would tear the whole page down for a
   * full-page "Nothing in your mailbox changed" takeover — false, since
   * the just-completed action DID change something, and needless, since
   * the page already had something correct to show.
   */
  it('keeps showing the sender when a background refetch fails but cached data is still present', async () => {
    let detailAttempts = 0;
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: () => {
          detailAttempts += 1;
          return detailAttempts === 1 ? jsonOk({ data: DETAIL }) : jsonServerError();
        },
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/(messages|timeseries|history)$/,
        respond: () =>
          jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
    ]);

    const client = createTestQueryClient();
    render(
      <QueryWrapper client={client}>
        <SenderDetailRoute id="linkedin" />
      </QueryWrapper>,
    );
    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());

    // Simulates the invalidation that follows a successful mutation;
    // the retry backoff means this takes a few seconds to settle.
    await client.invalidateQueries();
    await waitFor(() => expect(detailAttempts).toBeGreaterThan(1), { timeout: 10000 });

    // The page must keep showing the sender from cached data — never the
    // full-page error takeover — while the background refetch is failing.
    expect(screen.getByText('LinkedIn')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing in your mailbox changed/i)).not.toBeInTheDocument();
  }, 15000);

  /**
   * QA-sender-detail-20260902-09, Codex adversarial review round 2: the
   * fix above (trust cached data over a background refetch failure) can
   * trust STALE data from a DIFFERENT mailbox — `resetMailboxScopedCache`
   * uses `invalidateQueries()`, not `clear()`, so a switch does not evict
   * the previous mailbox's cached sender; only a successful refetch
   * replaces it. If that refetch then fails, the earlier version of this
   * fix would keep showing the WRONG mailbox's sender. This asserts the
   * opposite of the test above for the identical mechanism: once a
   * mailbox-scope reset has fired, cached data does NOT get trusted again
   * until a fetch has genuinely succeeded since.
   */
  it('does NOT keep showing stale data from a previous mailbox after a switch + failed refetch', async () => {
    let detailAttempts = 0;
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: () => {
          detailAttempts += 1;
          // Succeeds once (mailbox A's cached view), fails on every
          // attempt after the simulated mailbox switch below.
          return detailAttempts === 1 ? jsonOk({ data: DETAIL }) : jsonServerError();
        },
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/(messages|timeseries|history)$/,
        respond: () =>
          jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
    ]);

    const client = createTestQueryClient();
    render(
      <QueryWrapper client={client}>
        <SenderDetailRoute id="linkedin" />
      </QueryWrapper>,
    );
    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());

    // Simulates `resetMailboxScopedCache`: the real switch dispatches
    // this event AND invalidates every query, triggering the refetch
    // that will fail on this mailbox's now-wrong sender id.
    window.dispatchEvent(new Event(MAILBOX_SCOPE_RESET_EVENT));
    await client.invalidateQueries();
    await waitFor(() => expect(detailAttempts).toBeGreaterThan(1), { timeout: 10000 });

    // The page must NOT keep showing mailbox A's cached sender once a
    // scope reset has fired and the post-reset refetch has failed.
    await waitFor(() => expect(screen.queryByText('LinkedIn')).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toBeInTheDocument();
  }, 15000);

  /**
   * Codex review 2026-09-03 on the four-query `notFound` fix above:
   * `resetMailboxScopedCache` invalidates rather than clears, so a
   * query's STALE error from the mailbox you just switched AWAY from
   * can still be sitting on it while it refetches in the background
   * after a switch back. Checking four queries instead of one widens
   * that exposure — any one of them, not just `detail`, can carry a
   * stale 404. Forces the exact sequence: mailbox A loads clean, a
   * switch to B 404s `history` (correct — B has no such sender), then a
   * switch back to A holds `history`'s refetch pending. While it's
   * pending, `history.error` is still B's 404, dated BEFORE the second
   * reset — the fix must not treat it as authoritative for A.
   */
  it("does not go not-found on a sibling's stale 404 from before the last mailbox switch", async () => {
    let historyCallCount = 0;
    let releaseThirdHistoryCall!: () => void;
    const thirdHistoryCallPending = new Promise<void>((resolve) => {
      releaseThirdHistoryCall = resolve;
    });
    const historyPage = () =>
      jsonOk({
        data: [HISTORY_ROW],
        meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
      });
    installFetchStub([
      { method: 'GET', path: /^\/api\/senders\/[^/]+$/, respond: () => jsonOk({ data: DETAIL }) },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/messages$/,
        respond: () =>
          jsonOk({
            data: [MESSAGE],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/timeseries$/,
        respond: () => jsonOk({ data: TIMESERIES }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/history$/,
        respond: async () => {
          historyCallCount += 1;
          if (historyCallCount === 1) return historyPage(); // mailbox A, initial load
          if (historyCallCount === 2) return jsonNotFound('sender_not_found'); // switched to B
          await thirdHistoryCallPending; // switched back to A — held pending
          return historyPage();
        },
      },
    ]);

    const client = createTestQueryClient();
    render(
      <QueryWrapper client={client}>
        <SenderDetailRoute id="linkedin" />
      </QueryWrapper>,
    );
    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());

    // Switch A -> B, through the REAL helper (not a manual dispatch +
    // invalidate) — Codex review 2026-09-03 round 2: an earlier version
    // of this test dispatched the event and invalidated separately, in
    // the opposite order production actually uses, so it didn't exercise
    // the real race at all. Not asserting UI here — B genuinely has no
    // such sender, so not-found would be the correct render.
    await resetMailboxScopedCache(client);
    await waitFor(() => expect(historyCallCount).toBe(2));

    // Switch B -> A: history's refetch is deliberately left pending, so
    // its cached error is still B's 404 while detail/messages/timeseries
    // are unaffected mocks that stay ready throughout. Must NOT await —
    // `resetMailboxScopedCache` awaits every refetch settling.
    void resetMailboxScopedCache(client);

    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());
    expect(screen.queryByText(/sender not found/i)).not.toBeInTheDocument();

    releaseThirdHistoryCall();
    await waitFor(() => expect(historyCallCount).toBe(3));
    expect(screen.getByText('LinkedIn')).toBeInTheDocument();
    expect(screen.queryByText(/sender not found/i)).not.toBeInTheDocument();
  }, 15000);

  // Standing-policy writes (Keep + Protect).

  describe('standing-policy writes', () => {
    function installPolicyPatch(respond: (req: Request) => Response | Promise<Response>) {
      addFetchHandlers([
        {
          method: 'PATCH',
          path: /^\/api\/senders\/[^/]+\/policy$/,
          respond: (req) => respond(req),
        },
      ]);
    }

    it('Protect chip PATCHes { isProtected: true } and rolls back on failure', async () => {
      installHappyPath();
      const bodies: unknown[] = [];
      let fail = false;
      installPolicyPatch(async (req) => {
        bodies.push(await req.json());
        if (fail) return jsonServerError();
        return jsonOk({
          data: {
            senderId: 'linkedin',
            policyType: null,
            isProtected: true,
            protectionReason: 'user_defined',
            protectionSetAt: '2026-06-09T00:00:00.000Z',
            changed: true,
          },
        });
      });
      renderDetail();

      const protectSwitch = await waitFor(() =>
        screen.getByRole('switch', { name: 'Protected', checked: false }),
      );
      fireEvent.click(protectSwitch);
      await waitFor(() => expect(bodies).toEqual([{ isProtected: true }]));
      expect(screen.getByRole('switch', { name: 'Protected', checked: true })).toBeInTheDocument();
      // CLAUDE.md §2.6 / D245 — the exact reason, on the surface that
      // owns this sender. The toggle said only "Protect", so a user
      // looking at an automatically-protected sender had no way to
      // learn why (three of the four reasons are automatic).
      // Rendered ONCE, as the visible line — not repeated as a tooltip.
      // It sits under the row's "Protected" label, so it is the reason alone.
      expect(screen.getByTestId('protection-reason')).toHaveTextContent(/marked it Protected\.$/);
      // The tooltip carries the one thing the label cannot: that a click
      // unprotects. It does not repeat the reason.
      const protectedToggle = screen.getByRole('switch', { name: 'Protected', checked: true });
      expect(protectedToggle).toHaveAttribute('title', expect.stringMatching(/unprotect/i));
      expect(protectedToggle.getAttribute('title')).not.toMatch(/—/);

      // Second toggle (unprotect) fails → rollback to the set chip.
      fail = true;
      fireEvent.click(screen.getByRole('switch', { name: 'Protected', checked: true }));
      await waitFor(() => expect(bodies).toHaveLength(2));
      expect(bodies[1]).toEqual({ isProtected: false });
      await waitFor(() =>
        expect(
          screen.getByRole('switch', { name: 'Protected', checked: true }),
        ).toBeInTheDocument(),
      );
    });

    it('re-seeds header policy state when a refetch returns diverged data (cross-tab change)', async () => {
      // Another tab / session protects this sender. The detail query
      // refetch must surface the server value without a remount —
      // `useState(initial)` alone would silently drop it.
      let serverIsProtected = false;
      installFetchStub([
        {
          method: 'GET',
          path: /^\/api\/senders\/[^/]+$/,
          respond: () =>
            jsonOk({
              data: {
                ...DETAIL,
                protectionFlags: {
                  ...DETAIL.protectionFlags,
                  isProtected: serverIsProtected,
                  protectionReason: serverIsProtected ? 'user_defined' : null,
                },
              },
            }),
        },
        {
          method: 'GET',
          path: /^\/api\/senders\/[^/]+\/messages$/,
          respond: () =>
            jsonOk({
              data: [MESSAGE],
              meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
            }),
        },
        {
          method: 'GET',
          path: /^\/api\/senders\/[^/]+\/timeseries$/,
          respond: () => jsonOk({ data: TIMESERIES }),
        },
        {
          method: 'GET',
          path: /^\/api\/senders\/[^/]+\/history$/,
          respond: () =>
            jsonOk({
              data: [HISTORY_ROW],
              meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
            }),
        },
      ]);

      const client = createTestQueryClient();
      render(
        <QueryWrapper client={client}>
          <SenderDetailRoute id="linkedin" />
        </QueryWrapper>,
      );
      await waitFor(() => screen.getByRole('switch', { name: 'Protected', checked: false }));

      // Server diverges, then any invalidation-driven refetch lands.
      serverIsProtected = true;
      await client.invalidateQueries();

      await waitFor(() =>
        expect(
          screen.getByRole('switch', { name: 'Protected', checked: true }),
        ).toBeInTheDocument(),
      );
    });

    it('Keep verb PATCHes { policyType: "keep" } (D40 — applies immediately, no preview)', async () => {
      installHappyPath();
      let capturedBody: unknown = null;
      installPolicyPatch(async (req) => {
        capturedBody = await req.json();
        return jsonOk({
          data: {
            senderId: 'linkedin',
            policyType: 'keep',
            isProtected: false,
            protectionReason: null,
            protectionSetAt: null,
            changed: true,
          },
        });
      });
      renderDetail();

      const keepButton = await waitFor(() => screen.getByRole('button', { name: 'Keep (K)' }));
      fireEvent.click(keepButton);

      await waitFor(() => expect(capturedBody).toEqual({ policyType: 'keep' }));
    });
  });

  // D226 overdue release + re-entry guard (2026-08-12 incident).

  describe('action latch — overdue release + guard trip', () => {
    /** Live composite preview for the fixture sender — arms the D226 confirm. */
    function detailPreviewHandler(opts: { count?: () => number; onFetch?: () => void } = {}) {
      return {
        method: 'GET' as const,
        path: '/api/actions/preview',
        respond: () => {
          opts.onFetch?.();
          return jsonOk({
            data: {
              sender: {
                id: 'linkedin',
                name: 'LinkedIn',
                domain: 'linkedin.com',
                lastSeenDays: 2,
                wroteToCount: 0,
                monthly: 64,
              },
              counts: {
                all: opts.count?.() ?? 12,
                olderThan30d: 0,
                olderThan90d: 0,
                olderThan180d: 0,
                olderThan365d: 0,
              },
              recentMessages: {
                all: [],
                olderThan30d: [],
                olderThan90d: [],
                olderThan180d: [],
                olderThan365d: [],
              },
              unsubAvailable: true,
              protected: false,
            },
          });
        },
      };
    }

    function actionStatusBody(id: string, done: boolean) {
      return {
        actionId: id,
        verb: 'archive',
        direction: 'forward',
        status: done ? 'done' : 'executing',
        requestedCount: 12,
        affectedCount: done ? 12 : 0,
        wakeAt: null,
        undoToken: done ? 'tok-1' : null,
        undoExpiresAt: done ? '2027-06-16T14:35:00.000Z' : null,
        undoExecutedAt: null,
        undoRevertedAt: null,
        errorCode: null,
      };
    }

    beforeEach(() => h.toast.mockClear());

    /** The pressed verb's slot, once it reads as done. */
    const doneMark = () => document.querySelector('[data-dm-row-activity="done"]');

    it('parks a stuck action at ACTION_OVERDUE_MS, keeps THIS sender locked until it terminates, then frees the guard', async () => {
      vi.useFakeTimers();
      try {
        let actionPosts = 0;
        let firstActionDone = false;
        let previewGets = 0;
        let previewCount = 12;
        installHappyPath();
        addFetchHandlers([
          detailPreviewHandler({
            count: () => previewCount,
            onFetch: () => {
              previewGets += 1;
            },
          }),
          {
            method: 'POST',
            path: '/api/actions',
            respond: () => {
              actionPosts += 1;
              return jsonOk({
                data: { actionId: `act-${actionPosts}`, requestedCount: 12, status: 'queued' },
              });
            },
          },
          {
            method: 'GET',
            path: /^\/api\/actions\/[^/]+$/,
            respond: (_req, url) => {
              const id = url.pathname.split('/').pop() ?? 'act-1';
              return jsonOk({ data: actionStatusBody(id, id === 'act-1' && firstActionDone) });
            },
          },
        ]);
        const tick = (ms: number) =>
          act(async () => {
            await vi.advanceTimersByTimeAsync(ms);
          });

        const client = createTestQueryClient();
        const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
        render(
          <QueryWrapper client={client}>
            <SenderDetailRoute id="linkedin" />
          </QueryWrapper>,
        );
        await tick(200);
        fireEvent.click(screen.getByRole('button', { name: 'Archive (A)' }));
        await tick(200);
        screen.getByText(/rechecked when it runs/i);
        fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
        await tick(200);
        expect(actionPosts).toBe(1);

        // The worker never reports terminal. At the deadline the handle
        // parks with the overdue toast — but this page is single-sender,
        // so the parked handle still owns the ONLY subject.
        await tick(ACTION_OVERDUE_MS);
        expect(h.toast).toHaveBeenCalledWith(
          expect.stringMatching(/^Archive for LinkedIn is still running/),
          'info',
        );

        // A second action on the SAME sender cannot even start (a
        // re-dispatch would mint a second real Gmail job). It used to be
        // refused by a toast after a second confirm; now the toolbar says
        // why and its verbs are inert (founder report 2026-09-20 — nothing
        // on the page showed a job was still running).
        // The pressed verb has BECOME the status; it takes no second press.
        const archiveAgain = screen.getByRole('button', { name: 'Archive not confirmed' });
        expect(archiveAgain).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('toolbar', { name: 'Sender actions' })).toHaveAttribute(
          'aria-busy',
          'true',
        );
        expect(screen.getByText('Archive not confirmed')).toBeInTheDocument();
        fireEvent.click(archiveAgain);
        await tick(200);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(actionPosts).toBe(1);

        // The parked handle kept polling: done still invalidates both
        // surfaces and surfaces the receipt — with NO success toast.
        // The archive just moved mail, so the kept-open preview must be
        // re-counted too (D226) — the pre-action count would otherwise
        // re-arm the confirm with a number the mutation made stale.
        invalidateSpy.mockClear();
        const previewGetsBefore = previewGets;
        previewCount = 5;
        firstActionDone = true;
        await tick(2_500);
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: sendersKeys.all });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: activityKeys.all });
        // The verb that was "not confirmed" now says what happened.
        expect(doneMark()).toHaveTextContent('Archived 12');
        const successToast = h.toast.mock.calls.find(([msg]) => /12 email/i.test(String(msg)));
        expect(successToast).toBeUndefined();

        // With the parked handle terminal the toolbar frees, and says how
        // it ended. A NEW action opens against a re-counted preview (D226
        // — the archive just moved mail) and dispatches.
        expect(screen.getByText('Archived 12')).toBeInTheDocument();
        const archiveFreed = screen.getByRole('button', {
          name: 'Archived 12 — Archive again (A)',
        });
        expect(archiveFreed).not.toHaveAttribute('aria-disabled');
        fireEvent.click(archiveFreed);
        await tick(500);
        expect(previewGets).toBeGreaterThan(previewGetsBefore);
        expect(
          within(screen.getByRole('dialog')).getByRole('heading', { name: 'Archive 5 emails?' }),
        ).toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
        await tick(200);
        expect(actionPosts).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('holds the confirm on "Submitting…" until the server accepts, then shows the page working', async () => {
      let accept!: () => void;
      const accepted = new Promise<void>((resolve) => {
        accept = resolve;
      });
      installHappyPath();
      addFetchHandlers([
        detailPreviewHandler(),
        {
          method: 'POST',
          path: '/api/actions',
          respond: async () => {
            await accepted;
            return jsonOk({ data: { actionId: 'act-slow', requestedCount: 12, status: 'queued' } });
          },
        },
        {
          method: 'GET',
          path: /^\/api\/actions\/[^/]+$/,
          respond: () => jsonOk({ data: actionStatusBody('act-slow', false) }),
        },
      ]);
      renderDetail();
      fireEvent.click(await screen.findByRole('button', { name: 'Archive (A)' }));
      await screen.findByText(/rechecked when it runs/i);
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

      // It used to close before the request was even sent.
      const dialog = screen.getByRole('dialog');
      await within(dialog).findByRole('button', { name: /Submitting…/ });
      expect(screen.queryByText('Archiving…')).toBeNull();

      accept();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await screen.findByText('Archiving…');
      expect(trackMock).toHaveBeenCalledWith('action_confirmed', {
        journey: 'daily',
        verb: 'archive',
      });
    });

    it('lets no second action start while the first is still confirming', async () => {
      let actionPosts = 0;
      let statusGets = 0;
      installHappyPath();
      addFetchHandlers([
        detailPreviewHandler(),
        {
          method: 'POST',
          path: '/api/actions',
          respond: () => {
            actionPosts += 1;
            return jsonOk({
              data: { actionId: 'act-stuck', requestedCount: 12, status: 'queued' },
            });
          },
        },
        {
          method: 'GET',
          path: /^\/api\/actions\/[^/]+$/,
          respond: () => {
            statusGets += 1;
            return jsonOk({ data: actionStatusBody('act-stuck', false) });
          },
        },
      ]);
      renderDetail();

      const archiveButton = await screen.findByRole('button', { name: 'Archive (A)' });
      fireEvent.click(archiveButton);
      await screen.findByText(/rechecked when it runs/i);
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      await waitFor(() => expect(actionPosts).toBe(1));
      // The latch is armed once its status poll starts.
      await waitFor(() => expect(statusGets).toBeGreaterThan(0));

      // While the first is still confirming, the page says so and a
      // second action cannot start — no modal, no second POST.
      await screen.findByText('Archiving…');
      // The pressed verb has BECOME the status; it takes no second press.
      const archiveAgain = screen.getByRole('button', { name: 'Archiving…' });
      expect(archiveAgain).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(archiveAgain);
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(actionPosts).toBe(1);
    });

    // QA-delete-20260829-05 — the global undo tray (`ProductUndoTray`)
    // reverts a token through its OWN `useRevertUndo()` instance, mounted
    // in a separate component tree from this page. Before the fix, this
    // page's `receipt` was local `useState` that only cleared on ITS OWN
    // Undo click, so it kept asserting "Moved to Gmail Trash" for mail the
    // tray had already restored. Not Delete-specific — reused the
    // Archive fixtures already in this block since the undo-sync mechanism
    // is identical for every verb.
    //
    // This covers the immediate-revert response shape (`reverted: true`).
    // The far more common shape — `reverted: false` plus an `actionId` to
    // poll — is covered separately below (Codex round 1 caught that the
    // first cut of this fix only handled this rarer, already-reverted case).
    describe('the page says how its action ended', () => {
      const pill = (phase: string) => document.querySelector(`[data-dm-row-activity="${phase}"]`);

      async function archiveWith(status: () => Response) {
        installHappyPath();
        addFetchHandlers([
          detailPreviewHandler(),
          {
            method: 'POST',
            path: '/api/actions',
            respond: () =>
              jsonOk({ data: { actionId: 'act-end', requestedCount: 12, status: 'queued' } }),
          },
          { method: 'GET', path: /^\/api\/actions\/[^/]+$/, respond: status },
        ]);
        renderDetail();
        fireEvent.click(await screen.findByRole('button', { name: 'Archive (A)' }));
        await screen.findByText(/rechecked when it runs/i);
        fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      }

      it('marks a failed job as failed — never back to looking untouched', async () => {
        await archiveWith(() =>
          jsonOk({
            data: { ...actionStatusBody('act-end', false), status: 'failed', errorCode: 'GMAIL' },
          }),
        );
        await waitFor(() => expect(pill('failed')).toHaveTextContent('Archive failed'));
      });

      it('marks a lost status poll as not confirmed, and keeps the verb locked', async () => {
        await archiveWith(() => jsonServerError());
        await waitFor(() => expect(pill('unconfirmed')).toHaveTextContent('Archive not confirmed'));
        expect(screen.getByRole('button', { name: 'Archive not confirmed' })).toHaveAttribute(
          'aria-disabled',
          'true',
        );
      });

      it('marks the past-email half as failed when it never enqueues after an unsubscribe', async () => {
        installHappyPath();
        addFetchHandlers([
          detailPreviewHandler(),
          {
            method: 'POST',
            path: '/api/actions/unsubscribe-intent',
            respond: () =>
              jsonOk({
                data: {
                  senderId: 'linkedin',
                  recordedAt: '2026-07-12T12:00:00.000Z',
                  activityLogId: 'activity-a',
                  method: 'none',
                  executionActionId: null,
                  mailtoUrl: null,
                },
              }),
          },
          { method: 'POST', path: '/api/actions', respond: () => jsonServerError() },
        ]);
        renderDetail();
        fireEvent.click(await screen.findByRole('button', { name: 'Unsubscribe (U)' }));
        await screen.findByRole('radiogroup', { name: /also act on past emails/i });
        fireEvent.click(screen.getByRole('radio', { name: 'Archive them' }));
        const confirm = screen.getByRole('button', { name: /Unsubscribe.*Archive/i });
        await waitFor(() => expect(confirm).toBeEnabled());
        fireEvent.click(confirm);
        await waitFor(() => expect(pill('failed')).toHaveTextContent('Archive failed'));
      });

      it('drops the last mark when a new Unsubscribe starts', async () => {
        await archiveWith(() => jsonOk({ data: actionStatusBody('act-end', true) }));
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        addFetchHandlers([
          {
            method: 'POST',
            path: '/api/actions/unsubscribe-intent',
            respond: async () => {
              await held;
              return jsonServerError();
            },
          },
        ]);
        await waitFor(() => expect(pill('done')).not.toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe (U)' }));
        const dialog = await screen.findByRole('dialog');
        const confirm = await within(dialog).findByRole('button', { name: /Unsubscribe/ });
        await waitFor(() => expect(confirm).toBeEnabled());
        fireEvent.click(confirm);
        // Mid-request: "Archived" no longer sits beside an unsubscribe in flight.
        await within(dialog).findByRole('button', { name: /Submitting…/ });
        expect(pill('done')).toBeNull();
        release();
      });

      it('drops the done mark once the action is undone', async () => {
        await archiveWith(() => jsonOk({ data: actionStatusBody('act-end', true) }));
        addFetchHandlers([
          {
            method: 'POST',
            path: '/api/undo/tok-1',
            respond: () => jsonOk({ data: { verb: 'archive', reverted: true, actionId: null } }),
          },
        ]);
        await waitFor(() => expect(pill('done')).toHaveTextContent('Archived 12'));
        // Undo arrives from the bottom pill's own `useRevertUndo()`.
        const { result } = renderHook(() => useRevertUndo(), {
          wrapper: ({ children }) => <QueryWrapper client={lastClient}>{children}</QueryWrapper>,
        });
        await act(async () => {
          result.current.mutate({ token: 'tok-1' });
          await waitFor(() => expect(result.current.isSuccess).toBe(true));
        });
        await waitFor(() => expect(pill('done')).toBeNull());
      });
    });

    it("clears the receipt when a DIFFERENT component's useRevertUndo() reverts the same token (external undo, immediate)", async () => {
      let actionPosts = 0;
      let undoPosts = 0;
      installHappyPath();
      addFetchHandlers([
        detailPreviewHandler(),
        {
          method: 'POST',
          path: '/api/actions',
          respond: () => {
            actionPosts += 1;
            return jsonOk({ data: { actionId: 'act-ext', requestedCount: 12, status: 'queued' } });
          },
        },
        {
          method: 'GET',
          path: /^\/api\/actions\/[^/]+$/,
          respond: () => jsonOk({ data: actionStatusBody('act-ext', true) }),
        },
        {
          method: 'POST',
          path: '/api/undo/tok-1',
          respond: () => {
            undoPosts += 1;
            return jsonOk({ data: { verb: 'archive', reverted: true, actionId: null } });
          },
        },
      ]);

      const client = createTestQueryClient();
      render(
        <QueryWrapper client={client}>
          <SenderDetailRoute id="linkedin" />
        </QueryWrapper>,
      );

      const archiveButton = await screen.findByRole('button', { name: 'Archive (A)' });
      fireEvent.click(archiveButton);
      await screen.findByText(/rechecked when it runs/i);
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      await waitFor(() => expect(actionPosts).toBe(1));

      // The page is holding the result, carrying the fixture's `undoToken: 'tok-1'`.
      await waitFor(() => expect(doneMark()).not.toBeNull());

      // Simulate the tray: a SEPARATE `useRevertUndo()` instance, sharing
      // only the QueryClient — never touching this page's React tree.
      const { result } = renderHook(() => useRevertUndo(), {
        wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
      });
      await act(async () => {
        result.current.mutate({ token: 'tok-1' });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
      });

      expect(undoPosts).toBe(1);
      await waitFor(() => expect(doneMark()).toBeNull());
      expect(actionPosts).toBe(1);
    });

    // Codex round 1: a FRESH token's revert normally returns `reverted:
    // false` with an `actionId` to poll, not the immediate `reverted: true`
    // above — that pending shape is what the global tray actually produces
    // on a first-time Undo, and the original fix silently missed it.
    it('clears the receipt via the poll-to-terminal path when the external revert is still pending (reverted: false)', async () => {
      h.toast.mockClear();
      let actionPosts = 0;
      let undoPosts = 0;
      installHappyPath();
      addFetchHandlers([
        detailPreviewHandler(),
        {
          method: 'POST',
          path: '/api/actions',
          respond: () => {
            actionPosts += 1;
            return jsonOk({ data: { actionId: 'act-ext2', requestedCount: 12, status: 'queued' } });
          },
        },
        {
          method: 'GET',
          path: /^\/api\/actions\/[^/]+$/,
          respond: () => jsonOk({ data: actionStatusBody('act-ext2', true) }),
        },
        {
          method: 'POST',
          path: '/api/undo/tok-1',
          respond: () => {
            undoPosts += 1;
            return jsonOk({ data: { verb: 'archive', reverted: false, actionId: 'act-revert-1' } });
          },
        },
      ]);

      const client = createTestQueryClient();
      render(
        <QueryWrapper client={client}>
          <SenderDetailRoute id="linkedin" />
        </QueryWrapper>,
      );

      const archiveButton = await screen.findByRole('button', { name: 'Archive (A)' });
      fireEvent.click(archiveButton);
      await screen.findByText(/rechecked when it runs/i);
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      await waitFor(() => expect(actionPosts).toBe(1));
      await waitFor(() => expect(doneMark()).not.toBeNull());

      const { result } = renderHook(() => useRevertUndo(), {
        wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
      });
      await act(async () => {
        result.current.mutate({ token: 'tok-1' });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
      });

      // Not cleared yet — the revert only enqueued a reverse job.
      expect(undoPosts).toBe(1);
      expect(doneMark()).not.toBeNull();

      // The QUIET `externalRevertActionId` poll (fed `act-revert-1` by the
      // mutation-cache listener) resolves terminal and clears the receipt —
      // but Codex round 2: it must NOT toast. The tray that actually
      // performed this revert already told the user; this page repeating
      // the undo-completion toast would be a duplicate confirmation for
      // one action.
      await waitFor(() => expect(doneMark()).toBeNull(), { timeout: 3000 });
      expect(actionPosts).toBe(1);
      expect(h.toast).not.toHaveBeenCalledWith(UNDO_DONE_TOAST, 'success');
    });
  });
});

/**
 * D25 `stale_refresh` on Sender Detail.
 *
 * Nothing in production revisits a sender's read — `sync_complete` scores
 * once at initial sync, `signal_change` fires only for a first-seen
 * sender, and the documented weekly `cron_sweep` has no producer. Opening
 * a sender is therefore the moment to ask for a fresh one.
 *
 * These tests exist because browser smoking on 2026-08-19 could not
 * settle whether the page actually asks: the route flips between server-
 * and client-rendering across reloads (`useSearchParams` puts it behind
 * the route's `<Suspense>`), and a fetch spy dies with every reload. The
 * first attempt at a standalone test hand-rolled its own detail fixture,
 * never loaded, and "proved" the POST was missing when in fact nothing
 * had rendered — a blind guard. Hence `installHappyPath`'s proven
 * fixture, and an explicit assertion that the page LOADED before any
 * conclusion is drawn about the POST.
 */
describe('SenderDetailRoute — refreshing an aged-out read (D25)', () => {
  let posted: Array<Record<string, unknown>>;

  function stubWithRecommendation(recommendation: Record<string, unknown> | null) {
    posted = [];
    window.sessionStorage.clear();
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: () => jsonOk({ data: { ...DETAIL, recommendation } }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/messages$/,
        respond: () =>
          jsonOk({
            data: [MESSAGE],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/timeseries$/,
        respond: () => jsonOk({ data: TIMESERIES }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/history$/,
        respond: () =>
          jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
      {
        method: 'POST',
        path: '/api/triage/score-sender',
        respond: async (req: Request) => {
          posted.push((await req.json()) as Record<string, unknown>);
          return jsonOk({ data: { idempotencyKey: 'k' } });
        },
      },
    ]);
  }

  const AGED = {
    verdict: 'unsubscribe',
    confidence: 0.87,
    reasoning: 'Sends roughly 27 messages monthly with a 0% read rate.',
    generatedBy: 'llm_haiku',
    scoredAt: '2026-07-31T06:44:56.910Z',
    stale: true,
  };

  it('asks for a fresh read when the stored one has aged past its TTL', async () => {
    stubWithRecommendation(AGED);
    renderDetail();
    // Guard the guard: a missing POST proves nothing if the page never
    // loaded. Fail on the fixture first, not on the assertion under test.
    await screen.findByRole('group', { name: /Optional suggestion/ });
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ senderId: 'linkedin', reason: 'stale' });
  });

  it('leaves a read that is still inside its TTL alone', async () => {
    stubWithRecommendation({ ...AGED, stale: false });
    renderDetail();
    await screen.findByRole('group', { name: /Optional suggestion/ });
    await new Promise((r) => setTimeout(r, 60));
    expect(posted).toHaveLength(0);
  });

  /**
   * `stale` absent is UNKNOWN, not "aged out". The wire has carried
   * `scoredAt` without `stale` since the recommendation first shipped;
   * treating that as stale would re-score every sender anyone opens.
   */
  it('treats an absent staleness flag as unknown', async () => {
    const { stale: _omitted, ...noFlag } = AGED;
    stubWithRecommendation(noFlag);
    renderDetail();
    await screen.findByRole('group', { name: /Optional suggestion/ });
    await new Promise((r) => setTimeout(r, 60));
    expect(posted).toHaveLength(0);
  });

  /**
   * `null` recommendation = the engine has never scored this sender.
   * Different fact from "scored and aged out", same correct response.
   */
  it('asks when the engine has never scored the sender', async () => {
    stubWithRecommendation(null);
    renderDetail();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ senderId: 'linkedin' });
  });
});
