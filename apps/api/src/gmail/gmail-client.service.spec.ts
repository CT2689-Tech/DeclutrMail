import type { OAuth2Client } from 'google-auth-library';
import {
  AuthExpiredError,
  InvalidGrantError,
  RateLimitError,
  type RateLimiter,
  TransientError,
} from '@declutrmail/workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GmailClientService } from './gmail-client.service.js';

const ACCESS_TOKEN = 'access-token-xyz';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** The request init Gmail calls are issued with (the fields we assert on). */
interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** A typed fetch mock — `calls[i]` is a known `[url, init]` tuple. */
type FetchMock = ReturnType<typeof vi.fn<(url: string, init: FetchInit) => Promise<Response>>>;

/** A stub OAuth2Client that hands back a fixed access token. */
function makeOauth(): OAuth2Client {
  return {
    getAccessToken: vi.fn().mockResolvedValue({ token: ACCESS_TOKEN }),
  } as unknown as OAuth2Client;
}

/** A stub RateLimiter that records every acquire() call. */
function makeLimiter(): { limiter: RateLimiter; acquire: ReturnType<typeof vi.fn> } {
  const acquire = vi.fn().mockResolvedValue(undefined);
  return { limiter: { acquire } as unknown as RateLimiter, acquire };
}

/** Build a `Response`-like object the adapter can read like a real one. */
function makeResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    headers: { get: (name: string): string | null => headers[name.toLowerCase()] ?? null },
    // Lazy: error bodies (e.g. "unauthorized") are read via text(), never
    // json(), so only parse when json() is actually called on an OK body.
    json: vi.fn().mockImplementation(() => Promise.resolve(body ? JSON.parse(body) : {})),
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

/** A 200 OK JSON response. */
function jsonOk(payload: unknown): Response {
  return makeResponse(200, JSON.stringify(payload));
}

