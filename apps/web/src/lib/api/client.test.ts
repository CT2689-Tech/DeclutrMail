/**
 * Tests for the API client (D200, D201, D202).
 *
 * The client is a 100-line wrapper — these tests pin the contract the
 * rest of the codebase depends on: the auth header is stamped, the
 * envelope unwraps cleanly, query strings serialise the way callers
 * expect, and HTTP errors throw `ApiError` rather than returning a
 * bogus body.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, apiGet } from './client';
import { installFetchStub, jsonOk, jsonNotFound, resetFetchStub } from '@/test/fetch-stub';

describe('apiGet — request shape', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('stamps the x-mailbox-account-id header on every request', async () => {
    let observed: Headers | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/echo',
        respond: (req) => {
          observed = req.headers;
          return jsonOk({ data: { ok: true } });
        },
      },
    ]);

    await apiGet<{ ok: boolean }>('/api/echo');

    expect(observed).not.toBeNull();
    // Fallback to literal 'demo' since NEXT_PUBLIC_DEMO_MAILBOX_ACCOUNT_ID is unset in tests.
    expect(observed!.get('x-mailbox-account-id')).toBe('demo');
    expect(observed!.get('Accept')).toBe('application/json');
  });

  it('serialises a query map onto the URL, skipping undefined values', async () => {
    let observedUrl: URL | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/items',
        respond: (_req, url) => {
          observedUrl = url;
          return jsonOk({ data: [] });
        },
      },
    ]);

    await apiGet('/api/items', {
      query: { limit: 25, category: 'promotions', cursor: undefined, archived: false },
    });

    expect(observedUrl).not.toBeNull();
    expect(observedUrl!.searchParams.get('limit')).toBe('25');
    expect(observedUrl!.searchParams.get('category')).toBe('promotions');
    expect(observedUrl!.searchParams.has('cursor')).toBe(false);
    expect(observedUrl!.searchParams.get('archived')).toBe('false');
  });
});

describe('apiGet — response unwrap', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('unwraps a D202 envelope into the typed payload', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [{ id: 'a' }, { id: 'b' }],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 25 } },
          }),
      },
    ]);

    const env = await apiGet<{ id: string }[]>('/api/senders');

    expect(env.data).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(env.meta).toEqual({ pagination: { nextCursor: null, hasMore: false, limit: 25 } });
  });

  it('throws ApiError on non-2xx with the parsed error body attached', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders/missing',
        respond: () => jsonNotFound('sender_not_found'),
      },
    ]);

    let captured: unknown = null;
    try {
      await apiGet('/api/senders/missing');
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(ApiError);
    const e = captured as ApiError;
    expect(e.status).toBe(404);
    expect(e.body).toEqual({ error: { code: 'sender_not_found' } });
  });

  it('throws ApiError when the body is not a valid D202 envelope', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/broken',
        respond: () =>
          new Response(JSON.stringify(['not', 'an', 'envelope']), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);

    await expect(apiGet('/api/broken')).rejects.toBeInstanceOf(ApiError);
  });
});
