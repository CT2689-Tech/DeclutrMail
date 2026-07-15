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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SenderDetailRoute } from './sender-detail-page';
import {
  addFetchHandlers,
  installFetchStub,
  jsonNotFound,
  jsonOk,
  jsonServerError,
  resetFetchStub,
} from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

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

const DETAIL = {
  id: 'linkedin',
  displayName: 'LinkedIn',
  email: 'noreply@linkedin.com',
  domain: 'linkedin.com',
  gmailCategory: 'social' as const,
  lastSeenAt: '2026-05-23T00:00:00.000Z',
  firstSeenAt: '2023-05-23T00:00:00.000Z',
  monthlyVolume: 64,
  readRate: 0,
  unsubscribeMethod: 'mailto' as const,
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
  verdict: 'archive' as const,
  confidence: 0.9,
  producedAt: '2026-05-20T00:00:00.000Z',
  reasoning: 'High volume, low read rate.',
  generatedBy: 'template' as const,
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
});
