import { describe, expect, it, vi } from 'vitest';

import { buildRescoreSenders } from './rescore-senders.js';
import { SCORE_JOB, scoreJobId } from './score.worker.js';

const MAILBOX = '00000000-0000-4000-8000-000000000001';
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const CLOCK = Date.parse('2026-09-26T21:00:00.000Z');

describe('buildRescoreSenders', () => {
  it('queues one signal_change score job per sender, keyed so a redelivery dedups', async () => {
    const addBulk = vi.fn(async () => []);
    const sweepAfter = vi.fn(async () => {});
    await buildRescoreSenders({ scoreQueue: { addBulk } as never, sweepAfter })(
      MAILBOX,
      [KEY_A, KEY_B],
      CLOCK,
    );

    expect(addBulk).toHaveBeenCalledTimes(1);
    expect(addBulk).toHaveBeenCalledWith(
      [KEY_A, KEY_B].map((senderKey) => ({
        name: SCORE_JOB,
        data: {
          mailboxAccountId: MAILBOX,
          senderKey,
          trigger: 'signal_change',
          producedAtMs: CLOCK,
        },
        opts: {
          jobId: scoreJobId({ mailboxAccountId: MAILBOX, senderKey, producedAtMs: CLOCK }),
        },
      })),
    );
  });

  it('asks for one trailing Autopilot sweep after queuing the re-scores', async () => {
    const order: string[] = [];
    const addBulk = vi.fn(async () => {
      order.push('score');
      return [];
    });
    const sweepAfter = vi.fn(async () => {
      order.push('sweep');
    });
    await buildRescoreSenders({ scoreQueue: { addBulk } as never, sweepAfter })(
      MAILBOX,
      [KEY_A],
      CLOCK,
    );

    expect(sweepAfter).toHaveBeenCalledWith(MAILBOX);
    expect(order).toEqual(['score', 'sweep']);
  });

  it('does nothing for an empty list', async () => {
    const addBulk = vi.fn(async () => []);
    const sweepAfter = vi.fn(async () => {});
    await buildRescoreSenders({ scoreQueue: { addBulk } as never, sweepAfter })(MAILBOX, [], CLOCK);

    expect(addBulk).not.toHaveBeenCalled();
    expect(sweepAfter).not.toHaveBeenCalled();
  });
});

describe('scoreJobId', () => {
  it('keeps exactly the two colons bullmq 6 accepts in a custom job id', () => {
    const single = scoreJobId({ mailboxAccountId: MAILBOX, senderKey: KEY_A, producedAtMs: CLOCK });
    const sweep = scoreJobId({ mailboxAccountId: MAILBOX, producedAtMs: CLOCK });

    expect(single).toBe(`${MAILBOX}:${KEY_A}:${CLOCK}`);
    expect(sweep).toBe(`${MAILBOX}:*:${CLOCK}`);
    for (const id of [single, sweep]) expect(id.split(':')).toHaveLength(3);
  });
});
