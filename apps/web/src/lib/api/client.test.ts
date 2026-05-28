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
import { ApiError, apiGet, apiPost } from './client';
import { installFetchStub, jsonOk, jsonNotFound, resetFetchStub } from '@/test/fetch-stub';

describe('apiGet — request shape', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('sends credentials: include and the Accept header on every request', async () => {
    let observedCredentials: RequestCredentials | undefined;
    let observedHeaders: Headers | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/echo',
        respond: (req) => {
          observedHeaders = req.headers;
          observedCredentials = req.credentials;
          return jsonOk({ data: { ok: true } });
        },
      },
    ]);

    await apiGet<{ ok: boolean }>('/api/echo');

    expect(observedHeaders).not.toBeNull();
    expect(observedHeaders!.get('Accept')).toBe('application/json');
    // The legacy `x-mailbox-account-id` header is gone — D155/D205 moved
    // mailbox identity into the session cookie + user.preferences.
    expect(observedHeaders!.has('x-mailbox-account-id')).toBe(false);
    expect(observedCredentials).toBe('include');
  });

  it('stamps X-Active-Mailbox-Id when the call passes mailboxId', async () => {
    let observed: Headers | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (req) => {
          observed = req.headers;
          return jsonOk({ data: [] });
        },
      },
    ]);
    await apiGet('/api/senders', { mailboxId: 'mb-7' });
    expect(observed!.get('X-Active-Mailbox-Id')).toBe('mb-7');
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

describe('apiPost — CSRF double-submit', () => {
  beforeEach(() => {
    installFetchStub([]);
    // jsdom's `document.cookie` is mutable per test.
    Object.defineProperty(document, 'cookie', {
      writable: true,
      configurable: true,
      value: 'dm_csrf=token-xyz; other=ignored',
    });
  });
  afterEach(() => {
    resetFetchStub();
  });

  it('stamps X-CSRF-Token from the dm_csrf cookie on POST', async () => {
    let observed: Headers | null = null;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/triage/score-sender',
        respond: (req) => {
          observed = req.headers;
          return jsonOk({ data: { idempotencyKey: 'k' } });
        },
      },
    ]);
    await apiPost('/api/triage/score-sender', { senderKey: 'sk_1' });
    expect(observed!.get('X-CSRF-Token')).toBe('token-xyz');
  });

  it('omits X-CSRF-Token on GET', async () => {
    let observed: Headers | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/echo',
        respond: (req) => {
          observed = req.headers;
          return jsonOk({ data: {} });
        },
      },
    ]);
    await apiGet('/api/echo');
    expect(observed!.has('X-CSRF-Token')).toBe(false);
  });
});
