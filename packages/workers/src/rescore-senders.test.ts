import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  describe('a hung Redis call (CLAUDE.md §2.6)', () => {
    // This runs inside the outbox dispatcher's open claim transaction
    // (see the file's own docstring). ioredis's retry-forever connection
    // never rejects during an outage — it buffers — so an unbounded
    // `await` here would hold that transaction's row locks indefinitely,
    // with no failure signal. `addBulk`/`sweepAfter` below never settle,
    // matching that exact shape, not the mocked "resolves at once" that
    // does not represent the real client during an outage.
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('fails a hung score-queue publish within the bound, instead of hanging', async () => {
      const addBulk = vi.fn(() => new Promise(() => {})); // never settles
      const sweepAfter = vi.fn(async () => {});
      const result = buildRescoreSenders({ scoreQueue: { addBulk } as never, sweepAfter })(
        MAILBOX,
        [KEY_A],
        CLOCK,
      );
      const assertion = expect(result).rejects.toThrow(/score queue addBulk exceeded 5000ms/);
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
      expect(sweepAfter).not.toHaveBeenCalled(); // never reached
    });

    it('fails a hung Autopilot sweep trigger within the bound, instead of hanging', async () => {
      const addBulk = vi.fn(async () => []);
      const sweepAfter = vi.fn(() => new Promise<void>(() => {})); // never settles
      const result = buildRescoreSenders({ scoreQueue: { addBulk } as never, sweepAfter })(
        MAILBOX,
        [KEY_A],
        CLOCK,
      );
      const assertion = expect(result).rejects.toThrow(/autopilot sweep trigger exceeded 5000ms/);
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
    });

    it('a slow-but-real publish under the bound still succeeds', async () => {
      const addBulk = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve([]), 4_000)));
      const sweepAfter = vi.fn(async () => {});
      const result = buildRescoreSenders({ scoreQueue: { addBulk } as never, sweepAfter })(
        MAILBOX,
        [KEY_A],
        CLOCK,
      );
      await vi.advanceTimersByTimeAsync(4_000);
      await expect(result).resolves.toBeUndefined();
      expect(sweepAfter).toHaveBeenCalledWith(MAILBOX);
    });
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

  it("refuses a senderKey that would change the id's colon count", () => {
    // `scoreJobId` is a shared guard across producers whose own input
    // validation differs: the HTTP controller checks shape with
    // `asSenderKey`, but the purge's own event schema (SenderKeySchema,
    // a regex with no colon-safety framing) is what validates the
    // `senderKey` `buildRescoreSenders` passes through — this direct
    // call exercises that guard without going through either.
    expect(() =>
      scoreJobId({ mailboxAccountId: MAILBOX, senderKey: 'a:b', producedAtMs: CLOCK }),
    ).toThrow(/must not contain ":"/);
  });

  it('refuses a mailboxAccountId containing a colon', () => {
    expect(() =>
      scoreJobId({ mailboxAccountId: 'mb:1', senderKey: KEY_A, producedAtMs: CLOCK }),
    ).toThrow(/must not contain ":"/);
  });
});
