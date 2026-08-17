import type { JobsOptions, Queue } from 'bullmq';

import { DOMAIN_ICON_RESOLVER_VERSION } from '@declutrmail/db';

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
 * Job options keyed on resolver VERSION + CANONICAL DOMAIN.
 *
 * This is the mechanism that makes a first page-load of a large
 * mailbox cheap. A grid rendering 200 uncached senders fires 200
 * concurrent misses; BullMQ collapses every one that shares a `jobId`
 * into a single queued job, so the fan-out is bounded by distinct
 * domains rather than by requests — and across users, by distinct
 * domains product-wide rather than per mailbox.
 *
 * The version component matters when the cascade gains a source: an
 * older completed job may remain in Redis for 24h, but it must not
 * suppress the new strategy's immediate retry. Within one version,
 * the domain still collapses concurrent requests to one job.
 * `removeOnComplete` keeps a 24h inspection tail; after it is reaped,
 * a later TTL refresh can enqueue the same version again. The row is
 * the durable dedup — the worker re-checks freshness before fetching.
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
    // Versioning lets a resolver upgrade immediately enqueue work even
    // while the previous strategy's completed job remains in Redis.
    jobId: `DomainIconWorker-v${DOMAIN_ICON_RESOLVER_VERSION}-${domain}`,
    attempts: policy.maxAttempts,
    ...(policy.backoff
      ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } }
      : {}),
    removeOnComplete: { age: 24 * 60 * 60 },
    // Failures need a short tail for inspection, and leaving them
    // forever is worse here than losing the Redis copy of the record.
    // `Queue.add` is a no-op while a job with this id exists in ANY
    // state, and the producer swallows enqueue results — so one
    // terminal failure (an unusable domain throws ValidationError,
    // which the base worker turns into an UnrecoverableError) would
    // make that domain permanently un-enqueueable, invisibly. One hour
    // avoids hammering a temporarily unhealthy website while preventing
    // one outage from suppressing a new logo for a week. The dead-letter
    // table and Sentry are the durable failure records.
    removeOnFail: { age: 60 * 60 },
  };
}

/**
 * Enqueue one canonical domain for resolution. Idempotent on that
 * canonical key — aliases and arbitrary subdomains safely converge on
 * one job without coordination.
 */
export async function enqueueDomainIcon(
  queue: Queue<DomainIconJobData>,
  domain: string,
  discoveryDomain?: string,
): Promise<void> {
  await queue.add(
    DOMAIN_ICON_JOB,
    { domain, ...(discoveryDomain && discoveryDomain !== domain ? { discoveryDomain } : {}) },
    domainIconJobOptions(domain),
  );
}
