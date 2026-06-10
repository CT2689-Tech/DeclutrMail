import type { OAuth2Client } from 'google-auth-library';
import {
  AuthExpiredError,
  InvalidGrantError,
  PermanentError,
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

  describe('ensureLabelId', () => {
    it('resolves an existing user label by exact name via labels.list', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonOk({
          labels: [
            { id: 'INBOX', name: 'INBOX' },
            { id: 'Label_42', name: 'DeclutrMail/Later' },
          ],
        }),
      );
      const client = new GmailClientService(oauth, limiter);

      const id = await client.ensureLabelId('DeclutrMail/Later');

      expect(id).toBe('Label_42');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(acquireSpy).toHaveBeenCalledWith(5);
      const [url] = fetchMock.mock.calls[0]!;
      expect(url).toBe(`${API}/labels`);
    });

    it('creates the label when missing and returns the new id', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonOk({ labels: [{ id: 'INBOX', name: 'INBOX' }] }))
        .mockResolvedValueOnce(jsonOk({ id: 'Label_7', name: 'DeclutrMail/Later' }));
      const client = new GmailClientService(oauth, limiter);

      const id = await client.ensureLabelId('DeclutrMail/Later');

      expect(id).toBe('Label_7');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(acquireSpy).toHaveBeenCalledTimes(2);
      const [createUrl, createInit] = fetchMock.mock.calls[1]!;
      expect(createUrl).toBe(`${API}/labels`);
      expect(createInit.method).toBe('POST');
      expect(bodyOf(1)).toEqual({
        name: 'DeclutrMail/Later',
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      });
    });

    it('matches case-sensitively (Gmail label names are case-sensitive)', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonOk({ labels: [{ id: 'Label_1', name: 'declutrmail/later' }] }))
        .mockResolvedValueOnce(jsonOk({ id: 'Label_2' }));
      const client = new GmailClientService(oauth, limiter);

      const id = await client.ensureLabelId('DeclutrMail/Later');

      // The lowercase near-miss does NOT match — a new label is created.
      expect(id).toBe('Label_2');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('caches the resolved id per instance (no re-list on the second call)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonOk({ labels: [{ id: 'Label_42', name: 'DeclutrMail/Later' }] }),
      );
      const client = new GmailClientService(oauth, limiter);

      const first = await client.ensureLabelId('DeclutrMail/Later');
      const second = await client.ensureLabelId('DeclutrMail/Later');

      expect(first).toBe('Label_42');
      expect(second).toBe('Label_42');
      // One fetch + one quota charge total — the cache served the second.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(acquireSpy).toHaveBeenCalledTimes(1);
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

    it('maps 400 (invalidArgument family) to PermanentError — never retried', async () => {
      // Live smoke 2026-06-09: an unresolved label NAME in batchModify
      // produced `400: Invalid label` and the worker retried it to the
      // attempt cap. A deterministic 4xx must fail on attempt 1.
      fetchMock.mockResolvedValueOnce(makeResponse(400, 'Invalid label: DeclutrMail/Later'));
      const client = new GmailClientService(oauth, limiter);
      await expect(
        client.batchModify(['m1'], { addLabelIds: ['DeclutrMail/Later'] }),
      ).rejects.toBeInstanceOf(PermanentError);
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

/**
 * D181 — `oauth.refresh_failed` audit emit. The recorder is wired by
 * the worker; the service invokes it BEFORE the existing throw on each
 * of the three token-swap failure branches:
 *
 *   - upstream `invalid_grant`     → reason `invalid_grant`     + still throws InvalidGrantError
 *   - any other upstream failure   → reason `transient_failure` + still throws TransientError
 *   - `getAccessToken` resolves no token → reason `no_access_token` + still throws InvalidGrantError
 *
 * The recorder is fire-and-forget — a recorder that throws must not
 * mutate the original error type or alter control flow.
 */
describe('GmailClientService — D181 oauth.refresh_failed emit', () => {
  let oauth: OAuth2Client;
  let limiter: RateLimiter;
  let fetchMock: FetchMock;

  beforeEach(() => {
    oauth = makeOauth();
    limiter = makeLimiter().limiter;
    fetchMock = vi.fn<(url: string, init: FetchInit) => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records reason=invalid_grant before throwing InvalidGrantError', async () => {
    (oauth.getAccessToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('invalid_grant: token revoked'),
    );
    const recorder = vi.fn();
    const client = new GmailClientService(oauth, limiter, recorder);

    await expect(client.modifyLabels('m1', { addLabelIds: ['X'] })).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
    expect(recorder).toHaveBeenCalledTimes(1);
    expect(recorder).toHaveBeenCalledWith({ reason: 'invalid_grant' });
  });

  it('records reason=transient_failure on a non-invalid_grant refresh error', async () => {
    (oauth.getAccessToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('socket hang up'),
    );
    const recorder = vi.fn();
    const client = new GmailClientService(oauth, limiter, recorder);

    await expect(client.modifyLabels('m1', { addLabelIds: ['X'] })).rejects.toBeInstanceOf(
      TransientError,
    );
    expect(recorder).toHaveBeenCalledWith({ reason: 'transient_failure' });
  });

  it('records reason=no_access_token when getAccessToken resolves null', async () => {
    (oauth.getAccessToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ token: null });
    const recorder = vi.fn();
    const client = new GmailClientService(oauth, limiter, recorder);

    await expect(client.modifyLabels('m1', { addLabelIds: ['X'] })).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
    expect(recorder).toHaveBeenCalledWith({ reason: 'no_access_token' });
  });

  it('never records on a successful token swap', async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ id: 'm1' }));
    const recorder = vi.fn();
    const client = new GmailClientService(oauth, limiter, recorder);

    await client.modifyLabels('m1', { addLabelIds: ['X'] });

    expect(recorder).not.toHaveBeenCalled();
  });

  it('still throws the original error when the recorder itself throws (fire-and-forget)', async () => {
    (oauth.getAccessToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('invalid_grant'),
    );
    const recorder = vi.fn().mockImplementation(() => {
      throw new Error('audit pipe burst');
    });
    const client = new GmailClientService(oauth, limiter, recorder);

    // The InvalidGrantError reaches the caller; the recorder's throw is
    // swallowed so the worker still sees the same error type it would
    // see without the recorder wired.
    await expect(client.modifyLabels('m1', { addLabelIds: ['X'] })).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
    expect(recorder).toHaveBeenCalledTimes(1);
  });

  it('preserves existing behavior when no recorder is wired', async () => {
    // Backwards-compat sanity — the recorder param is optional; the
    // current worker construction path and any future API-context
    // construction that omits it must continue to throw exactly the
    // same error.
    (oauth.getAccessToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('invalid_grant'),
    );
    const client = new GmailClientService(oauth, limiter);
    await expect(client.modifyLabels('m1', { addLabelIds: ['X'] })).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
  });
});
