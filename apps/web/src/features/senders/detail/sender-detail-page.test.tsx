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

const TIMESERIES = Array.from({ length: 12 }, (_, i) => ({
  yearMonth: `2025-${String(i + 1).padStart(2, '0')}-01`,
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

function renderDetail(id = 'linkedin') {
  const client = createTestQueryClient();
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
    // Wire-backed category and recent-message subject are present. The
    // endpoint has no recommendation payload, so no fixture suggestion
    // may appear even though this sender's facts used to synthesize one.
    expect(screen.getByText('Gmail: Social')).toBeInTheDocument();
    expect(screen.getByText(/top notifications this week/i)).toBeInTheDocument();
    expect(screen.queryByText(/Optional suggestion/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/confidence \d+%/i)).not.toBeInTheDocument();
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

    await waitFor(() =>
      expect(screen.getByText(/No actions on this sender yet/i)).toBeInTheDocument(),
    );
    for (const claim of ['Kept', 'Archived', 'Unsubscribe requested', 'Moved to Later']) {
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

    const summary = await screen.findByText(/Optional suggestion · Keep/);
    expect(summary).toHaveTextContent(/scored/);
    expect(summary.closest('details')).not.toHaveAttribute('open');
    // The suggestion never claims the user did anything.
    expect(screen.queryByText(/^op /)).not.toBeInTheDocument();
  });

  it('shows no suggestion for a sender the engine has never scored', async () => {
    installHappyPath();
    renderDetail();

    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());
    expect(screen.queryByText(/Optional suggestion/i)).not.toBeInTheDocument();
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
      screen.getByRole('link', { name: /open all messages from this sender in gmail/i }),
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
      screen.queryByRole('link', { name: /open all messages from this sender in gmail/i }),
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
    expect(
      within(alert).getByRole('heading', { name: /couldn[’']t load this sender/i }),
    ).toBeInTheDocument();
    expect(
      within(alert).getByText(/gmail messages and sender settings haven.t changed/i),
    ).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());
    expect(detailAttempts).toBe(5);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

      const protectButton = await waitFor(() => screen.getByRole('button', { name: 'Protect' }));
      fireEvent.click(protectButton);
      await waitFor(() => expect(bodies).toEqual([{ isProtected: true }]));
      expect(screen.getByRole('button', { name: '◆ Protect' })).toBeInTheDocument();
      // CLAUDE.md §2.6 / D245 — the exact reason, on the surface that
      // owns this sender. The toggle said only "Protect", so a user
      // looking at an automatically-protected sender had no way to
      // learn why (three of the four reasons are automatic).
      expect(screen.getByRole('button', { name: '◆ Protect' })).toHaveAttribute(
        'title',
        expect.stringMatching(
          /^Protected — .+\. Select to remove protection\.$/,
        ) as unknown as string,
      );

      // Second toggle (unprotect) fails → rollback to the set chip.
      fail = true;
      fireEvent.click(screen.getByRole('button', { name: '◆ Protect' }));
      await waitFor(() => expect(bodies).toHaveLength(2));
      expect(bodies[1]).toEqual({ isProtected: false });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '◆ Protect' })).toBeInTheDocument(),
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
      await waitFor(() => screen.getByRole('button', { name: 'Protect' }));

      // Server diverges, then any invalidation-driven refetch lands.
      serverIsProtected = true;
      await client.invalidateQueries();

      await waitFor(() =>
        expect(screen.getByRole('button', { name: '◆ Protect' })).toBeInTheDocument(),
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
        screen.getByText(/currently match.*Archive/i);
        fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
        await tick(200);
        expect(actionPosts).toBe(1);

        // The worker never reports terminal. At the deadline the handle
        // parks with the overdue toast — but this page is single-sender,
        // so the parked handle still owns the ONLY subject.
        await tick(ACTION_OVERDUE_MS);
        expect(h.toast).toHaveBeenCalledWith(
          'Archive for LinkedIn is taking longer than usual — it keeps running and will appear in Activity when it finishes.',
          'info',
        );

        // A second confirm on the SAME sender is refused (a re-dispatch
        // would mint a second real Gmail job) and the confirmed preview
        // stays open — the intent is not dropped.
        fireEvent.click(screen.getByRole('button', { name: 'Archive (A)' }));
        await tick(200);
        fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
        await tick(200);
        expect(actionPosts).toBe(1);
        expect(h.toast).toHaveBeenCalledWith(
          'Still confirming your last action — give it a moment.',
          'info',
        );
        expect(screen.getByRole('dialog')).toBeInTheDocument();

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
        expect(screen.getByRole('button', { name: /^undo$/i })).toBeInTheDocument();
        const successToast = h.toast.mock.calls.find(([msg]) => /12 email/i.test(String(msg)));
        expect(successToast).toBeUndefined();

        // The kept-open preview REFETCHED and now shows the fresh
        // post-archive count…
        expect(previewGets).toBeGreaterThan(previewGetsBefore);
        const rearmedDialog = screen.getByRole('dialog');
        expect(within(rearmedDialog).getAllByText('5').length).toBeGreaterThan(0);

        // …and with the parked handle terminal, the guard truly frees:
        // the re-armed confirm dispatches against that fresh count.
        fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
        await tick(200);
        expect(actionPosts).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the confirmed preview open when the re-entry guard trips (intent is not dropped)', async () => {
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
      await screen.findByText(/currently match.*Archive/i);
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      await waitFor(() => expect(actionPosts).toBe(1));
      // The latch is armed once its status poll starts.
      await waitFor(() => expect(statusGets).toBeGreaterThan(0));

      // Second confirmed action while the first is still confirming: the
      // guard trips — but the pending confirm surface must stay open so
      // the confirmed intent survives (pre-fix it was silently cleared).
      fireEvent.click(screen.getByRole('button', { name: 'Archive (A)' }));
      await screen.findByText(/currently match.*Archive/i);
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(
          'Still confirming your last action — give it a moment.',
          'info',
        ),
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
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
    it("clears the receipt when a DIFFERENT component's useRevertUndo() reverts the same token (external undo)", async () => {
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
      await screen.findByText(/currently match.*Archive/i);
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      await waitFor(() => expect(actionPosts).toBe(1));

      // The receipt is up, carrying the fixture's `undoToken: 'tok-1'`.
      await screen.findByRole('button', { name: /^undo$/i });

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
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /^undo$/i })).not.toBeInTheDocument(),
      );
      expect(actionPosts).toBe(1);
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
    await screen.findByText(/Optional suggestion/);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ senderId: 'linkedin', reason: 'stale' });
  });

  it('leaves a read that is still inside its TTL alone', async () => {
    stubWithRecommendation({ ...AGED, stale: false });
    renderDetail();
    await screen.findByText(/Optional suggestion/);
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
    await screen.findByText(/Optional suggestion/);
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
