import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { TriageController } from './triage.controller.js';
import type { IconsService } from '../icons/icons.service.js';
import type { TriageReadService } from './triage.read-service.js';
import type { TriageService } from './triage.service.js';

/**
 * TriageController.bootstrap — D30 adaptive queue-size wiring
 * (QA-triage-20260827-05). `GET /triage/queue-size` has no client
 * caller; `bootstrap` is the only route the FE actually hits, so it
 * must size the queue itself instead of hardcoding `QUEUE_HARD_MAX`.
 * Guard wiring is class-level metadata covered by the API boot smoke.
 */

function makeController(queueSize: number) {
  const triage = {
    getQueueSize: vi.fn().mockResolvedValue(queueSize),
  };
  const reads = {
    getBootstrap: vi.fn().mockResolvedValue({
      queue: [],
      stats: { decisionsToday: 0 },
      todaySummary: { senderDecisionCount: 0 },
    }),
  };
  const icons = {
    marksFor: vi.fn().mockResolvedValue(new Set<string>()),
  };
  const controller = new TriageController(
    triage as unknown as TriageService,
    reads as unknown as TriageReadService,
    icons as unknown as IconsService,
  );
  return { controller, triage, reads };
}

describe('TriageController.bootstrap', () => {
  it('sizes the queue via the D30 adaptive policy, not the hard max', async () => {
    const { controller, triage, reads } = makeController(7);

    await controller.bootstrap({ id: 'mailbox-1' });

    expect(triage.getQueueSize).toHaveBeenCalledWith('mailbox-1');
    expect(reads.getBootstrap).toHaveBeenCalledWith({
      mailboxAccountId: 'mailbox-1',
      limit: 7,
    });
  });

  it('passes the ceiling straight through on a heavy backlog', async () => {
    const { controller, reads } = makeController(12);

    await controller.bootstrap({ id: 'mailbox-2' });

    expect(reads.getBootstrap).toHaveBeenCalledWith({
      mailboxAccountId: 'mailbox-2',
      limit: 12,
    });
  });
});

describe('TriageController.explain — explanations on demand (D24)', () => {
  const ID_A = '2f1c4a36-8d8e-4a47-9b1e-3b1f0c2d4e5f';
  const ID_B = '7b9e2c10-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

  function makeExplainController() {
    const triage = {
      explainSenders: vi.fn().mockResolvedValue({ queued: [ID_A] }),
    };
    const controller = new TriageController(
      triage as unknown as TriageService,
      {} as TriageReadService,
      {} as IconsService,
    );
    return { controller, triage };
  }

  it('hands the service a de-duplicated list of the ids asked for', async () => {
    const { controller, triage } = makeExplainController();

    const res = await controller.explain({ id: 'mailbox-1' }, { senderIds: [ID_A, ID_B, ID_A] });

    expect(triage.explainSenders).toHaveBeenCalledWith({
      mailboxAccountId: 'mailbox-1',
      senderIds: [ID_A, ID_B],
    });
    expect(res.data).toEqual({ queued: [ID_A] });
  });

  it.each([
    ['a missing list', {}],
    ['an empty list', { senderIds: [] }],
    ['a list of non-strings', { senderIds: [42] }],
    ['a malformed id', { senderIds: ['not-a-uuid'] }],
    // A queue's worth (D30 ceiling) at most: a request is a page asking
    // about what it shows, never a crawl of the mailbox.
    ['more than a queue of ids', { senderIds: Array.from({ length: 13 }, () => randomUUID()) }],
  ])('rejects %s with 400 and queues nothing', async (_label, body) => {
    const { controller, triage } = makeExplainController();

    await expect(controller.explain({ id: 'mailbox-1' }, body)).rejects.toMatchObject({
      status: 400,
    });
    expect(triage.explainSenders).not.toHaveBeenCalled();
  });
});

describe('TriageController.scoreSender — sender id shape', () => {
  it('rejects a malformed sender id with 400 before it reaches a uuid column', async () => {
    const triage = { resolveSenderKey: vi.fn(), scoreSender: vi.fn() };
    const controller = new TriageController(
      triage as unknown as TriageService,
      {} as TriageReadService,
      {} as IconsService,
    );

    await expect(
      controller.scoreSender({ id: 'mailbox-1' }, { senderId: 'not-a-uuid', reason: 'stale' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(triage.resolveSenderKey).not.toHaveBeenCalled();
  });

  it('rejects a raw senderKey that is not sha256 hex with 400, before it reaches BullMQ', async () => {
    // Unchecked, this colon would change `scoreJobId`'s colon count and
    // surface as bullmq's own 500 ("Custom Id cannot contain :"), not a 400.
    const triage = { resolveSenderKey: vi.fn(), scoreSender: vi.fn() };
    const controller = new TriageController(
      triage as unknown as TriageService,
      {} as TriageReadService,
      {} as IconsService,
    );

    await expect(
      controller.scoreSender({ id: 'mailbox-1' }, { senderKey: 'a:b', reason: 'user' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(triage.scoreSender).not.toHaveBeenCalled();
  });

  it('accepts a real sha256 senderKey unchanged', async () => {
    const KEY = 'a'.repeat(64);
    const triage = {
      resolveSenderKey: vi.fn(),
      scoreSender: vi.fn().mockResolvedValue({ idempotencyKey: 'mailbox-1:' + KEY + ':1' }),
    };
    const controller = new TriageController(
      triage as unknown as TriageService,
      {} as TriageReadService,
      {} as IconsService,
    );

    await controller.scoreSender({ id: 'mailbox-1' }, { senderKey: KEY, reason: 'user' });
    expect(triage.scoreSender).toHaveBeenCalledWith(expect.objectContaining({ senderKey: KEY }));
  });
});
