import { describe, expect, it } from 'vitest';

import { autopilotApplyJobOptions } from './autopilot-apply.worker.js';
import { WORKER_POLICIES } from './worker-policies.js';

/**
 * `autopilotApplyJobOptions` is the single place both `autopilot-apply`
 * producers get their retry budget from — `buildAutopilotApplyDeltaTrigger`
 * (`autopilot-delta-trigger.ts`) and `enqueueAutopilotApply`
 * (`apps/api/src/outbox/outbox-consumer-router.ts`). Before this helper
 * existed, both producers passed only `{ jobId, ... }`. BullMQ defaults a
 * job with no `attempts` to a single try, so `perMailboxPolicy`'s 5-attempt
 * budget with backoff never actually applied to an apply-sweep job — a
 * transient failure (a DB hiccup mid-sweep) dead-lettered on the first
 * attempt instead of retrying.
 *
 * Per CLAUDE.md §8 "a green test is not evidence": these assert the
 * OPTION VALUES, not merely that the function returns an object, so they
 * are the negative control — reverting a producer's call site back to a
 * bare `{ jobId }` (equivalently, this function degenerating to
 * `{ jobId }` alone) fails every `attempts`/`backoff`/`removeOn*`
 * assertion below.
 */
describe('autopilotApplyJobOptions', () => {
  it('carries the caller-supplied jobId through unchanged', () => {
    expect(autopilotApplyJobOptions('mailbox-1-1000').jobId).toBe('mailbox-1-1000');
  });

  it("grants perMailboxPolicy's full retry budget, not BullMQ's 1-try default", () => {
    const opts = autopilotApplyJobOptions('mailbox-1-1000');
    expect(opts.attempts).toBe(WORKER_POLICIES.perMailboxPolicy.maxAttempts);
    expect(opts.attempts).toBe(5);
  });

  it('pairs the same rate-limit-aware custom backoff as the sibling perMailboxPolicy producers', () => {
    const opts = autopilotApplyJobOptions('mailbox-1-1000');
    // `perMailboxPolicy.backoff.type === 'custom'` — `backoffJobOptions`
    // maps that to `{ type: 'custom' }`, which is only safe because
    // `autopilotApplyBullWorker`'s registration
    // (`apps/api/src/worker.ts`, via `autopilotApplyWorkerOptions`) spreads
    // in `...perMailboxWorkerSettings()`, registering the `perMailboxBackoff`
    // strategy on the consumer side (`rate-limit-backoff.ts`). Without that
    // spread, BullMQ throws `Unknown backoff strategy custom.` on any
    // retryable failure instead of retrying — see
    // `autopilot-apply-bull-worker-registration.test.ts` for the live proof.
    expect(opts.backoff).toEqual({ type: 'custom' });
  });

  it('keeps a 24h inspection tail on success and never auto-removes a failed job', () => {
    const opts = autopilotApplyJobOptions('mailbox-1-1000');
    expect(opts.removeOnComplete).toEqual({ age: 86_400 });
    expect(opts.removeOnFail).toBe(false);
  });

  it('omits delay for an immediate add (enqueueAutopilotApply)', () => {
    expect(autopilotApplyJobOptions('mailbox-1-1000').delay).toBeUndefined();
  });

  it('carries a positive delay for the debounced delta trigger', () => {
    expect(autopilotApplyJobOptions('mailbox-1-delta-2000', 5_000).delay).toBe(5_000);
  });

  it('omits delay when delayMs is 0 (matches emailSendJobOptions convention)', () => {
    expect(autopilotApplyJobOptions('mailbox-1-1000', 0).delay).toBeUndefined();
  });
});
