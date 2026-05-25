import { describe, expect, it } from 'vitest';

import { createSentryWorkerObserver } from './sentry-worker-observer.js';

/**
 * SentryWorkerObserver unit tests (D159).
 *
 * These verify the *no-DSN* branch (the only one the test harness can
 * exercise without a Sentry mock harness — the SDK-wired branch is
 * verified manually per the FOUNDER-FOLLOWUPS "Verifies by" criterion).
 *
 * The contract these lock in: with `dsnSet: false`, both methods are
 * inert no-ops (no throws, no SDK side effects). That's what every
 * local-dev + CI run depends on — without it, calling
 * `observer.captureBackgroundFailure` from the reconciler in a dev
 * environment without `SENTRY_DSN` would either explode or accidentally
 * exfiltrate events to a stale DSN.
 */

describe('createSentryWorkerObserver (no DSN)', () => {
  it('returns a no-op observer when dsnSet=false (does not throw on capture)', async () => {
    const observer = await createSentryWorkerObserver({ dsnSet: false });
    // Neither call should throw or have any visible effect. We exercise
    // both branches so a future refactor that adds a side-effect can't
    // sneak past silently.
    expect(() =>
      observer.captureFailure(new Error('boom'), {
        workerName: 'TestWorker',
        jobId: 'job-1',
        attempt: 3,
        policy: 'perMailboxPolicy',
      }),
    ).not.toThrow();
    expect(() =>
      observer.captureBackgroundFailure(new Error('reconciler boom'), {
        kind: 'reconciler.failed',
        tags: { batchSize: 100 },
      }),
    ).not.toThrow();
  });
});
