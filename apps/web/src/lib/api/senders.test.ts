/**
 * Tests for the typed Senders API fetchers (D39–D46).
 *
 * Confirms each fetcher hits the right path, forwards the right query
 * params, and decodes the BE envelope back into the contract types
 * the FE hooks expect. The wire shapes here MUST match the frozen
 * BE contract — these tests are the canary that catches a drift on
 * either side.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fetchSenderDetail,
  fetchSenderHistory,
  fetchSenderMessages,
  fetchSenderTimeseries,
  fetchSenders,
} from './senders';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';

const LIST_ROW = {
  id: 's-1',
  displayName: 'LinkedIn',
  email: 'noreply@linkedin.com',
  domain: 'linkedin.com',
  gmailCategory: 'social' as const,
  lastSeenAt: '2026-05-23T00:00:00.000Z',
  firstSeenAt: '2023-05-23T00:00:00.000Z',
  monthlyVolume: 64,
  readRate: 0,
  unsubscribeMethod: 'mailto' as const,
};

describe('fetchSenders', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('forwards category + limit + cursor to the URL', async () => {
    let observedUrl: URL | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) => {
          observedUrl = url;
          return jsonOk({
            data: [LIST_ROW],
            meta: { pagination: { nextCursor: 'next', hasMore: true, limit: 25 } },
          });
        },
      },
    ]);

    const env = await fetchSenders({ category: 'promotions', limit: 25, cursor: 'abc' });

    expect(observedUrl!.searchParams.get('category')).toBe('promotions');
    expect(observedUrl!.searchParams.get('limit')).toBe('25');
    expect(observedUrl!.searchParams.get('cursor')).toBe('abc');
    expect(env.data).toHaveLength(1);
    expect(env.meta.pagination.hasMore).toBe(true);
  });

  it('encodes the replied tri-state as ?replied=true / not / omitted (D38)', async () => {
    // Regression: the "you replied" chip wrote URL state but the fetcher
    // never mapped it to the wire, so the chip was a silent no-op.
    const observed: Array<string | null> = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) => {
          observed.push(url.searchParams.get('replied'));
          return jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 25 } },
          });
        },
      },
    ]);

    await fetchSenders({ replied: true });
    await fetchSenders({ replied: false });
    await fetchSenders({ replied: null });
    await fetchSenders();

    expect(observed).toEqual(['true', 'not', null, null]);
  });

  it('omits empty params', async () => {
    let observedUrl: URL | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) => {
          observedUrl = url;
          return jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 25 } },
          });
        },
      },
    ]);

    await fetchSenders();

    expect(observedUrl!.searchParams.toString()).toBe('');
  });
});

describe('fetchSenderDetail', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('GETs /api/senders/:id and returns the envelope', async () => {
    let observedUrl: URL | null = null;
    const detail = {
      ...LIST_ROW,
      protectionFlags: {
        isVip: true,
        isProtected: false,
        protectionReason: null,
        protectionSetAt: null,
      },
    };
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: (_req, url) => {
          observedUrl = url;
          return jsonOk({ data: detail });
        },
      },
    ]);

    const env = await fetchSenderDetail('s-1');
    expect(observedUrl!.pathname).toBe('/api/senders/s-1');
    expect(env.data.protectionFlags.isVip).toBe(true);
  });

  it('URL-encodes the id', async () => {
    let observedUrl: URL | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+$/,
        respond: (_req, url) => {
          observedUrl = url;
          return jsonOk({
            data: {
              ...LIST_ROW,
              protectionFlags: {
                isVip: false,
                isProtected: false,
                protectionReason: null,
                protectionSetAt: null,
              },
            },
          });
        },
      },
    ]);

    await fetchSenderDetail('user@example.com');
    expect(observedUrl!.pathname).toBe('/api/senders/user%40example.com');
  });
});

describe('fetchSenderMessages', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('returns the paginated envelope of recent messages', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/messages$/,
        respond: () =>
          jsonOk({
            data: [
              {
                id: 'm-1',
                providerMessageId: 'p-1',
                providerThreadId: 't-1',
                subject: 'Hi',
                snippet: 'Just wanted to say hello',
                internalDate: '2026-05-22T00:00:00.000Z',
                isUnread: true,
              },
            ],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
    ]);

    const env = await fetchSenderMessages('s-1');
    expect(env.data[0]?.subject).toBe('Hi');
    expect(env.meta.pagination.limit).toBe(10);
  });
});

describe('fetchSenderTimeseries', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('returns the 12-point timeseries envelope', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/timeseries$/,
        respond: () =>
          jsonOk({
            data: Array.from({ length: 12 }, (_, i) => ({
              yearMonth: `2025-${String(i + 1).padStart(2, '0')}-01`,
              volume: i * 10,
              readCount: i,
            })),
          }),
      },
    ]);

    const env = await fetchSenderTimeseries('s-1');
    expect(env.data).toHaveLength(12);
    expect(env.data[11]?.volume).toBe(110);
  });
});

describe('fetchSenderHistory', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('returns the paginated decision-history envelope', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/history$/,
        respond: () =>
          jsonOk({
            data: [
              {
                id: 'h-1',
                verdict: 'archive',
                confidence: 0.92,
                producedAt: '2026-05-20T12:00:00.000Z',
                reasoning: 'Daily promo, never opened.',
                generatedBy: 'template',
              },
            ],
            meta: { pagination: { nextCursor: 'next', hasMore: true, limit: 10 } },
          }),
      },
    ]);

    const env = await fetchSenderHistory('s-1');
    expect(env.data[0]?.verdict).toBe('archive');
    expect(env.meta.pagination.hasMore).toBe(true);
  });
});
