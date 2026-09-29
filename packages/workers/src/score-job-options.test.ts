import { describe, expect, it } from 'vitest';

import { scoreJobOptions } from './score.worker.js';
import { WORKER_POLICIES } from './worker-policies.js';

/**
 * `scoreJobOptions` is the single place every non-`explain` `SCORE_QUEUE`
 * producer gets its retry budget from — `apps/api/src/worker.ts`'s
 * `onSenderIndexBuilt` / `onNewSender` / `onSendersRecategorized`,
 * `TriageService.scoreSender`, and `buildRescoreSenders` (5 producers
 * total). Before this helper existed each producer passed only
 * `{ jobId }`. BullMQ defaults a job with no `attempts` to a single try,
 * so `perMailboxPolicy`'s 5-attempt budget with backoff never actually
 * applied to a score job — a transient failure dead-lettered on the
 * first attempt instead of retrying.
 *
 * Per CLAUDE.md §8 "a green test is not evidence": these assert the
 * OPTION VALUES, not merely that the function returns an object, so they
 * are the negative control — reverting a producer's call site back to a
 * bare `{ jobId }` (equivalently, this function degenerating to
 * `{ jobId }` alone) fails every `attempts`/`backoff`/`removeOn*`
 * assertion below.
 */
describe('scoreJobOptions', () => {
  it('carries the caller-supplied jobId through unchanged', () => {
    expect(scoreJobOptions('mailbox-1:*:1000').jobId).toBe('mailbox-1:*:1000');
  });

  it("grants perMailboxPolicy's full retry budget, not BullMQ's 1-try default", () => {
    const opts = scoreJobOptions('mailbox-1:sender-a:1000');
    expect(opts.attempts).toBe(WORKER_POLICIES.perMailboxPolicy.maxAttempts);
    expect(opts.attempts).toBe(5);
  });

  it('pairs the same rate-limit-aware custom backoff as actionRecoveryJobOptions', () => {
    const opts = scoreJobOptions('mailbox-1:sender-a:1000');
    // `perMailboxPolicy.backoff.type === 'custom'` — `backoffJobOptions`
    // maps that to `{ type: 'custom' }`, which is only safe because
    // `scoreBullWorker`'s registration (`apps/api/src/worker.ts`) now
    // spreads in `...perMailboxWorkerSettings()` too, registering the
    // `perMailboxBackoff` strategy on the consumer side
    // (rate-limit-backoff.ts). That spread was MISSING until PR #827
    // (BLOCKING-1) added it alongside this function — without it BullMQ
    // throws `Unknown backoff strategy custom.` on any retryable
    // failure, and the job never reaches `failed` (stuck `active` until
    // the stalled-job reclaim, no Sentry capture, no dead-letter row).
    // A plain `{ type: 'exponential', ... }` here would mean the score
    // queue silently stopped getting the 2026-09-02 RateLimitError fix
    // every other perMailboxPolicy queue has.
    expect(opts.backoff).toEqual({ type: 'custom' });
  });

  it('keeps a 24h inspection tail on success and never auto-removes a failed job', () => {
    const opts = scoreJobOptions('mailbox-1:sender-a:1000');
    expect(opts.removeOnComplete).toEqual({ age: 24 * 60 * 60 });
    expect(opts.removeOnFail).toBe(false);
  });
});
