/**
 * The sample mailbox's own rules, asked over its transport the way the
 * API client asks. `senders-demo.test.tsx` covers the same mailbox through
 * the product UI; these pin the arithmetic and the refusals that UI rests on.
 */
import { describe, expect, it } from 'vitest';

import type {
  ActionStatusResult,
  BatchStatusResult,
  BulkActionEnqueueResult,
  CompositeActionEnqueueResult,
  CompositeActionPreviewResult,
  UndoRevertResult,
  UnsubscribeBacklogResult,
} from '@/lib/api/actions';
import type { SenderDetailDto, SenderListEnvelope } from '@/lib/api/senders';
import type { UndoWireEntry } from '@/features/undo/query-options';

import { createDemoBackend } from './demo-backend';
import { DEMO_ME, DEMO_SENDERS } from './demo-senders';

function client(jobMs = 0) {
  const backend = createDemoBackend({ jobMs });
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const res = await backend.transport(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json()) as { data: T; meta?: unknown; error?: { code: string } };
    return { status: res.status, ...json };
  };
  const sender = async (id: string) =>
    (await call<SenderDetailDto>('GET', `/api/senders/${id}`)).data;
  return { backend, call, sender };
}

const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

describe('demo backend', () => {
  it('records a request it has no answer for and refuses it', async () => {
    const { backend, call } = client();
    const res = await call('GET', '/api/not-a-route');
    expect(res.status).toBe(501);
    expect(res.error?.code).toBe('DEMO_UNHANDLED_REQUEST');
    // The session read is the app shell's, not the demo's: never answered.
    expect((await call('GET', '/api/auth/me')).status).toBe(501);
    expect(backend.unhandled).toEqual(['GET /api/not-a-route', 'GET /api/auth/me']);
  });

  it('uses only made-up .example addresses', () => {
    for (const address of [...DEMO_SENDERS.map((s) => s.email), DEMO_ME.user.email]) {
      expect(address).toMatch(/^[a-z]+@[a-z-]+\.example$/);
    }
    expect(DEMO_ME.mailboxes.map((m) => m.email)).toEqual([DEMO_ME.user.email]);
  });

  it('lists active senders by default scope and counts every bucket mailbox-wide', async () => {
    const { call } = client();
    const page = (await call<SenderListEnvelope['data']>(
      'GET',
      '/api/senders?activity=active&current_mail_only=true&limit=50',
    )) as unknown as SenderListEnvelope & { status: number };
    expect(page.data.map((row) => row.displayName)).toEqual([
      'Market Finds',
      'Northstar Weekly',
      'Loop Fitness',
      'Parcel Receipts',
      'Trail Journal',
      'Harbor Forum Digest',
      'Maya Okafor',
      'Cedar Bank Alerts',
    ]);
    expect(page.meta.query).toMatchObject({
      totalMatching: 8,
      filterCounts: { total: 10, active: 8, quiet: 1, dormant: 1, protected: 2, unsubReady: 7 },
    });
    expect(page.data.every((row) => row.brandMark === false)).toBe(true);
  });

  it.each([
    ['activity=quiet', ['Studio Dispatch']],
    ['activity=dormant', ['Catalog Club']],
    ['protected=true', ['Parcel Receipts', 'Maya Okafor']],
    ['unsub_ready=not', ['Parcel Receipts', 'Maya Okafor', 'Cedar Bank Alerts']],
    ['q=NORTH', ['Northstar Weekly']],
    ['window=180', ['Catalog Club']],
    ['sort=name&limit=2', ['Catalog Club', 'Cedar Bank Alerts']],
  ])('filters and sorts like the API for %s', async (query, names) => {
    const { call } = client();
    const page = await call<SenderListEnvelope['data']>('GET', `/api/senders?${query}`);
    expect(page.data.map((row) => row.displayName)).toEqual(names);
  });

  it('pages with a cursor and sends mailbox-wide numbers on page 1 only', async () => {
    const { call } = client();
    const first = (await call('GET', '/api/senders?limit=4')) as unknown as SenderListEnvelope;
    expect(first.meta.pagination).toMatchObject({ hasMore: true, limit: 4 });
    expect(first.meta.query).toBeDefined();
    const second = (await call(
      'GET',
      `/api/senders?limit=4&cursor=${first.meta.pagination.nextCursor}`,
    )) as unknown as SenderListEnvelope;
    expect(second.data).toHaveLength(4);
    expect(second.meta.query).toBeUndefined();
  });

  it('previews "at least N days old" for inbox and for inbox + archived', async () => {
    const { call } = client();
    const preview = (
      await call<CompositeActionPreviewResult>('GET', '/api/actions/preview?senderId=northstar')
    ).data;
    expect(preview.counts).toEqual({
      all: 111,
      olderThan30d: 85,
      olderThan90d: 63,
      olderThan180d: 45,
      olderThan365d: 14,
    });
    expect(preview.allMail?.counts.all).toBe(273);
    expect(preview.allMail?.counts.olderThan180d).toBe(155);
    expect(preview.recentMessages.all).toHaveLength(5);
  });

  it('Archive moves the windowed inbox email to archived, and Undo restores it', async () => {
    const { call, sender } = client();
    const enqueued = (
      await call<CompositeActionEnqueueResult>('POST', '/api/actions', {
        selector: { type: 'sender', senderId: 'northstar' },
        primary: { type: 'archive', olderThanDays: 90 },
      })
    ).data;
    expect(enqueued).toMatchObject({ status: 'queued', primaryCount: 63 });

    const done = (await call<ActionStatusResult>('GET', `/api/actions/${enqueued.actionId}`)).data;
    expect(done).toMatchObject({ status: 'done', affectedCount: 63, verb: 'archive' });
    expect(done.undoToken).toBeTruthy();
    expect(await sender('northstar')).toMatchObject({ inboxCount: 48, archivedCount: 225 });

    const tray = (await call<UndoWireEntry[]>('GET', '/api/undo')).data;
    expect(tray).toHaveLength(1);
    expect(tray[0]).toMatchObject({ actionKind: 'archive', affectedCount: 63, senderCount: 1 });

    const revert = (await call<UndoRevertResult>('POST', `/api/undo/${done.undoToken}`)).data;
    expect(revert.reverted).toBe(false);
    const reverse = (await call<ActionStatusResult>('GET', `/api/actions/${revert.actionId}`)).data;
    expect(reverse).toMatchObject({ status: 'done', direction: 'reverse', affectedCount: 63 });
    expect(await sender('northstar')).toMatchObject({ inboxCount: 111, archivedCount: 162 });
    expect((await call<UndoWireEntry[]>('GET', '/api/undo')).data).toEqual([]);
    // A second Undo of the same decision is a replay, not a second restore.
    expect(
      (await call<UndoRevertResult>('POST', `/api/undo/${done.undoToken}`)).data.reverted,
    ).toBe(true);
    expect(await sender('northstar')).toMatchObject({ inboxCount: 111, archivedCount: 162 });
  });

  it('Delete reaches archived email only when asked, and Later counts as archived', async () => {
    const { call, sender } = client();
    await call('POST', '/api/actions', {
      selector: { type: 'sender', senderId: 'market' },
      primary: { type: 'delete', olderThanDays: 180, reach: 'all_mail' },
    });
    // 79 inbox + 177 archived emails are at least 180 days old.
    expect(await sender('market')).toMatchObject({ inboxCount: 112, archivedCount: 50 });

    await call('POST', '/api/actions', {
      selector: { type: 'sender', senderId: 'loop' },
      primary: { type: 'later', wakeAt: future() },
    });
    expect(await sender('loop')).toMatchObject({ inboxCount: 0, archivedCount: 167 });

    const past = await call('POST', '/api/actions', {
      selector: { type: 'sender', senderId: 'trail' },
      primary: { type: 'later', wakeAt: new Date(Date.now() - 1000).toISOString() },
    });
    expect(past.status).toBe(400);
  });

  it('refuses a Protected sender without override and skips it in bulk', async () => {
    const { call, sender } = client();
    const refused = await call('POST', '/api/actions', {
      selector: { type: 'sender', senderId: 'receipts' },
      primary: { type: 'archive' },
    });
    expect(refused.status).toBe(409);
    expect(refused.error?.code).toBe('PROTECTED_SENDER');

    const bulk = (
      await call<BulkActionEnqueueResult>('POST', '/api/actions', {
        selector: { type: 'senders', senderIds: ['receipts', 'northstar', 'trail', 'nobody'] },
        primary: { type: 'archive' },
      })
    ).data;
    expect(bulk).toMatchObject({ senderCount: 2, requestedTotal: 151 });
    expect(bulk.skipped).toEqual([
      { senderId: 'receipts', reason: 'protected' },
      { senderId: 'nobody', reason: 'not_found' },
    ]);
    const batch = (await call<BatchStatusResult>('GET', `/api/actions/batch/${bulk.batchId}`)).data;
    expect(batch).toMatchObject({ status: 'done', total: 2, done: 2, affectedCount: 151 });
    expect(await sender('receipts')).toMatchObject({ inboxCount: 15 });

    // One Undo for the whole decision.
    const tray = (await call<UndoWireEntry[]>('GET', '/api/undo')).data;
    expect(tray).toHaveLength(1);
    expect(tray[0]).toMatchObject({ senderCount: 2, affectedCount: 151 });
    await call('POST', `/api/undo/${tray[0]!.token}`);
    await call('GET', '/api/actions/active');
    expect(await sender('northstar')).toMatchObject({ inboxCount: 111 });
    expect(await sender('trail')).toMatchObject({ inboxCount: 40 });

    const none = await call('POST', '/api/actions', {
      selector: { type: 'senders', senderIds: ['receipts', 'maya'] },
      primary: { type: 'archive' },
    });
    expect(none.error?.code).toBe('NO_ACTIONABLE_SENDERS');
  });

  it('Unsubscribe + Delete records the request and moves the chosen email in one decision', async () => {
    const { call, sender } = client();
    const result = (
      await call<UnsubscribeBacklogResult>('POST', '/api/actions/unsubscribe-backlog', {
        mode: 'delete',
        senderIds: ['northstar', 'harbor', 'receipts'],
        olderThanDays: 180,
        reach: 'all_mail',
      })
    ).data;
    expect(result.backlog).toMatchObject({ handle: 'batch', verb: 'delete', requestedCount: 233 });
    expect(result.senders.map((s) => [s.senderId, s.unsubStatus, s.reasonCode])).toEqual([
      ['receipts', 'skipped', 'protected'],
      ['northstar', 'requested', null],
      ['harbor', 'manual', null],
    ]);
    const batch = (
      await call<BatchStatusResult>('GET', `/api/actions/batch/${result.backlog!.actionId}`)
    ).data;
    expect(batch.unsubscribeOutcomes).toMatchObject({ endpointAccepted: 1, pending: 0 });
    expect(await sender('northstar')).toMatchObject({
      inboxCount: 66,
      archivedCount: 52,
      policyType: 'unsubscribe',
      unsubStatus: 'endpoint_accepted',
    });
    // A mailto list is never sent for the user.
    expect(await sender('harbor')).toMatchObject({ unsubStatus: 'action_required' });
    expect(await sender('receipts')).toMatchObject({ policyType: null, inboxCount: 15 });
  });

  it('Keep and Protect stick, and Keep can be undone', async () => {
    const { call, sender } = client();
    await call('PATCH', '/api/senders/trail/policy', { policyType: 'keep' });
    expect(await sender('trail')).toMatchObject({ policyType: 'keep', inboxCount: 40 });
    await call('PATCH', '/api/senders/trail/policy', { isProtected: true });
    expect((await sender('trail')).protectionFlags).toMatchObject({
      isProtected: true,
      protectionReason: 'user_defined',
    });
    expect((await call('POST', '/api/senders/trail/keep/undo', {})).error?.code).toBe(
      'PROTECTED_SENDER',
    );
    await call('PATCH', '/api/senders/trail/policy', { isProtected: false });
    await call('POST', '/api/senders/trail/keep/undo', {});
    expect(await sender('trail')).toMatchObject({ policyType: null });
    const history = (await call<Array<{ action: string }>>('GET', '/api/senders/trail/history'))
      .data;
    expect(history.map((row) => row.action)).toEqual([
      'unmarked_protected',
      'marked_protected',
      'keep',
    ]);
  });

  it('keeps a job running for its duration, then finishes it', async () => {
    const { call, sender } = client(80);
    const enqueued = (
      await call<CompositeActionEnqueueResult>('POST', '/api/actions', {
        selector: { type: 'sender', senderId: 'northstar' },
        primary: { type: 'archive' },
      })
    ).data;
    expect(
      (await call<ActionStatusResult>('GET', `/api/actions/${enqueued.actionId}`)).data.status,
    ).toBe('executing');
    expect(await sender('northstar')).toMatchObject({ inboxCount: 111 });
    // A second action for the same sender waits its turn, as on the API.
    const second = await call('POST', '/api/actions', {
      selector: { type: 'sender', senderId: 'northstar' },
      primary: { type: 'delete' },
    });
    expect(second.error?.code).toBe('SENDER_ACTION_IN_PROGRESS');
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(
      (await call<ActionStatusResult>('GET', `/api/actions/${enqueued.actionId}`)).data.status,
    ).toBe('done');
    expect(await sender('northstar')).toMatchObject({ inboxCount: 0 });
  });
});
