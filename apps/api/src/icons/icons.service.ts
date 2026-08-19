import { createHash } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { Queue } from 'bullmq';

import { brandDomainAliases, domainIcons } from '@declutrmail/db';
import { brandRoot } from '@declutrmail/shared/senders';
import { organizationalDomain } from '@declutrmail/shared/senders/organizational-domain';
import { enqueueDomainIcon, isResolvableDomain, isStale } from '@declutrmail/workers';
import type { DomainIconJobData } from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

/** DI token for the icon-resolution queue producer (null without Redis). */
export const DOMAIN_ICON_QUEUE_TOKEN = 'DOMAIN_ICON_QUEUE';

/**
 * What the controller should send back.
 *
 * `miss` is not an error — it means "render the monogram, we are on
 * it" (or "we looked and there is nothing"). The two collapse
 * deliberately: a caller must not be able to tell a never-seen domain
 * from a logo-less one, because the rendered result is identical and
 * the distinction is only ours to act on.
 */
export type IconLookup =
  { kind: 'hit'; image: Buffer; mime: string; etag: string } | { kind: 'miss' };

/**
 * IconsService (ADR-0034) — reads the global brand icon cache and
 * schedules resolution for what it does not have.
 *
 * It NEVER fetches inline. A cache miss returns immediately and the
 * outbound work happens in `DomainIconWorker`, so render latency is
 * never coupled to remote brand infrastructure's DNS and TLS. That is the whole
 * reason the read path is allowed to be on the critical path at all.
 *
 * Refresh is demand-driven: a stale row is served AND re-queued
 * (stale-while-revalidate), so the TTL needs no background sweep and
 * we only spend fetches on domains someone is actually looking at.
 *
 * Privacy (D7, D228): the only input is a domain string and the only
 * output is public brand artwork. Nothing here reads or writes
 * user-scoped data — both `domain_icons` and the public alias registry
 * intentionally carry no user or mailbox linkage.
 */
/**
 * How many unresolved domains a single list read may schedule.
 *
 * A read must never schedule UNBOUNDED background work. A first pass
 * over a large mailbox has a row for almost nothing, so an uncapped
 * enqueue turns one page view into a page-sized burst against whatever
 * the resolver talks to — and that burst is only as safe as the
 * weakest link downstream. It is not currently safe: a provider
 * quota response aborts the whole job (`DomainIconWorker` does not
 * catch it), so the domain dead-letters without even recording that
 * we looked, and the next page view enqueues it again.
 *
 * Capped, a page view contributes a bounded amount of catch-up and
 * paging through a mailbox still walks the whole set over time.
 */
export const MAX_SCHEDULED_PER_READ = 12;

/**
 * Pick `count` items at random, without replacement.
 *
 * WHY NOT JUST TAKE THE FIRST `count`. The scheduling budget is spent
 * on domains that have no cached row, and a domain that cannot resolve
 * right now does not GET a row — a provider quota deliberately writes
 * nothing, because a 429 is not proof the domain has no logo. Take the
 * head of that set every time and the same leading rows win the whole
 * budget on every read, forever, while everything behind them is never
 * attempted. The page's first rows would be permanently retried and
 * its later rows permanently starved.
 *
 * Sampling makes the budget unbiased instead: over repeated reads every
 * unresolved domain on a page gets its turn, whatever the ones above it
 * are doing.
 */
function sampleAtMost<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool[index]!);
    pool.splice(index, 1);
  }
  return picked;
}

/**
 * How long a read may wait on the queue before giving up on scheduling.
 *
 * `createRedisConnection` builds its client with
 * `maxRetriesPerRequest: null`, which is correct for a worker — a job
 * must not be dropped because Redis blinked — but it means a command
 * issued while Redis is unreachable RETRIES FOREVER instead of
 * failing. `queue.add()` then never settles, and an `await` on it
 * never returns. A try/catch cannot help: there is no rejection, only
 * a promise that stays pending.
 *
 * That hazard used to be invisible, because the only caller was an
 * `<img>` subresource and a stalled image costs nothing. It stopped
 * being invisible when the senders list started scheduling
 * resolution: without this bound, a Redis outage would hang
 * `GET /api/senders` itself — the page would not fail, it would spin.
 *
 * So scheduling gets a deadline. Losing the race is not an error
 * worth failing a read over: the mark stays uncached and the next
 * list read tries again, which is the same degradation as no Redis at
 * all (monogram until it recovers).
 */
