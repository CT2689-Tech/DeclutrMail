import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GmailWatchService } from './gmail-watch.service.js';
import type { DrizzleDb } from '../db/db.module.js';
import type { TokenCryptoService } from '../auth/token-crypto.service.js';

/**
 * GmailWatchService unit tests (D8, D225, D229).
 *
 * `google-auth-library` is module-mocked so no token refresh ever
 * leaves the process; the Gmail REST surface is a stubbed global
 * fetch, so the REAL `GmailClientService.watch/stopWatch` runs — the
 * tests cover the full service path minus envelope decryption (the
 * `TokenCryptoService` stub) and the DB (chain stub below).
 */

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    setCredentials(): void {}
    async getAccessToken(): Promise<{ token: string }> {
      return { token: 'access-token' };
    }
  },
}));

const TOPIC = 'projects/p/topics/gmail-push';
const TOKEN_ROW = {
  id: 'mb-1',
  encryptedRefreshToken: Buffer.from('ct'),
  dekEncrypted: Buffer.from('dek'),
};

/**
 * Drizzle chain stub. Each `select()` consumes the next result in
 * `selectResults`; `where()` is awaitable directly (stopAllForUser)
 * AND exposes `.limit()` (clientFor). `update()` records every call —
 * the persistence helpers route through it.
 */
function makeDb(selectResults: unknown[][]): {
  db: DrizzleDb;
  updateCalls: () => number;
} {
  let call = 0;
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) }));
  const select = vi.fn(() => {
    const result = selectResults[call] ?? [];
    call += 1;
    const where = (): Promise<unknown[]> & { limit: () => Promise<unknown[]> } =>
      Object.assign(Promise.resolve(result), { limit: () => Promise.resolve(result) });
    return { from: () => ({ where }) };
  });
  return {
    db: { select, update } as unknown as DrizzleDb,
    updateCalls: () => update.mock.calls.length,
  };
}

function makeTokenCrypto(): TokenCryptoService {
  return { decrypt: vi.fn().mockResolvedValue('refresh-token') } as unknown as TokenCryptoService;
}

function jsonOk(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as unknown as Response;
}

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: () => Promise.reject(new Error('no json')),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('GmailWatchService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('GMAIL_PUBSUB_TOPIC', TOPIC);
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'cs');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('watchMailbox', () => {
    it('calls users.watch with the topic and persists the watch state', async () => {
      const { db, updateCalls } = makeDb([[TOKEN_ROW]]);
      fetchMock.mockResolvedValueOnce(jsonOk({ historyId: '42', expiration: '1765000000000' }));
      const service = new GmailWatchService(db, makeTokenCrypto());

      const outcome = await service.watchMailbox('mb-1');

      expect(outcome).toBe('watched');
      const [url, init] = fetchMock.mock.calls[0]! as [string, { body: string }];
      expect(url).toContain('/watch');
      expect(JSON.parse(init.body)).toMatchObject({ topicName: TOPIC });
      // persistGmailWatchState wrote the merged jsonb.
      expect(updateCalls()).toBe(1);
    });

    it('skips with skipped_disabled when GMAIL_PUBSUB_TOPIC is unset', async () => {
      vi.stubEnv('GMAIL_PUBSUB_TOPIC', '');
      const { db } = makeDb([[TOKEN_ROW]]);
      const service = new GmailWatchService(db, makeTokenCrypto());

      expect(await service.watchMailbox('mb-1')).toBe('skipped_disabled');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips with skipped_no_token when the row has no stored credentials', async () => {
      const { db } = makeDb([[{ id: 'mb-1', encryptedRefreshToken: null, dekEncrypted: null }]]);
      const service = new GmailWatchService(db, makeTokenCrypto());

      expect(await service.watchMailbox('mb-1')).toBe('skipped_no_token');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns failed (never throws) when Gmail errors — the 6h sweep heals it', async () => {
      const { db, updateCalls } = makeDb([[TOKEN_ROW]]);
      fetchMock.mockResolvedValueOnce(errorResponse(500, 'backend error'));
      const service = new GmailWatchService(db, makeTokenCrypto());

      expect(await service.watchMailbox('mb-1')).toBe('failed');
      // No state write on failure.
      expect(updateCalls()).toBe(0);
    });
  });

  describe('stopMailbox', () => {
    it('calls users.stop and clears the persisted watch state', async () => {
      const { db, updateCalls } = makeDb([[TOKEN_ROW]]);
      fetchMock.mockResolvedValueOnce(jsonOk({}));
      const service = new GmailWatchService(db, makeTokenCrypto());

      expect(await service.stopMailbox('mb-1')).toBe('stopped');
      const [url] = fetchMock.mock.calls[0]! as [string];
      expect(url).toContain('/stop');
      expect(updateCalls()).toBe(1); // clearGmailWatchState
    });

    it('returns failed (never throws) when the stop call errors', async () => {
      const { db } = makeDb([[TOKEN_ROW]]);
      fetchMock.mockResolvedValueOnce(errorResponse(500, 'backend error'));
      const service = new GmailWatchService(db, makeTokenCrypto());

      expect(await service.stopMailbox('mb-1')).toBe('failed');
    });
  });

  describe('stopAllForUser (U22 deletion purge hook)', () => {
    it('stops every active mailbox with per-mailbox failure isolation', async () => {
      // select #1: the user's active mailboxes; #2 + #3: clientFor rows.
      const { db } = makeDb([
        [{ id: 'mb-1' }, { id: 'mb-2' }],
        [TOKEN_ROW],
        [{ ...TOKEN_ROW, id: 'mb-2' }],
      ]);
      // First stop fails, second succeeds — the loop must continue.
      fetchMock
        .mockResolvedValueOnce(errorResponse(500, 'backend error'))
        .mockResolvedValueOnce(jsonOk({}));
      const service = new GmailWatchService(db, makeTokenCrypto());

      const result = await service.stopAllForUser('user-1');

      expect(result).toEqual({ stopped: 1, failed: 1, skipped: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
