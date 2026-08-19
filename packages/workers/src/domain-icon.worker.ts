import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  DOMAIN_ICON_RESOLVER_VERSION,
  DOMAIN_ICON_TTL_DAYS,
  domainIcons,
  type schema,
} from '@declutrmail/db';
import { brandRoot } from '@declutrmail/shared/senders';
import { organizationalDomain } from '@declutrmail/shared/senders/organizational-domain';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { resolveBimiIcon, type BimiDeps, type BimiResolution } from './bimi-resolver.js';
import {
  resolveBrandfetchIcon,
  type BrandfetchIconDeps,
  type BrandfetchIconResolution,
} from './brandfetch-icon-resolver.js';
import {
  resolveWebsiteIcon,
  type WebsiteIconDeps,
  type WebsiteIconResolution,
} from './website-icon-resolver.js';
import { RateLimitError, TransientError, ValidationError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';
import type { WorkerPolicy } from './worker-policies.js';

type WorkerDb = PostgresJsDatabase<typeof schema>;

/** One domain to resolve. */
export interface DomainIconJobData {
  /** Canonical brand domain and cache key. Re-normalized here. */
  domain: string;
  /**
   * Original sender-side domain for the strongest exact BIMI attempt.
   * Website and Brandfetch discovery still use `domain` so a mailing-
   * only alias cannot suppress the canonical brand's artwork.
   */
  discoveryDomain?: string;
}

/** Metric-only result (logged on `worker.succeeded`). */
export interface DomainIconResult {
  /** What was written: a mark, a cached miss, or nothing at all. */
  outcome:
    | 'stored'
    | 'cached_miss'
    | 'preserved_stale'
    | 'unchanged'
    | 'still_fresh'
    | 'provider_exhausted';
  /** Resolution tier for coverage metrics; null when no resolution succeeded. */
  source: 'bimi' | 'website' | 'brandfetch' | null;
  /** Bytes stored; 0 for a miss. */
  byteSize: number;
  durationMs: number;
}

export interface DomainIconDeps {
  db: WorkerDb;
  /** Resolver seams — injected in tests so no job leaves the process. */
  bimi?: BimiDeps;
  /** Present to enable the official-website fallback after BIMI misses. */
  website?: WebsiteIconDeps;
  /** Present to enable the server-only Brandfetch fallback after first-party misses. */
  brandfetch?: BrandfetchIconDeps;
  /** Override clock for tests. */
  now?: () => Date;
}

type DomainIconResolution =
  | (Extract<BimiResolution, { status: 'ok' }> & { source: 'bimi' })
  | (Extract<WebsiteIconResolution, { status: 'ok' }> & { source: 'vendor' })
  | (Extract<BrandfetchIconResolution, { status: 'ok' }> & { source: 'brandfetch' })
  | Extract<BimiResolution, { status: 'none' }>;

/** Keep a known-good mark for at most one extra TTL while refreshes retry. */
const STALE_MARK_GRACE_DAYS = DOMAIN_ICON_TTL_DAYS.ok;

/**
 * DomainIconWorker (ADR-0034) — resolves one domain's brand mark and
 * writes it to the global icon cache.
 *
 * Policy: `batchPolicy` (D203/D225). Idempotency key is resolver
 * version + domain (`domain-icon.queue.ts`), so concurrent misses for
 * the same brand collapse while a strategy upgrade bypasses the old
 * completed job.
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

    const domain = organizationalDomain(payload.domain);
    const discoveryDomain = brandRoot(payload.discoveryDomain ?? domain).replace(/\.$/, '');
    // A producer that enqueued rubbish is a bug, not a transient
    // fault — fail terminally rather than burning three attempts.
    if (!isResolvableDomain(domain)) {
      throw new ValidationError(`DomainIconWorker: unusable domain "${payload.domain}"`);
    }
    if (!isResolvableDomain(discoveryDomain)) {
      throw new ValidationError(
        `DomainIconWorker: unusable discovery domain "${payload.discoveryDomain}"`,
      );
    }

    if (await this.isFresh(domain, now)) {
      return {
        outcome: 'still_fresh',
        source: null,
        byteSize: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    const bimi = await resolveBimiIcon(discoveryDomain, this.deps.bimi);
    let resolution: DomainIconResolution | undefined;
    const missReasons = [`bimi: ${bimi.status === 'none' ? bimi.reason : 'resolved'}`];
    let websiteFailure: TransientError | undefined;
    if (bimi.status === 'ok') {
      resolution = { ...bimi, source: 'bimi' };
    } else if (this.deps.website) {
      try {
        const website = await resolveWebsiteIcon(domain, this.deps.website);
        if (website.status === 'ok') resolution = { ...website, source: 'vendor' };
        else missReasons.push(`website: ${website.reason}`);
      } catch (err) {
        if (!(err instanceof TransientError)) throw err;
        websiteFailure = err;
        missReasons.push('website: transient failure');
      }
    }

    if (!resolution && this.deps.brandfetch) {
      try {
        const brandfetch = await resolveBrandfetchIcon(domain, this.deps.brandfetch);
        if (brandfetch.status === 'ok') resolution = { ...brandfetch, source: 'brandfetch' };
        else missReasons.push(`brandfetch: ${brandfetch.reason}`);
      } catch (err) {
        // A PROVIDER QUOTA IS NOT A FAILURE TO RETRY — it is a reason
        // to stop, and the difference decides whether this domain ever
        // gets a logo.
        //
        // Retrying is right for a website that is briefly unreachable:
        // it recovers well inside the 3-attempt backoff window. A quota
        // resets on the provider's clock, hours or a month away, so
        // every attempt is spent to fail and the job dead-letters. And
        // because the throw happens BEFORE `store`, the domain does not
        // even record that we looked — so the next demand re-enqueues
        // it and it dead-letters again, forever. That loop is why
        // resolution stalled at 115 of ~3,344 domains in production.
        //
        // Deferring instead: write NOTHING and end the job cleanly. The
        // invariant above still holds — a quota response is no more
        // proof that this domain has no logo than an unreachable site
        // is — so it must not become a cached `none`. Demand brings the
        // domain back when the list is next read, by which time the
        // quota may have reset.
        if (!(err instanceof RateLimitError)) throw err;
        console.warn(
          JSON.stringify({
            level: 'warn',
            kind: 'domain_icon.provider_exhausted',
            domain,
            provider: 'brandfetch',
            message: err.message,
          }),
        );
        return {
          outcome: 'provider_exhausted',
          source: null,
          byteSize: 0,
          durationMs: Date.now() - startedAt,
        };
      }
    }

    // Never turn an official-site outage into a month-long negative.
    // A Brandfetch success is safe to cache; a Brandfetch miss is not
    // proof that the temporarily unavailable site has no logo.
    if (!resolution && websiteFailure) throw websiteFailure;
    resolution ??= { status: 'none', reason: missReasons.join('; ') };

    return {
      ...(await this.store(domain, resolution, now)),
      durationMs: Date.now() - startedAt,
    };
  }

  /** True when a row exists and has not aged past its status' TTL. */
  private async isFresh(domain: string, now: Date): Promise<boolean> {
    const [row] = await this.deps.db
      .select({
        status: domainIcons.status,
        source: domainIcons.source,
        fetchedAt: domainIcons.fetchedAt,
        resolverVersion: domainIcons.resolverVersion,
      })
      .from(domainIcons)
      .where(eq(domainIcons.domain, domain))
      .limit(1);

    if (!row) return false;
    return !isStale(row, now);
  }

  private async store(
    domain: string,
    resolution: DomainIconResolution,
    now: Date,
  ): Promise<Omit<DomainIconResult, 'durationMs'>> {
    const [existing] = await this.deps.db
      .select({
        status: domainIcons.status,
        source: domainIcons.source,
        contentHash: domainIcons.contentHash,
        byteSize: domainIcons.byteSize,
        fetchedAt: domainIcons.fetchedAt,
      })
      .from(domainIcons)
      .where(eq(domainIcons.domain, domain))
      .limit(1);

    if (resolution.status === 'none') {
      const maxStaleAgeMs = (DOMAIN_ICON_TTL_DAYS.ok + STALE_MARK_GRACE_DAYS) * 24 * 60 * 60 * 1000;
      const preserveStale =
        existing?.status === 'ok' &&
        existing.source !== 'brandfetch' &&
        now.getTime() - existing.fetchedAt.getTime() < maxStaleAgeMs;
      // Why a brand got no logo is the only diagnostic this feature
      // produces — without it, "no logo" is indistinguishable from a
      // bug, and the reason was documented as logged while nothing
      // logged it. Domain and reason only; both are public facts about
      // a DNS record.
      console.info(
        JSON.stringify({
          level: 'info',
          kind: 'domain_icon.unresolved',
          domain,
          reason: resolution.reason,
          outcome: preserveStale ? 'preserved_stale' : 'cached_miss',
        }),
      );
      if (preserveStale) {
        return {
          outcome: 'preserved_stale',
          source: existing.source === 'vendor' ? 'website' : existing.source,
          byteSize: existing.byteSize ?? 0,
        };
      }
      // The row that stops this domain being re-resolved on every
      // render for the next 30 days.
      await this.deps.db
        .insert(domainIcons)
        .values({
          domain,
          status: 'none',
          resolverVersion: DOMAIN_ICON_RESOLVER_VERSION,
          fetchedAt: now,
        })
        .onConflictDoUpdate({
          target: domainIcons.domain,
          set: {
            status: 'none',
            image: null,
            mime: null,
            source: null,
            contentHash: null,
            byteSize: null,
            resolverVersion: DOMAIN_ICON_RESOLVER_VERSION,
            fetchedAt: now,
          },
        });
      return { outcome: 'cached_miss', source: null, byteSize: 0 };
    }

    const contentHash = createHash('sha256').update(resolution.image).digest('hex');
    const byteSize = resolution.image.byteLength;
    const source = resolution.source === 'vendor' ? 'website' : resolution.source;

    // Byte-identical re-publish: bump `fetched_at` and provenance so the
    // TTL and coverage metrics reflect the successful tier, without
    // rewriting the payload or changing the ETag clients already hold.
    if (existing?.contentHash === contentHash) {
      await this.deps.db
        .update(domainIcons)
        .set({
          source: resolution.source,
          mime: resolution.mime,
          byteSize,
          resolverVersion: DOMAIN_ICON_RESOLVER_VERSION,
          fetchedAt: now,
        })
        .where(eq(domainIcons.domain, domain));
      return { outcome: 'unchanged', source, byteSize };
    }

    await this.deps.db
      .insert(domainIcons)
      .values({
        domain,
        status: 'ok',
        image: resolution.image,
        mime: resolution.mime,
        source: resolution.source,
        contentHash,
        byteSize,
        resolverVersion: DOMAIN_ICON_RESOLVER_VERSION,
        fetchedAt: now,
      })
      .onConflictDoUpdate({
        target: domainIcons.domain,
        set: {
          status: 'ok',
          image: resolution.image,
          mime: resolution.mime,
          source: resolution.source,
          contentHash,
          byteSize,
          resolverVersion: DOMAIN_ICON_RESOLVER_VERSION,
          fetchedAt: now,
        },
      });

    return { outcome: 'stored', source, byteSize };
  }
}

/**
 * Server-side kill switch for the unverified official-website tier.
 * BIMI remains available when this is false. Default-on matches the
 * accepted ADR amendment; only the exact deployed value `false`
 * disables outbound website discovery.
 */
export function isWebsiteIconFallbackEnabled(rawValue: string | undefined): boolean {
  return rawValue !== 'false';
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
  row: {
    status: 'ok' | 'none';
    source: 'bimi' | 'vendor' | 'brandfetch' | null;
    fetchedAt: Date;
    resolverVersion: number;
  },
  now: Date = new Date(),
): boolean {
  if (row.status === 'none' && row.resolverVersion < DOMAIN_ICON_RESOLVER_VERSION) {
    return true;
  }
  const ttlDays =
    row.status === 'ok' && row.source === 'brandfetch'
      ? DOMAIN_ICON_TTL_DAYS.brandfetch
      : DOMAIN_ICON_TTL_DAYS[row.status];
  return now.getTime() - row.fetchedAt.getTime() >= ttlDays * 24 * 60 * 60 * 1000;
}
