import { freshTestDb } from '@declutrmail/db/testing';
import { BillingVerdictWorker } from '@declutrmail/workers';
import type { WorkerContext } from '@declutrmail/workers';
import { describe, expect, it } from 'vitest';

import type { DrizzleDb } from '../../db/db.module.js';
import type { BillingReconciliationService } from '../billing-reconciliation.service.js';
import { billingVerdictDeps } from '../billing-verdict.deps.js';

/**
 * The production boundary between the reconciliation service and the
 * verdict worker.
 *
 * This spec exists because that boundary broke twice in ways nothing
 * else could see. Both passes take the single hash bucket `runIndex`
 * names, so a wrapper that drops it — or forwards a constant — pins
 * production to one bucket and permanently starves every other verdict
 * row, which on this path means a refunded customer who can never buy
 * again. Every billing test passed through both defects, because they
 * call the service directly and never cross this seam.
 *
 * Making the parameter required turned the first variant into a compile
 * error. It does NOT catch the second: `(runIndex) => service.x(0)`
 * type-checks perfectly. Only asserting the value the service actually
 * receives does (Codex stop-review round 4, 2026-08-13).
 */

const CTX: WorkerContext = {
  jobId: 'j1',
  workerName: 'BillingVerdictWorker',
  attempt: 1,
  maxAttempts: 3,
  startedAt: new Date(),
  policy: 'cronPolicy',
};

function spyService(): {
  service: Pick<BillingReconciliationService, 'enforceLocalVerdicts' | 'watchSettledRefunds'>;
  seen: { enforce: number[]; watch: number[] };
} {
  const seen = { enforce: [] as number[], watch: [] as number[] };
  const service = {
    enforceLocalVerdicts: async (runIndex: number) => {
      seen.enforce.push(runIndex);
      return { enforced: 0, unenforced: 0, refuted: 0, settled: 0 };
    },
    watchSettledRefunds: async (runIndex: number) => {
      seen.watch.push(runIndex);
      return { watched: 0, rebilling: 0, unreadable: 0 };
    },
  };
  return {
    service: service as unknown as Pick<
      BillingReconciliationService,
      'enforceLocalVerdicts' | 'watchSettledRefunds'
    >,
    seen,
  };
}

describe('billingVerdictDeps — the production wiring', () => {
  it('forwards the run index the WORKER derived, not a constant', async () => {
    const db = (await freshTestDb()) as unknown as DrizzleDb;
    const { service, seen } = spyService();
    const worker = new BillingVerdictWorker(billingVerdictDeps(db, service));

    await worker.processJob({ scheduledAtMinute: '2026-08-12T06:00' }, CTX);

    // The exact value the worker computes for that minute: epoch millis
    // divided by the 10-minute cadence. Asserting the NUMBER, not merely
    // that something was passed — `(runIndex) => service.x(0)` satisfies
    // the type and would pass a shape-only check.
    const expected = Math.floor(Date.parse('2026-08-12T06:00:00Z') / (10 * 60 * 1000));
    expect(seen.enforce).toEqual([expected]);
    // Both passes must slice the SAME population on the same run.
    expect(seen.watch).toEqual([expected]);
    // A hardcoded 0 is the shape the round-3 defect actually took.
    expect(expected).not.toBe(0);
  });

  it('advances by exactly one across consecutive runs, end to end', async () => {
    // The stride is what converts "every row eventually" into "every row
    // within `buckets` runs". A wiring that pinned or rescaled the index
    // would still forward *a* number and still pass the test above.
    const db = (await freshTestDb()) as unknown as DrizzleDb;
    const { service, seen } = spyService();
    const worker = new BillingVerdictWorker(billingVerdictDeps(db, service));

    for (const minute of ['2026-08-12T06:00', '2026-08-12T06:10', '2026-08-12T06:20']) {
      await worker.processJob({ scheduledAtMinute: minute }, CTX);
    }

    expect(seen.enforce).toHaveLength(3);
    const [a, b, c] = seen.enforce as [number, number, number];
    expect(b - a).toBe(1);
    expect(c - b).toBe(1);
  });
});