export const ENQUEUE_DEADLINE_MS = 500;

/**
 * Resolve `work`, or reject once `ms` has passed — whichever happens
 * first. The loser is explicitly neutralised so a late rejection
 * cannot surface as an unhandled rejection after the race is decided.
 */
async function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
    // Never hold the process open just to enforce a best-effort bound.
    timer.unref?.();
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The two domains a raw request maps onto, or null when the input can
 * never become a resolution: `discoveryDomain` is what the caller
 * asked for, `organizational` is the registrable domain we look the
 * mark up under. Pure, so the single-domain read path and the batch
 * availability read below cannot drift apart on how a domain is
 * normalised.
 */
export function candidateDomains(
  rawDomain: string,
): { discoveryDomain: string; organizational: string } | null {
  const discoveryDomain = brandRoot(rawDomain).replace(/\.$/, '');
  const organizational = organizationalDomain(rawDomain);
  if (!isResolvableDomain(organizational)) return null;
  return { discoveryDomain, organizational };
}

/**
 * Whether a cached row is a mark we would actually serve.
 *
 * `status = 'ok'` is sufficient to know the bytes exist —
 * `domain_icons_image_matches_status_chk` makes `ok` imply a non-null
 * image, mime, source and hash — which is exactly why the batch read
 * can answer availability without selecting the `bytea` column.
 * Provider artwork past its licence window is treated as absent, the
 * same as in `lookup`.
 */
function isUsableMark(
  row: {
    status: 'ok' | 'none';
    source: 'bimi' | 'vendor' | 'brandfetch' | null;
    fetchedAt: Date;
    resolverVersion: number;
  },
  now: Date,
): boolean {
  if (row.status === 'none') return false;
  if (row.source === 'brandfetch' && isStale(row, now)) return false;
  return true;
}

