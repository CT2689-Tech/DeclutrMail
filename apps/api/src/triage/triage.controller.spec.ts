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
