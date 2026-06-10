/**
 * Tests for `SenderDetailRoute` — the page wired to the four
 * sender-scoped queries.
 *
 * Covers:
 *   • All-four-succeed → ready state with header + recommendation
 *   • Detail 404 → not-found UI
 *   • Detail 500 → error UI with retry copy
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SenderDetailRoute } from './sender-detail-page';
import {
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

const trackMock = vi.fn();
vi.mock('@/lib/posthog', () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

const addBreadcrumbMock = vi.fn();
vi.mock('@/lib/sentry', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbMock(...args),
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
    isVip: false,
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

function installHappyPath() {
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
    trackMock.mockClear();
    addBreadcrumbMock.mockClear();
  });
  afterEach(() => resetFetchStub());

  it('renders the page once all four queries resolve', async () => {
    installHappyPath();
    renderDetail();

    await waitFor(() => expect(screen.getByText('LinkedIn')).toBeInTheDocument());
    // The recent-messages subject from the wire is present.
    expect(screen.getByText(/top notifications this week/i)).toBeInTheDocument();
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

  it('renders the error UI when the detail endpoint returns 500', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: () => jsonServerError(),
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
    // Two elements ("h3" title + "p" body) carry the same copy, so we
    // target the heading explicitly. Retry backoff on 5xx (1s + 2s + 4s)
    // via the shared `retryUnless404` predicate (3 retries) means the
    // error UI doesn't appear until ~7s in.
    await waitFor(
      () =>
        expect(
          screen.getByRole('heading', { name: /couldn[’']t load this sender/i }),
        ).toBeInTheDocument(),
      { timeout: 10000 },
    );
  }, 15000);
});
