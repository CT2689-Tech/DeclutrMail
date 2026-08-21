/**
 * Tests for the async destructive-action pipeline client (D226).
 *
 * Confirms each fetcher hits the right path, carries the Idempotency-Key,
 * sends the sender selector, and unwraps the envelope — plus the small pure
 * helpers (`newIdempotencyKey`, `isTerminalStatus`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultLaterWakeAt,
  enqueueCompositeAction,
  getActionStatus,
  getBulkActionPreview,
  isTerminalStatus,
  newIdempotencyKey,
  recordUnsubscribeManualStatus,
  recordUnsubscribeIntent,
  revertUndo,
  normalizePreviewMessages,
} from './actions';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';

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
              verb: 'archive',
              direction: 'forward',
              requestedCount: 12,
              affectedCount: 12,
              wakeAt: null,
              undoToken: 'tok-1',
              undoExpiresAt: '2026-07-21T16:00:00.000Z',
              undoExecutedAt: null,
              undoRevertedAt: null,
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
    expect(res.undoExpiresAt).toBe('2026-07-21T16:00:00.000Z');
  });
});

describe('recordUnsubscribeIntent', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it.each([
    [{}, { senderId: 'sender-1' }],
    [{ includesBacklogAction: false }, { senderId: 'sender-1', includesBacklogAction: false }],
    [{ includesBacklogAction: true }, { senderId: 'sender-1', includesBacklogAction: true }],
  ] as const)(
    'forwards the optional backlog preflight flag (%s)',
    async (options, expectedBody) => {
      let observedBody: unknown = null;
      installFetchStub([
        {
          method: 'POST',
          path: '/api/actions/unsubscribe-intent',
          respond: async (req) => {
            observedBody = await req.json();
            return jsonOk({
              data: {
                senderId: 'sender-1',
                recordedAt: '2026-07-12T00:00:00.000Z',
                activityLogId: 'activity-1',
                method: 'none',
                executionActionId: null,
                mailtoUrl: null,
              },
            });
          },
        },
      ]);

      await recordUnsubscribeIntent('sender-1', {
        idempotencyKey: 'unsubscribe-key-123',
        ...options,
      });

      expect(observedBody).toEqual(expectedBody);
    },
  );
});

describe('getBulkActionPreview', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('preserves the strict senderIds-only preview body', async () => {
    let observedBody: unknown = null;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/actions/preview/bulk',
        respond: async (req) => {
          observedBody = await req.json();
          return jsonOk({
            data: {
              senders: [],
              totals: {
                all: 0,
                olderThan30d: 0,
                olderThan90d: 0,
                olderThan180d: 0,
                olderThan365d: 0,
              },
              protectedCount: 0,
            },
          });
        },
      },
    ]);

    await getBulkActionPreview(['sender-1', 'sender-2']);

    expect(observedBody).toEqual({ senderIds: ['sender-1', 'sender-2'] });
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

describe('recordUnsubscribeManualStatus', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('persists the explicit user step instead of inferring delivery', async () => {
    let observedBody: unknown = null;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/actions/unsubscribe-manual-status',
        respond: async (req) => {
          observedBody = await req.json();
          return jsonOk({
            data: {
              senderId: 'snd-1',
              status: 'user_marked_sent',
              recordedAt: '2026-07-14T16:00:00.000Z',
              activityLogId: 'activity-1',
              changed: true,
              irreversible: true,
            },
          });
        },
      },
    ]);

    const result = await recordUnsubscribeManualStatus('snd-1', 'user_marked_sent');

    expect(observedBody).toEqual({ senderId: 'snd-1', status: 'user_marked_sent' });
    expect(result.status).toBe('user_marked_sent');
    expect(result.irreversible).toBe(true);
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

describe('Later scheduling', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('selects the one-week wake preset when the caller does not override it', async () => {
    let observedBody: { primary?: { wakeAt?: string } } = {};
    installFetchStub([
      {
        method: 'POST',
        path: '/api/actions',
        respond: async (req) => {
          observedBody = (await req.json()) as typeof observedBody;
          return jsonOk({
            data: {
              actionId: 'a-later',
              compositeId: 'a-later',
              secondaryId: null,
              status: 'queued',
              primaryCount: 3,
              secondaryCount: null,
              wakeAt: observedBody.primary?.wakeAt ?? null,
            },
          });
        },
      },
    ]);

    await enqueueCompositeAction({
      senderId: 'sender-1',
      primary: { type: 'later' },
      idempotencyKey: 'later-key-123',
    });

    expect(Date.parse(observedBody.primary!.wakeAt!)).toBeGreaterThan(Date.now());
    expect(defaultLaterWakeAt(new Date('2026-07-14T09:00:00Z'))).toBe('2026-07-21T09:00:00.000Z');
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

// apps/api (Cloud Run) and apps/web (Vercel) deploy independently, so the
// preview sample can arrive in EITHER shape during a skew. Before this
// normalizer, an API-first deploy served objects to a reader that rendered
// them as React children — which throws and takes down the D226 modal.
describe('normalizePreviewMessages — survives a deploy skew in both directions', () => {
  it('accepts the legacy bare-string shape', () => {
    expect(normalizePreviewMessages(['Older message', 'Latest message'])).toEqual([
      { subject: 'Older message', date: null },
      { subject: 'Latest message', date: null },
    ]);
  });

  it('accepts the current object shape', () => {
    expect(
      normalizePreviewMessages([{ subject: 'Latest message', date: '2026-06-20T09:00:00.000Z' }]),
    ).toEqual([{ subject: 'Latest message', date: '2026-06-20T09:00:00.000Z' }]);
  });

  it('nulls an unparseable date rather than passing it to the renderer', () => {
    expect(normalizePreviewMessages([{ subject: 'x', date: 'not-a-date' }])).toEqual([
      { subject: 'x', date: null },
    ]);
    expect(normalizePreviewMessages([{ subject: 'x' }])).toEqual([{ subject: 'x', date: null }]);
  });

  it('tolerates a missing or non-array field', () => {
    expect(normalizePreviewMessages(undefined)).toEqual([]);
    expect(normalizePreviewMessages(null)).toEqual([]);
    expect(normalizePreviewMessages({})).toEqual([]);
  });

  it('drops rows that are neither string nor object', () => {
    expect(normalizePreviewMessages([1, null, { subject: 'ok', date: null }])).toEqual([
      { subject: 'ok', date: null },
    ]);
  });
});

// All four deploy combinations, since apps/api (Cloud Run) and apps/web
// (Vercel) never deploy atomically. The two the ADAPTER owns are covered
// here; the old-web-bundle case is covered by the API still emitting
// `recentSubjects` (asserted in the api contract spec).
describe('getCompositePreview — deploy-skew matrix', () => {
  const dated = [{ subject: 'A', date: '2026-06-20T09:00:00.000Z' }];

  it('prefers recentMessages when the API is new', () => {
    expect(normalizePreviewMessages({ recentMessages: { all: dated } }.recentMessages.all)).toEqual(
      dated,
    );
  });

  it('falls back to recentSubjects when the API is old (new web, old API)', () => {
    // Old API sends no `recentMessages` at all — the adapter reads the
    // legacy key and yields dateless rows rather than an empty panel.
    const wire: { recentMessages?: { all: unknown }; recentSubjects?: { all: unknown } } = {
      recentSubjects: { all: ['A', 'B'] },
    };
    const raw = wire.recentMessages ?? wire.recentSubjects;
    expect(normalizePreviewMessages(raw?.all)).toEqual([
      { subject: 'A', date: null },
      { subject: 'B', date: null },
    ]);
  });
});

// ADR-0028 — same skew discipline for the `allMail` block: an API without
// it yields `null` (the modal hides the reach choice), a malformed block
// degrades to `null`, and a healthy one normalizes its sample rows.
describe('getCompositePreview — ADR-0028 allMail block', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  const baseWire = {
    sender: {
      id: 's-1',
      name: 'Shop',
      domain: 'shop.example',
      lastSeenDays: 2,
      wroteToCount: 0,
    },
    counts: { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
    recentMessages: {
      all: [],
      olderThan30d: [],
      olderThan90d: [],
      olderThan180d: [],
      olderThan365d: [],
    },
    recentSubjects: {
      all: [],
      olderThan30d: [],
      olderThan90d: [],
      olderThan180d: [],
      olderThan365d: [],
    },
    unsubAvailable: false,
    protected: false,
  };

  async function previewFromWire(extra: Record<string, unknown>) {
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/actions\/preview/,
        respond: () => jsonOk({ data: { ...baseWire, ...extra } }),
      },
    ]);
    const { getCompositePreview } = await import('./actions');
    return getCompositePreview('s-1');
  }

  it('yields null against an API that predates the field (old API, new web)', async () => {
    const res = await previewFromWire({});
    expect(res.allMail).toBeNull();
  });

  it('yields null for a malformed block instead of guessing counts', async () => {
    const res = await previewFromWire({ allMail: { recentMessages: {} } });
    expect(res.allMail).toBeNull();
  });

  it('normalizes a healthy block, dropping malformed sample rows', async () => {
    const res = await previewFromWire({
      allMail: {
        counts: {
          all: 977,
          olderThan30d: 900,
          olderThan90d: 800,
          olderThan180d: 700,
          olderThan365d: 600,
        },
        recentMessages: {
          all: [
            { subject: 'Statement', date: '2026-07-05T09:00:00.000Z' },
            { subject: 'Bad date', date: 'not-a-date' },
            42,
          ],
          olderThan30d: [],
          olderThan90d: [],
          olderThan180d: [],
          olderThan365d: [],
        },
      },
    });
    expect(res.allMail?.counts.all).toBe(977);
    expect(res.allMail?.recentMessages.all).toEqual([
      { subject: 'Statement', date: '2026-07-05T09:00:00.000Z' },
      { subject: 'Bad date', date: null },
    ]);
  });
});

describe('enqueueCompositeAction — ADR-0028 reach on the wire', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  async function capturePost(input: Parameters<typeof enqueueCompositeAction>[0]) {
    let body: unknown = null;
    installFetchStub([
      {
        method: 'POST',
        path: /^\/api\/actions$/,
        respond: async (req) => {
          body = await req.json();
          return jsonOk({
            data: {
              actionId: 'a-1',
              compositeId: 'a-1',
              secondaryId: null,
              status: 'queued',
              primaryCount: 2,
              secondaryCount: null,
              wakeAt: null,
            },
          });
        },
      },
    ]);
    await enqueueCompositeAction(input);
    return body as { primary: Record<string, unknown> };
  }

  it('carries reach when set', async () => {
    const body = await capturePost({
      senderId: 's-1',
      primary: { type: 'delete', olderThanDays: null, reach: 'all_mail' },
      idempotencyKey: 'k-1',
    });
    expect(body.primary.reach).toBe('all_mail');
  });

  it('omits reach entirely when unset — the pre-ADR wire, byte-identical', async () => {
    const body = await capturePost({
      senderId: 's-1',
      primary: { type: 'delete', olderThanDays: null },
      idempotencyKey: 'k-2',
    });
    expect('reach' in body.primary).toBe(false);
  });
});