@Injectable()
export class IconsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Optional()
    @Inject(DOMAIN_ICON_QUEUE_TOKEN)
    private readonly queue: Queue<DomainIconJobData> | null = null,
  ) {}

  /**
   * `mayEnqueue` — whether this caller is allowed to cause outbound
   * work. False for anonymous callers (founder decision 2026-08-16):
   * the route is readable without a session so that an image
   * subresource, which cannot refresh an expired token, still gets its
   * logo — but only a session may grow the cache. Reads are otherwise
   * identical, so an anonymous hit still serves the mark.
   */
  async lookup(rawDomain: string, opts: { mayEnqueue: boolean }): Promise<IconLookup> {
    const candidate = candidateDomains(rawDomain);
    // Rubbish never becomes a queued job. Silent miss rather than a
    // 400: the caller is an <img> tag, which can do nothing with an
    // error, and a bad domain is indistinguishable from an unknown one
    // as far as the rendered result goes.
    if (candidate === null) return { kind: 'miss' };
    const { discoveryDomain, organizational } = candidate;

    const [alias] = await this.db
      .select({ canonicalDomain: brandDomainAliases.canonicalDomain })
      .from(brandDomainAliases)
      .where(
        and(
          eq(brandDomainAliases.aliasDomain, organizational),
          eq(brandDomainAliases.confidence, 100),
        ),
      )
      .limit(1);
    const domain = alias?.canonicalDomain ?? organizational;
    // The migration seeds validated values and schema checks prevent
    // self-aliases, but a manually reviewed future row is still input
    // to outbound resolution and must cross the same boundary.
    if (!isResolvableDomain(domain)) return { kind: 'miss' };

    const cacheDomains = discoveryDomain === domain ? [domain] : [discoveryDomain, domain];
    const rows = await this.db
      .select({
        domain: domainIcons.domain,
        status: domainIcons.status,
        image: domainIcons.image,
        mime: domainIcons.mime,
        contentHash: domainIcons.contentHash,
        source: domainIcons.source,
        resolverVersion: domainIcons.resolverVersion,
        fetchedAt: domainIcons.fetchedAt,
      })
      .from(domainIcons)
      .where(inArray(domainIcons.domain, cacheDomains));

    const now = new Date();
    const byDomain = new Map(rows.map((row) => [row.domain, row] as const));
    const canonicalRow = byDomain.get(domain);
    const canonicalStale =
      canonicalRow !== undefined &&
      isStale(
        {
          status: canonicalRow.status,
          source: canonicalRow.source,
          fetchedAt: canonicalRow.fetchedAt,
          resolverVersion: canonicalRow.resolverVersion,
        },
        now,
      );

    // Canonical migration and refresh are demand-driven. An existing
    // exact-domain mark may be served below while one canonical job is
    // queued, so this never regresses a visible logo to a monogram.
    if ((!canonicalRow || canonicalStale) && opts.mayEnqueue) {
      await this.schedule(domain, discoveryDomain);
    }

    for (const candidate of cacheDomains) {
      const row = byDomain.get(candidate);
      if (!row || row.status === 'none' || !row.image || !row.mime) continue;
      const stale = isStale(
        {
          status: row.status,
          source: row.source,
          fetchedAt: row.fetchedAt,
          resolverVersion: row.resolverVersion,
        },
        now,
      );
      // Provider artwork may be cached for at most 30 days. Once stale,
      // skip it and try the canonical cache rather than serving expired
      // third-party bytes under stale-while-revalidate.
      if (row.source === 'brandfetch' && stale) continue;

      return {
        kind: 'hit',
        image: Buffer.from(row.image),
        mime: row.mime,
        // `content_hash` is sha256 of the bytes, so it is already a
        // strong validator; fall back to hashing only if a legacy row
        // somehow lacks it.
        etag: `"${row.contentHash ?? createHash('sha256').update(row.image).digest('hex')}"`,
      };
    }

    return { kind: 'miss' };
  }

  /**
   * WHICH OF THESE DOMAINS HAS A MARK — the whole point of this method
   * is the requests it stops the browser from making.
   *
   * `Avatar` is a zero-JS server component whose logo layer is a CSS
   * `background-image`, so it has no way to ask first and no way to
   * retry: it either emits a URL and the browser fetches it, or it
   * emits nothing. Before this existed, a list page emitted one URL
   * per sender unconditionally, and since almost every domain starts
   * uncached, almost every one of those requests spent a full
   * round trip to be told 204. A 213-sender Senders page fired ~90
   * concurrent requests at an API running 3 instances of 1 vCPU over a
   * 10-connection pool, so the page queued behind its own avatars:
   * measured 2026-08-19 in production, icon requests took 1216ms
   * against a ~100ms warm baseline and one ordinary API call in the
   * same trace took 7702ms (Sentry trace c39e4b7d…, /senders pageload
   * 11820ms).
   *
   * The list read already knows every domain on the page and is
   * already authenticated, so it can answer availability for all of
   * them in ONE query and let the renderer emit URLs only for domains
   * that will actually return bytes. Two queries total regardless of
   * page size, and neither reads the `bytea` column.
   *
   * ENQUEUEING BELONGS HERE, NOT ON THE IMAGE REQUEST. `mayEnqueue` on
   * the read path is `req.user !== undefined`, and `dm_access` lives
   * 15 minutes while a `background-image` subresource cannot refresh
   * it — so once the token aged out, the image requests that were
   * supposed to grow the cache silently stopped growing it, and the
   * domain stayed uncached forever. A list read is an ordinary
   * authenticated call that refreshes and replays, so scheduling from
   * here is the path that actually resolves marks.
   *
   * Returns the subset of `rawDomains` that has a usable mark, keyed
   * by the caller's own strings so the caller can decorate its rows
   * directly.
   */
  async marksFor(rawDomains: string[], opts: { mayEnqueue: boolean }): Promise<Set<string>> {
    const now = new Date();

    const candidates = new Map<string, { discoveryDomain: string; organizational: string }>();
    for (const raw of rawDomains) {
      const candidate = candidateDomains(raw);
      if (candidate !== null) candidates.set(raw, candidate);
    }
    if (candidates.size === 0) return new Set();

    const organizationals = [...new Set([...candidates.values()].map((c) => c.organizational))];
    const aliasRows = await this.db
      .select({
        aliasDomain: brandDomainAliases.aliasDomain,
        canonicalDomain: brandDomainAliases.canonicalDomain,
      })
      .from(brandDomainAliases)
      .where(
        and(
          inArray(brandDomainAliases.aliasDomain, organizationals),
          eq(brandDomainAliases.confidence, 100),
        ),
      );
    const canonicalByAlias = new Map(aliasRows.map((r) => [r.aliasDomain, r.canonicalDomain]));

    // Resolve each input to the domains its mark could be cached
    // under, exactly as `lookup` does, before a single cache read.
    const resolved = new Map<string, { canonical: string; cacheDomains: string[] }>();
    for (const [raw, candidate] of candidates) {
      const canonical = canonicalByAlias.get(candidate.organizational) ?? candidate.organizational;
      // A manually reviewed alias row is still input to outbound
      // resolution and crosses the same boundary as the raw domain.
      if (!isResolvableDomain(canonical)) continue;
      resolved.set(raw, {
        canonical,
        cacheDomains:
          candidate.discoveryDomain === canonical
            ? [canonical]
            : [candidate.discoveryDomain, canonical],
      });
    }
    if (resolved.size === 0) return new Set();

    const cacheDomains = [...new Set([...resolved.values()].flatMap((r) => r.cacheDomains))];
    // No `image` column: `status` alone settles availability (see
    // `isUsableMark`), so page size never pulls artwork through the
    // connection pool.
    const rows = await this.db
      .select({
        domain: domainIcons.domain,
        status: domainIcons.status,
        source: domainIcons.source,
        resolverVersion: domainIcons.resolverVersion,
        fetchedAt: domainIcons.fetchedAt,
      })
      .from(domainIcons)
      .where(inArray(domainIcons.domain, cacheDomains));
    const byDomain = new Map(rows.map((row) => [row.domain, row] as const));

    const marked = new Set<string>();
    const toSchedule = new Map<string, string>();
    for (const [raw, { canonical, cacheDomains: candidatesForRaw }] of resolved) {
      const canonicalRow = byDomain.get(canonical);
      // Same demand-driven refresh as `lookup`: never seen, or stale,
      // means schedule — and a stale row may still be served below, so
      // a queued refresh never regresses a visible logo to a monogram.
      if (canonicalRow === undefined || isStale(canonicalRow, now)) {
        toSchedule.set(canonical, resolved.get(raw)?.cacheDomains[0] ?? canonical);
      }
      for (const candidate of candidatesForRaw) {
        const row = byDomain.get(candidate);
        if (row === undefined || !isUsableMark(row, now)) continue;
        marked.add(raw);
        break;
      }
    }

    if (opts.mayEnqueue) {
      // CONCURRENT, NOT SEQUENTIAL. A first pass over a mailbox has a
      // row for almost nothing, so this can be a whole page of domains
      // — awaiting them one at a time would put ~50 Redis round trips
      // on the critical path of the very read this change exists to
      // make fast. `schedule` swallows and logs its own failures, so
      // one bad enqueue cannot reject the batch.
      //
      // Deterministic `jobId` per domain + resolver version, with
      // `removeOnComplete: {age: 24h}`, so re-listing the same page
      // collapses onto the same job rather than queuing it again, and
      // a resolved domain stops being scheduled once the worker writes
      // its row — including the `none` row for a domain with no mark.
      await Promise.all(
        sampleAtMost([...toSchedule], MAX_SCHEDULED_PER_READ).map(([canonical, discovery]) =>
          this.schedule(canonical, discovery),
        ),
      );
    }

    return marked;
  }

  /**
   * Enqueue resolution. Never throws into the read path — a queue
   * outage must degrade to "monogram forever" rather than break the
   * page that asked for an avatar.
   */
  private async schedule(domain: string, discoveryDomain: string): Promise<void> {
    if (!this.queue) return;
    try {
      // Bounded: an unreachable Redis stalls this call forever rather
      // than rejecting it — see `ENQUEUE_DEADLINE_MS`.
      await withDeadline(
        enqueueDomainIcon(this.queue, domain, discoveryDomain),
        ENQUEUE_DEADLINE_MS,
        'domain icon enqueue',
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'domain_icon.enqueue_failed',
          domain,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}
