/**
 * Tests for `SenderDetailRoute` — the page wired to the four
 * sender-scoped queries.
 *
 * Covers:
 *   • All-four-succeed → ready state with header + recommendation
 *   • Detail 404 → not-found UI
 *   • Detail 500 → error UI with retry copy
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SenderDetailRoute } from './sender-detail-page';
import {
  installFetchStub,
  jsonNotFound,
  jsonOk,
  jsonServerError,
  resetFetchStub,
} from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

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
  beforeEach(() => installFetchStub([]));
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
