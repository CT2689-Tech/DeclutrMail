import type { Queue } from 'bullmq';

import {
  AUTOPILOT_ACTION_JOB,
  AutopilotActionWorker,
  autopilotActionJobOptions,
  type AutopilotActionDeps,
  type AutopilotActionJobData,
} from './autopilot-action.worker.js';
import { AutopilotApplyWorker } from './autopilot-apply.worker.js';

/**
 * The wired Autopilot execution pair (U14 — D99/D104/D226):
 * `applyWorker` matches, `actionWorker` executes, and the chaining hook
 * between them (`apply wrote Active-mode matches → enqueue one action
 * sweep`) is pre-wired with the canonical jobId convention.
 */
export interface AutopilotExecutionChain {
  applyWorker: AutopilotApplyWorker;
  actionWorker: AutopilotActionWorker;
  /**
   * Enqueue one `autopilot-action` sweep for a mailbox NOW. Exposed so
   * other producers (e.g. a dev harness) can trigger the consumer with
   * the same jobId convention; the API's approve endpoints have their
   * own producer (`AutopilotReadService.enqueueActionSweep`).
   */
  enqueueActionSweep: (mailboxAccountId: string) => Promise<void>;
}

/**
 * The registration fn for the integration PR (U-WIRE) — constructs the
 * apply + action worker pair with the inter-worker chaining wired
 * correctly, so `worker.ts` registration is two `new Worker(...)`
 * blocks around the returned instances instead of hand-rolling the
 * `onActiveMatchesPending` glue (the easy-to-get-wrong part: jobId
 * must be `-`-separated — BullMQ rejects custom ids containing `:`).
 *
 * Takes the action QUEUE producer as a dep (composition root owns all
 * BullMQ Queue/Worker construction, matching every other queue in this
 * package); only `Queue.add` is required, so tests pass a fake.
 *
 * The dev harness (`apps/api/scripts/dev-autopilot-harness.ts`) runs
 * its consumers through this exact fn, so the local smoke exercises
 * the same wiring the production registration will use.
 */
export function createAutopilotExecutionChain(
  deps: AutopilotActionDeps & {
    actionQueue: Pick<Queue<AutopilotActionJobData>, 'add'>;
  },
): AutopilotExecutionChain {
  const { actionQueue, ...actionDeps } = deps;
  const enqueueActionSweep = async (mailboxAccountId: string): Promise<void> => {
    const triggeredAtMs = (actionDeps.now ?? (() => new Date()))().getTime();
    await actionQueue.add(
      AUTOPILOT_ACTION_JOB,
      { mailboxAccountId, triggeredAtMs },
      autopilotActionJobOptions(`${mailboxAccountId}-${triggeredAtMs}`),
    );
  };
  const applyWorker = new AutopilotApplyWorker({
    db: actionDeps.db,
    ...(actionDeps.now ? { now: actionDeps.now } : {}),
    onActiveMatchesPending: enqueueActionSweep,
  });
  const actionWorker = new AutopilotActionWorker(actionDeps);
  return { applyWorker, actionWorker, enqueueActionSweep };
}
