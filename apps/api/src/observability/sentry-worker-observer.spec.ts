import { describe, expect, it } from 'vitest';

import { createSentryWorkerObserver } from './sentry-worker-observer.js';

/** The delayed-SDK recovery integration is exercised in sentry-init.spec.ts. */

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
