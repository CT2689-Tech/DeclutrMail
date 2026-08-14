// apps/api/src/billing/billing-verdict.deps.ts — the wiring between
// `BillingReconciliationService` and `BillingVerdictWorker`.
//
// WHY THIS FILE EXISTS. It is four lines of forwarding that would
// naturally live inline in `apps/api/src/worker.ts`. It was extracted
// because that inline version shipped broken and nothing could have
// caught it: the composition root has no test, and both defects it
// produced were invisible to the type system and to all 252 billing
// tests, which call the service directly.
//
//   Round 3 — the seams were wired as `() => service.enforceLocalVerdicts()`.
//   `runIndex` fell back to a default, so production examined hash
//   bucket 0 and nothing else, starving every other bucket forever.
//   Fixed by making the parameter required, which makes omission a
//   compile error.
//
//   Round 4 — that guard is weaker than it looks. It constrains ARITY,
//   not FORWARDING. `(runIndex) => service.enforceLocalVerdicts(0)`
//   type-checks perfectly and reproduces the identical bug, and a future
//   default value would remove the guard silently.
//
// So the boundary is a plain exported function with a spec that drives a
// real `BillingVerdictWorker` and asserts the index the service actually
// receives. What remains untested in `worker.ts` is one call to this
// factory, with no logic in it.

import type { BillingVerdictDeps } from '@declutrmail/workers';

import type { DrizzleDb } from '../db/db.module.js';
import type { BillingReconciliationService } from './billing-reconciliation.service.js';

/**
 * Both seams forward `runIndex` VERBATIM. It selects which hash bucket
 * of verdict rows this run examines, so any constant — including the
 * plausible-looking `0` — collapses the round-robin back to a single
 * bucket and permanently starves the rest.
 */
export function billingVerdictDeps(
  db: DrizzleDb,
  service: Pick<BillingReconciliationService, 'enforceLocalVerdicts' | 'watchSettledRefunds'>,
): BillingVerdictDeps {
  return {
    db: db as unknown as BillingVerdictDeps['db'],
    enforceLocalVerdicts: (runIndex) => service.enforceLocalVerdicts(runIndex),
    watchSettledRefunds: (runIndex) => service.watchSettledRefunds(runIndex),
  };
}
