import { afterEach, describe, expect, it, vi } from 'vitest';

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
  // function for the same mailbox concurrently with it.
  // `outbox-dispatcher.worker.test.ts`'s "rescoreSenders composed with
  // the real dispatcher" suite proves that composition end-to-end, but
  // ONLY against a 20ms dispatcher-side test bound — short enough that
  // it always wins the race regardless of whether this file still has
  // its own inner timer or not, so that composed test alone cannot tell
  // a correct fix apart from a still-broken one (round-4
  // architecture-guardian review, 2026-09-29 — corrects this comment's
  // own prior claim that "isolated unit tests on this file alone cannot
  // see the interaction that broke"; they can, and the two tests below
  // are how). Both hang their dependency forever and advance a fake
  // clock 60 minutes — a safe margin past any realistic dispatcher
  // bound — to prove directly that THIS function's own returned promise
  // never settles on its own, which is the actual property "the inner
  // bound is gone" means.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never settles while addBulk hangs, even 60 minutes of fake time past the dispatcher bound', async () => {
    vi.useFakeTimers();
    const addBulk = vi.fn(() => new Promise<unknown[]>(() => {})); // never resolves
    const sweepAfter = vi.fn(async () => {});
    let settled = false;
    const pending = buildRescoreSenders({ scoreQueue: { addBulk } as never, sweepAfter })(
      MAILBOX,
      [KEY_A],
      CLOCK,
    );
    pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    // If this function ever re-grows an inner timeout of ANY length
    // (exactly what round 3 removed), advancing fake time past it
    // settles `pending` and this assertion goes red.
    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(settled).toBe(false);
    expect(addBulk).toHaveBeenCalledTimes(1);
    expect(sweepAfter).not.toHaveBeenCalled();
  });

  it('never settles while sweepAfter hangs (addBulk already resolved), even 60 minutes past the dispatcher bound', async () => {
    vi.useFakeTimers();
    const addBulk = vi.fn(async () => []);
    const sweepAfter = vi.fn(() => new Promise<void>(() => {})); // never resolves
    let settled = false;
    const pending = buildRescoreSenders({ scoreQueue: { addBulk } as never, sweepAfter })(
      MAILBOX,
      [KEY_A],
      CLOCK,
    );
    pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(settled).toBe(false);
    expect(sweepAfter).toHaveBeenCalledTimes(1);
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
