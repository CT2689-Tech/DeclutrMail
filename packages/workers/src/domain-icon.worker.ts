import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { DOMAIN_ICON_TTL_DAYS, domainIcons, type schema } from '@declutrmail/db';
import { brandRoot } from '@declutrmail/shared/senders';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { resolveBimiIcon, type BimiDeps, type BimiResolution } from './bimi-resolver.js';
import { ValidationError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';
import type { WorkerPolicy } from './worker-policies.js';

type WorkerDb = PostgresJsDatabase<typeof schema>;

/** One domain to resolve. */
export interface DomainIconJobData {
  /** Brand-root domain. Re-normalized here — producers can be wrong. */
  domain: string;
}

/** Metric-only result (logged on `worker.succeeded`). */
export interface DomainIconResult {
  /** What was written: a mark, a cached miss, or nothing at all. */
  outcome: 'stored' | 'cached_miss' | 'unchanged' | 'still_fresh';
  /** Bytes stored; 0 for a miss. */
  byteSize: number;
  durationMs: number;
}

export interface DomainIconDeps {
  db: WorkerDb;
  /** Resolver seams — injected in tests so no job leaves the process. */
  bimi?: BimiDeps;
  /** Override clock for tests. */
  now?: () => Date;
}

/**
 * DomainIconWorker (ADR-0034) — resolves one domain's brand mark and
 * writes it to the global icon cache.
 *
 * Policy: `batchPolicy` (D203/D225). Idempotency key is the domain
 * (`domain-icon.queue.ts`), so concurrent misses for the same brand
 * collapse into one job.
 *
 * The work is deliberately trivial to repeat: the row is an upsert
 * keyed on the domain, so a retry after a partial failure simply
 * writes the same row again. There is no per-user state to corrupt
 * because there is no per-user state at all.
 *
 * FRESHNESS IS RE-CHECKED HERE, not only at enqueue time. A job can
 * sit in the queue while another replica resolves the same domain (the
 * jobId dedup covers concurrent *enqueues*, not a queued job racing a
 * completed one). Re-reading before resolving keeps the outbound fetch
 * count at one per domain per TTL rather than one per queued job.
 *
 * Privacy (D7, D228): this worker touches no Gmail data and no user
 * record. Its entire input is a domain string and its entire output is
 * public brand artwork. It is the rare worker with nothing to leak.
 */
export class DomainIconWorker extends BaseDeclutrWorker<DomainIconJobData, DomainIconResult> {
  readonly workerName = 'DomainIconWorker';
  readonly policy: WorkerPolicy = 'batchPolicy';

  constructor(private readonly deps: DomainIconDeps) {
    super();
  }

  async processJob(payload: DomainIconJobData, _ctx: WorkerContext): Promise<DomainIconResult> {
    const startedAt = Date.now();
    const now = this.deps.now?.() ?? new Date();

    const domain = brandRoot(payload.domain);
    // A producer that enqueued rubbish is a bug, not a transient
    // fault — fail terminally rather than burning three attempts.
    if (!isResolvableDomain(domain)) {
      throw new ValidationError(`DomainIconWorker: unusable domain "${payload.domain}"`);
    }

    if (await this.isFresh(domain, now)) {
      return { outcome: 'still_fresh', byteSize: 0, durationMs: Date.now() - startedAt };
    }

    const resolution = await resolveBimiIcon(domain, this.deps.bimi);

    return {
      ...(await this.store(domain, resolution, now)),
      durationMs: Date.now() - startedAt,
    };
  }

  /** True when a row exists and has not aged past its status' TTL. */
  private async isFresh(domain: string, now: Date): Promise<boolean> {
    const [row] = await this.deps.db
      .select({ status: domainIcons.status, fetchedAt: domainIcons.fetchedAt })
      .from(domainIcons)
      .where(eq(domainIcons.domain, domain))
      .limit(1);

    if (!row) return false;
    return !isStale(row, now);
  }

  private async store(
    domain: string,
    resolution: BimiResolution,
    now: Date,
  ): Promise<Omit<DomainIconResult, 'durationMs'>> {
    if (resolution.status === 'none') {
      // The row that stops this domain being re-resolved on every
      // render for the next 30 days.
      await this.deps.db
        .insert(domainIcons)
        .values({ domain, status: 'none', fetchedAt: now })
        .onConflictDoUpdate({
          target: domainIcons.domain,
          set: {
            status: 'none',
            image: null,
            mime: null,
            source: null,
            contentHash: null,
            byteSize: null,
            fetchedAt: now,
          },
        });
      return { outcome: 'cached_miss', byteSize: 0 };
    }

    const contentHash = createHash('sha256').update(resolution.image).digest('hex');
    const byteSize = resolution.image.byteLength;

    // Byte-identical re-publish: bump `fetched_at` so the TTL restarts
    // without rewriting the payload (and without changing the ETag
    // every client already holds).
    const [existing] = await this.deps.db
      .select({ contentHash: domainIcons.contentHash })
      .from(domainIcons)
      .where(eq(domainIcons.domain, domain))
      .limit(1);

    if (existing?.contentHash === contentHash) {
      await this.deps.db
        .update(domainIcons)
        .set({ fetchedAt: now })
        .where(eq(domainIcons.domain, domain));
      return { outcome: 'unchanged', byteSize };
    }

    await this.deps.db
      .insert(domainIcons)
      .values({
        domain,
        status: 'ok',
        image: resolution.image,
        mime: resolution.mime,
        source: 'bimi',
        contentHash,
        byteSize,
        fetchedAt: now,
      })
      .onConflictDoUpdate({
        target: domainIcons.domain,
        set: {
          status: 'ok',
          image: resolution.image,
          mime: resolution.mime,
          source: 'bimi',
          contentHash,
          byteSize,
          fetchedAt: now,
        },
      });

    return { outcome: 'stored', byteSize };
  }
}

/**
 * Cheap sanity gate before a DNS lookup: a dotted, reasonable-length
 * name with no scheme, path, or whitespace. Not a validity oracle —
 * DNS is the real answer — just enough that obvious rubbish never
 * becomes an outbound query.
 */
export function isResolvableDomain(domain: string): boolean {
  if (domain.length === 0 || domain.length > 253) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain);
}

/**
 * True when a cached row has aged past its status' TTL and should be
 * re-resolved.
 *
 * Refresh is DEMAND-DRIVEN: the read path calls this and enqueues a
 * job when a row it just served is stale (stale-while-revalidate).
 * There is deliberately no background sweep — a sweep would spend
 * outbound fetches on domains nobody looks at any more, while a domain
 * being rendered is exactly the one worth re-checking. It also means
 * the TTL needs no scheduler to be real.
 */
export function isStale(
  row: { status: 'ok' | 'none'; fetchedAt: Date },
  now: Date = new Date(),
): boolean {
  const ttlDays = DOMAIN_ICON_TTL_DAYS[row.status];
  return now.getTime() - row.fetchedAt.getTime() >= ttlDays * 24 * 60 * 60 * 1000;
}
