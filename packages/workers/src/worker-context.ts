import type { WorkerPolicy } from './worker-policies.js';

/**
 * WorkerContext (D203) — the uniform per-job context every worker run
 * receives. `BaseDeclutrWorker` builds it from the BullMQ job; subclasses
 * read it inside `processJob()`.
 *
 * D203's full context also carries `correlationId` (AsyncLocalStorage
 * propagation) and `connectionId`. Those land with the observability
 * wiring (D159) — this PR keeps the context to the fields the
 * initial-sync path needs.
 */
export interface WorkerContext {
  /** BullMQ job id. For `perMailboxPolicy` jobs this is the mailbox id. */
  jobId: string;
  /** Stable worker name — used in structured logs + failure capture. */
  workerName: string;
  /** Mailbox this job runs against (set for `perMailboxPolicy` workers). */
  mailboxAccountId?: string;
  /** 1-based attempt number (BullMQ `attemptsMade + 1`). */
  attempt: number;
  /** Max attempts for this job (from the policy). */
  maxAttempts: number;
  /** When this attempt started. */
  startedAt: Date;
  /**
   * When the JOB was enqueued (BullMQ `job.timestamp`) — identical across
   * every attempt, unlike `startedAt`.
   *
   * `jobId` alone cannot identify a run: for `perMailboxPolicy` it IS the
   * mailbox id, so it repeats for every sync that mailbox ever runs. Pairing
   * `jobId` with `startedAt` gives the opposite problem — a fresh value per
   * attempt, which splits one retried run into several. This is the only
   * field that is stable across retries and unique per enqueue.
   */
  enqueuedAt: Date;
  /** The policy this worker declared. */
  policy: WorkerPolicy;
}
