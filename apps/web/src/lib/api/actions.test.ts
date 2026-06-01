/**
 * Tests for the async destructive-action pipeline client (D226).
 *
 * Confirms each fetcher hits the right path, carries the Idempotency-Key,
 * sends the sender selector, and unwraps the envelope — plus the small pure
 * helpers (`newIdempotencyKey`, `isTerminalStatus`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  enqueueArchiveSender,
  getActionStatus,
  isTerminalStatus,
  newIdempotencyKey,
  revertUndo,
} from './actions';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';

describe('enqueueArchiveSender', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('POSTs the sender selector + Idempotency-Key header and unwraps the handle', async () => {
    let observedKey: string | null = null;
    let observedBody: unknown = null;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/actions/archive',
        respond: async (req) => {
          observedKey = req.headers.get('idempotency-key');
          observedBody = await req.json();
          return jsonOk({
            data: { actionId: 'a-1', requestedCount: 12, status: 'queued' },
          });
        },
      },
    ]);

    const res = await enqueueArchiveSender('snd-1', { idempotencyKey: 'key-12345678' });

    expect(observedKey).toBe('key-12345678');
    expect(observedBody).toEqual({
      selector: { type: 'sender', senderId: 'snd-1' },
      override: false,
    });
    expect(res).toEqual({ actionId: 'a-1', requestedCount: 12, status: 'queued' });
  });

  it('forwards override=true for a protected sender', async () => {
    let observedBody: { override?: boolean } | null = null;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/actions/archive',
        respond: async (req) => {
          observedBody = (await req.json()) as { override?: boolean };
          return jsonOk({ data: { actionId: 'a-2', requestedCount: 1, status: 'queued' } });
        },
      },
    ]);

    await enqueueArchiveSender('snd-2', { idempotencyKey: 'key-87654321', override: true });

    expect(observedBody!.override).toBe(true);
  });
});

describe('getActionStatus', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('GETs /api/actions/:id and returns the polled state', async () => {
    let observedPath: string | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/actions\/[^/]+$/,
        respond: (_req, url) => {
          observedPath = url.pathname;
          return jsonOk({
            data: {
              actionId: 'a-1',
              status: 'done',
              requestedCount: 12,
              affectedCount: 12,
              undoToken: 'tok-1',
              errorCode: null,
            },
          });
        },
      },
    ]);

    const res = await getActionStatus('a-1');

    expect(observedPath).toBe('/api/actions/a-1');
    expect(res.status).toBe('done');
    expect(res.undoToken).toBe('tok-1');
  });
});

describe('revertUndo', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('POSTs /api/undo/:token and returns the reverse handle', async () => {
    let observedPath: string | null = null;
    installFetchStub([
      {
        method: 'POST',
        path: /^\/api\/undo\/[^/]+$/,
        respond: (req, url) => {
          observedPath = url.pathname;
          return jsonOk({
            data: {
              token: 'tok-1',
              actionKind: 'archive',
              reverted: false,
              expired: false,
              revertedAt: null,
              actionId: 'rev-1',
            },
          });
        },
      },
    ]);

    const res = await revertUndo('tok-1');

    expect(observedPath).toBe('/api/undo/tok-1');
    expect(res.actionId).toBe('rev-1');
    expect(res.reverted).toBe(false);
  });
});

describe('newIdempotencyKey', () => {
  it('returns a unique key that satisfies the BE ≥8-char minimum', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a).not.toBe(b);
  });
});

describe('isTerminalStatus', () => {
  it('treats done/failed as terminal and queued/executing as in-flight', () => {
    expect(isTerminalStatus('done')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('queued')).toBe(false);
    expect(isTerminalStatus('executing')).toBe(false);
  });
});
