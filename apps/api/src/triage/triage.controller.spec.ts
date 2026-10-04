import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { TriageController } from './triage.controller.js';
import type { IconsService } from '../icons/icons.service.js';
import type { TriageQueueFacts, TriageSessionStats, TodaySummary } from './triage.read-service.js';
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
  const stats: TriageSessionStats = {
    decidedToday: 0,
    archivedToday: 0,
    unsubscribedToday: 0,
    laterToday: 0,
    freeRemaining: null,
    tier: 'pro',
  };
  const todaySummary: TodaySummary = {
    receivedToday: 0,
    sendersToday: 0,
    handledAutomatically: 0,
    queuedDecisions: 0,
    noiseSenderCount: 0,
    noiseReductionPct: null,
  };
  const reads = {
    startBootstrapReads: vi.fn(() => ({
      queue: Promise.resolve([] as TriageQueueFacts[]),
      stats: Promise.resolve(stats),
      todaySummary: Promise.resolve(todaySummary),
    })),
  };
  const icons = {
    marksFor: vi.fn().mockResolvedValue(new Set<string>()),
  };
  const controller = new TriageController(
    triage as unknown as TriageService,
    reads as unknown as TriageReadService,
    icons as unknown as IconsService,
  );
  return { controller, triage, reads, icons };
}

const triageRow: TriageQueueFacts = {
  id: 'decision-1',
  senderId: 'sender-1',
  senderKey: 'key',
  senderName: 'Test',
  senderEmail: 'test@example.test',
  senderDomain: 'example.test',
  gmailCategory: 'updates',
  unsubscribeMethod: null,
  verdict: 'archive',
  confidence: 0.9,
  reasoning: 'Test',
  generatedBy: 'template',
  scoredAt: '2026-05-25T08:00:00Z',
  stale: false,
  signals: [],
  protectionReason: null,
  protectionEvidenceCurrent: null,
  monthlyVolume: 1,
  last90dMessages: 3,
  readRate: null,
  lastSeenAt: null,
  totalAllTime: 3,
  inboxCount: 3,
  unreadInboxCount: 3,
};

describe('TriageController.bootstrap', () => {
  it.each(['stats', 'todaySummary'] as const)(
    'does not start marks when %s fails before the queue arrives',
    async (failedBranch) => {
      const { controller, reads, icons } = makeController(7);
      let finishQueue!: (rows: TriageQueueFacts[]) => void;
      const queue = new Promise<TriageQueueFacts[]>((resolve) => {
        finishQueue = resolve;
      });
      const error = new Error('counter read failed');
      const counts = {
        stats: Promise.resolve({} as TriageSessionStats),
        todaySummary: Promise.resolve({} as TodaySummary),
        [failedBranch]: Promise.reject(error),
      };
      reads.startBootstrapReads.mockReturnValue({ queue, ...counts });
      await expect(controller.bootstrap({ id: 'mailbox-1' })).rejects.toBe(error);
      finishQueue([triageRow]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(icons.marksFor).not.toHaveBeenCalled();
    },
  );

  it('observes late counter errors after the queue read failed', async () => {
    const { controller, reads, icons } = makeController(7);
    const error = new Error('queue read failed');
    let failStats!: (error: Error) => void;
    const stats = new Promise<TriageSessionStats>((_resolve, reject) => {
      failStats = reject;
    });
    reads.startBootstrapReads.mockReturnValue({
      queue: Promise.reject(error),
      stats,
      todaySummary: Promise.resolve({} as TodaySummary),
    });
    await expect(controller.bootstrap({ id: 'mailbox-1' })).rejects.toBe(error);
    failStats(new Error('late aggregate failure'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(icons.marksFor).not.toHaveBeenCalled();
  });

  it('keeps a successful bootstrap usable when the icon cache fails', async () => {
    const { controller, reads, icons } = makeController(7);
    const defaults = reads.startBootstrapReads();
    reads.startBootstrapReads.mockReturnValue({ ...defaults, queue: Promise.resolve([triageRow]) });
    icons.marksFor.mockRejectedValue(new Error('icon cache unavailable'));
    await expect(controller.bootstrap({ id: 'mailbox-1' })).resolves.toMatchObject({
      data: { queue: [{ senderDomain: 'example.test', brandMark: false }] },
    });
  });

  it('starts queue marks while independent bootstrap counters are pending', async () => {
    const { controller, reads, icons } = makeController(7);
    const queue = Promise.resolve([triageRow]);
    let finishStats!: (value: TriageSessionStats) => void;
    const stats = new Promise<TriageSessionStats>((resolve) => {
      finishStats = resolve;
    });
    const todaySummary = Promise.resolve({
      receivedToday: 1,
      sendersToday: 1,
      handledAutomatically: 0,
      queuedDecisions: 1,
      noiseSenderCount: 1,
      noiseReductionPct: 10,
    });
    reads.startBootstrapReads.mockReturnValue({ queue, stats, todaySummary });
    const pending = controller.bootstrap({ id: 'mailbox-1' });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(icons.marksFor).toHaveBeenCalledWith(['example.test'], { mayEnqueue: true });
    } finally {
      finishStats({
        decidedToday: 2,
        archivedToday: 1,
        unsubscribedToday: 0,
        laterToday: 0,
        freeRemaining: null,
        tier: 'pro',
      });
      await pending;
    }
    expect((await pending).data).toMatchObject({
      queue: [{ brandMark: false }],
      stats: { decidedToday: 2 },
    });
  });

  it('sizes the queue via the D30 adaptive policy, not the hard max', async () => {
    const { controller, triage, reads } = makeController(7);

    await controller.bootstrap({ id: 'mailbox-1' });

    expect(triage.getQueueSize).toHaveBeenCalledWith('mailbox-1');
    expect(reads.startBootstrapReads).toHaveBeenCalledWith({
      mailboxAccountId: 'mailbox-1',
      limit: 7,
    });
  });

  it('passes the ceiling straight through on a heavy backlog', async () => {
    const { controller, reads } = makeController(12);

    await controller.bootstrap({ id: 'mailbox-2' });

    expect(reads.startBootstrapReads).toHaveBeenCalledWith({
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

  it('rejects an uppercase senderKey — a stored sender_key is always lowercase', async () => {
    // Well-shaped (64 hex chars) but a case no stored key ever has, so it
    // would enqueue a job that can never match a row.
    const triage = { resolveSenderKey: vi.fn(), scoreSender: vi.fn() };
    const controller = new TriageController(
      triage as unknown as TriageService,
      {} as TriageReadService,
      {} as IconsService,
    );

    await expect(
      controller.scoreSender({ id: 'mailbox-1' }, { senderKey: 'A'.repeat(64), reason: 'user' }),
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
