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
//   Round 5 — the job deadline is the same shape. `(runIndex) =>
//   service.enforceLocalVerdicts(runIndex)` type-checks and drops
//   `signal`. The pass then ignores the 60s cron deadline, one hung
//   provider or lock wait holds the BullMQ slot, and later minutes never
//   start. The signal has to be entered here, as an async scope, because
//   the service and the adapters do not take it as a parameter.
//
// So the boundary is a plain exported function with a spec that drives a
// real `BillingVerdictWorker` and asserts the index AND the signal the
// service actually receives. What remains untested in `worker.ts` is one
// call to this factory, with no logic in it.

import type { BillingVerdictDeps } from '@declutrmail/workers';

import type { DrizzleDb } from '../db/db.module.js';
import type { BillingReconciliationService } from './billing-reconciliation.service.js';
import { runWithVerdictSignal } from './provider-signal.js';

/**
 * Both seams forward `runIndex` VERBATIM and enter the job's abort
 * scope. The index selects which hash bucket of verdict rows this run
 * examines, so any constant — including the plausible-looking `0` —
 * collapses the round-robin back to a single bucket and permanently
 * starves the rest. Dropping the signal leaves the cron deadline
 * cooperative in name only.
 */
export function billingVerdictDeps(
  db: DrizzleDb,
  service: Pick<BillingReconciliationService, 'enforceLocalVerdicts' | 'watchSettledRefunds'>,
): BillingVerdictDeps {
  return {
    db: db as unknown as BillingVerdictDeps['db'],
    enforceLocalVerdicts: (runIndex, signal) =>
      runWithVerdictSignal(signal, () => service.enforceLocalVerdicts(runIndex)),
    watchSettledRefunds: (runIndex, signal) =>
      runWithVerdictSignal(signal, () => service.watchSettledRefunds(runIndex)),
  };
}
