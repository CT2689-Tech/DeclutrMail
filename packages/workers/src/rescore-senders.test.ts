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

  // A hung Redis call used to be bounded HERE too, by this file's own
  // local 5s `withPublishTimeout` — removed 2026-09-29 (round-3
  // architecture-guardian review). That inner bound settled this
  // function's own returned promise BEFORE the dispatcher's
  // `consumerTimeoutMs` could, which meant `OutboxDispatcherWorker`'s
  // orphan guard tracked an already-settled promise and cleared it on
  // the next microtask — the real, abandoned `addBulk` kept running
  // completely untracked, and the very next tick could re-invoke this
  // function for the same mailbox concurrently with it. There is no
  // local timeout left to unit-test in isolation; the dispatcher's own
  // `consumerTimeoutMs` is the only bound now, and
  // `outbox-dispatcher.worker.test.ts`'s "rescoreSenders composed with
  // the real dispatcher" suite proves THAT composition end-to-end —
  // isolated unit tests on this file alone cannot see the interaction
  // that broke, which is exactly how this bug hid for two rounds.
});

describe('scoreJobId', () => {
  it('keeps exactly the two colons bullmq 6 accepts in a custom job id', () => {
    const single = scoreJobId({ mailboxAccountId: MAILBOX, senderKey: KEY_A, producedAtMs: CLOCK });
    const sweep = scoreJobId({ mailboxAccountId: MAILBOX, producedAtMs: CLOCK });

    expect(single).toBe(`${MAILBOX}:${KEY_A}:${CLOCK}`);
    expect(sweep).toBe(`${MAILBOX}:*:${CLOCK}`);
    for (const id of [single, sweep]) expect(id.split(':')).toHaveLength(3);
  });

  it("uses 'subset' for a named senderKeys set — a Gmail tab recount — never '*' or a raw key", () => {
    // A subset job must not collide with the all-senders sweep's `*` id.
    const subset = scoreJobId({
      mailboxAccountId: MAILBOX,
      senderKeys: [KEY_A, KEY_B],
      producedAtMs: CLOCK,
    });

    expect(subset).toBe(`${MAILBOX}:subset:${CLOCK}`);
    expect(subset.split(':')).toHaveLength(3);
  });

  it('prefers senderKey over senderKeys when a caller somehow sets both', () => {
    const id = scoreJobId({
      mailboxAccountId: MAILBOX,
      senderKey: KEY_A,
      senderKeys: [KEY_B],
      producedAtMs: CLOCK,
    });

    expect(id).toBe(`${MAILBOX}:${KEY_A}:${CLOCK}`);
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