describe('GmailClientService — label mutation primitive (D5, D201)', () => {
  let oauth: OAuth2Client;
  let limiter: RateLimiter;
  let acquireSpy: ReturnType<typeof vi.fn>;
  let fetchMock: FetchMock;

  beforeEach(() => {
    oauth = makeOauth();
    const made = makeLimiter();
    limiter = made.limiter;
    acquireSpy = made.acquire;
    fetchMock = vi.fn<(url: string, init: FetchInit) => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Parse the JSON body of the nth recorded fetch call. */
  function bodyOf(index: number): Record<string, unknown> {
    const call = fetchMock.mock.calls[index];
    if (!call) {
      throw new Error(`expected a fetch call at index ${index}`);
    }
    return JSON.parse(call[1].body ?? '{}') as Record<string, unknown>;
  }

  describe('modifyLabels', () => {
    it('POSTs the add/remove label change to /messages/:id/modify', async () => {
      fetchMock.mockResolvedValueOnce(jsonOk({ id: 'm1', labelIds: ['STARRED'] }));
      const client = new GmailClientService(oauth, limiter);

      await client.modifyLabels('m1', { addLabelIds: ['STARRED'], removeLabelIds: ['UNREAD'] });

      expect(acquireSpy).toHaveBeenCalledTimes(1);
      expect(acquireSpy).toHaveBeenCalledWith(5);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(`${API}/messages/m1/modify`);
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      });
      expect(bodyOf(0)).toEqual({ addLabelIds: ['STARRED'], removeLabelIds: ['UNREAD'] });
    });

    it('defaults omitted add/remove arrays to empty', async () => {
      fetchMock.mockResolvedValueOnce(jsonOk({ id: 'm1' }));
      const client = new GmailClientService(oauth, limiter);

      await client.modifyLabels('m1', { addLabelIds: ['IMPORTANT'] });

      expect(bodyOf(0)).toEqual({ addLabelIds: ['IMPORTANT'], removeLabelIds: [] });
    });

    it('url-encodes the message id in the path', async () => {
      fetchMock.mockResolvedValueOnce(jsonOk({}));
      const client = new GmailClientService(oauth, limiter);

      await client.modifyLabels('a/b id', { addLabelIds: ['X'] });

      const [url] = fetchMock.mock.calls[0]!;
      expect(url).toBe(`${API}/messages/a%2Fb%20id/modify`);
    });
  });

  describe('batchModify', () => {
    it('POSTs ids + label change to /messages/batchModify in one call', async () => {
      fetchMock.mockResolvedValueOnce(jsonOk({}));
      const client = new GmailClientService(oauth, limiter);

      await client.batchModify(['m1', 'm2', 'm3'], { addLabelIds: ['TRASH'] });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(acquireSpy).toHaveBeenCalledTimes(1);
      expect(acquireSpy).toHaveBeenCalledWith(5);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(`${API}/messages/batchModify`);
      expect(init.method).toBe('POST');
      expect(bodyOf(0)).toEqual({
        ids: ['m1', 'm2', 'm3'],
        addLabelIds: ['TRASH'],
        removeLabelIds: [],
      });
    });

    it('chunks more than 1000 ids into sequential ≤1000-id calls', async () => {
      fetchMock.mockResolvedValue(jsonOk({}));
      const client = new GmailClientService(oauth, limiter);
      const ids = Array.from({ length: 2300 }, (_, i) => `m${i}`);

      await client.batchModify(ids, { removeLabelIds: ['INBOX'] });

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(acquireSpy).toHaveBeenCalledTimes(3);
      const chunk0 = bodyOf(0).ids as string[];
      const chunk1 = bodyOf(1).ids as string[];
      const chunk2 = bodyOf(2).ids as string[];
      expect(chunk0).toHaveLength(1000);
      expect(chunk1).toHaveLength(1000);
      expect(chunk2).toHaveLength(300);
      expect(chunk0[0]).toBe('m0');
      expect(chunk1[0]).toBe('m1000');
      expect(chunk2[299]).toBe('m2299');
      // Every chunk carries the same label change.
      for (const i of [0, 1, 2]) {
        expect(bodyOf(i)).toMatchObject({ addLabelIds: [], removeLabelIds: ['INBOX'] });
      }
    });

    it('sends exactly one call for precisely 1000 ids', async () => {
      fetchMock.mockResolvedValue(jsonOk({}));
      const client = new GmailClientService(oauth, limiter);
      const ids = Array.from({ length: 1000 }, (_, i) => `m${i}`);

      await client.batchModify(ids, { addLabelIds: ['X'] });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(bodyOf(0).ids as string[]).toHaveLength(1000);
    });

    it('is a no-op for an empty id list (no request, no quota)', async () => {
      const client = new GmailClientService(oauth, limiter);

      await client.batchModify([], { addLabelIds: ['X'] });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(acquireSpy).not.toHaveBeenCalled();
    });
  });

  describe('mutation error mapping', () => {
    it('maps 401 to AuthExpiredError', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(401, 'unauthorized'));
      const client = new GmailClientService(oauth, limiter);
      await expect(client.modifyLabels('m1', { addLabelIds: ['X'] })).rejects.toBeInstanceOf(
        AuthExpiredError,
      );
    });

    it('maps 429 to RateLimitError', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(429, 'slow down'));
      const client = new GmailClientService(oauth, limiter);
      await expect(client.batchModify(['m1'], { addLabelIds: ['X'] })).rejects.toBeInstanceOf(
        RateLimitError,
      );
    });

    it('maps a 403 quota body to RateLimitError', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(403, 'Quota exceeded for quota metric'));
      const client = new GmailClientService(oauth, limiter);
      await expect(client.modifyLabels('m1', { addLabelIds: ['X'] })).rejects.toBeInstanceOf(
        RateLimitError,
      );
    });

    it('maps a non-quota 403 to TransientError', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(403, 'forbidden: insufficient scope'));
      const client = new GmailClientService(oauth, limiter);
      await expect(client.modifyLabels('m1', { addLabelIds: ['X'] })).rejects.toBeInstanceOf(
        TransientError,
      );
    });

    it('maps 5xx to TransientError', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(503, 'unavailable'));
      const client = new GmailClientService(oauth, limiter);
      await expect(client.batchModify(['m1'], { addLabelIds: ['X'] })).rejects.toBeInstanceOf(
        TransientError,
      );
    });

    it('maps a network failure to TransientError', async () => {
      fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
      const client = new GmailClientService(oauth, limiter);
      await expect(client.modifyLabels('m1', { addLabelIds: ['X'] })).rejects.toBeInstanceOf(
        TransientError,
      );
    });

    it('maps invalid_grant during token refresh to InvalidGrantError', async () => {
      (oauth.getAccessToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('invalid_grant: token revoked'),
      );
      const client = new GmailClientService(oauth, limiter);
      await expect(client.modifyLabels('m1', { addLabelIds: ['X'] })).rejects.toBeInstanceOf(
        InvalidGrantError,
      );
    });
  });
});
