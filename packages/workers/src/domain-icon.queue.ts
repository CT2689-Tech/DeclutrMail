import type { JobsOptions, Queue } from 'bullmq';

import { WORKER_POLICIES } from './worker-policies.js';
import type { DomainIconJobData } from './domain-icon.worker.js';

/**
 * BullMQ contract for brand icon resolution (ADR-0034).
 *
 * Shared between the producer (`IconsService`, on a cache miss) and the
 * consumer (`DomainIconWorker`), so the idempotency-key encoding cannot
 * drift between them — and that key is doing real work here.
 */

export const DOMAIN_ICON_QUEUE = 'domain-icon';
export const DOMAIN_ICON_JOB = 'domain-icon';

/**
 * Job options keyed on the DOMAIN alone.
 *
 * This is the mechanism that makes a first page-load of a large
 * mailbox cheap. A grid rendering 200 uncached senders fires 200
 * concurrent misses; BullMQ collapses every one that shares a `jobId`
 * into a single queued job, so the fan-out is bounded by distinct
 * domains rather than by requests — and across users, by distinct
 * domains product-wide rather than per mailbox.
 *
 * `removeOnComplete` keeps a 24h tail: once a job completes and is
 * reaped, a later miss for the same domain can enqueue again, which is
 * exactly what a TTL refresh needs. The row itself is the durable
 * dedup — the worker re-checks freshness before doing any work.
 */
export function domainIconJobOptions(domain: string): JobsOptions {
  const policy = WORKER_POLICIES.batchPolicy;
  return {
    // Hyphen, NOT colon. `Queue.add` throws "Custom Id cannot contain
    // :" — and because this producer swallows enqueue errors to keep
    // the read path alive, that throw would fail SILENTLY: every icon
    // renders a monogram forever and nothing looks broken. Caught by
    // live smoke against real Redis, 2026-08-14.
    //
    // Measured, because the rule is not what the message says: with
    // bullmq 6, ids with exactly TWO colons are accepted and every
    // other count is rejected (`a:b:c` passes; `a:b`, `a:b:c:d`, `a:`
    // all throw). The cron queues' `Worker:2026-08-14T08:00` ids
    // survive only by landing on that accepted count. Do not read
    // those as precedent — just keep colons out.
    jobId: `DomainIconWorker-${domain}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 },
    // Failures need a tail for the SAME reason completions do, and
    // leaving them forever is worse here than losing the record.
    // `Queue.add` is a no-op while a job with this id exists in ANY
    // state, and the producer swallows enqueue results — so one
    // terminal failure (an unusable domain throws ValidationError,
    // which the base worker turns into an UnrecoverableError) would
    // make that domain permanently un-enqueueable, invisibly. A 7-day
    // tail keeps failures inspectable while guaranteeing the domain
    // becomes retryable; the dead-letter table is the durable record.
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  };
}

/**
 * Enqueue one domain for resolution. Idempotent on the domain — safe to
 * call from every cache miss without coordination.
 */
export async function enqueueDomainIcon(
  queue: Queue<DomainIconJobData>,
  domain: string,
): Promise<void> {
  await queue.add(DOMAIN_ICON_JOB, { domain }, domainIconJobOptions(domain));
}
