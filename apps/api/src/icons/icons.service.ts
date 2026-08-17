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
    const discoveryDomain = brandRoot(rawDomain).replace(/\.$/, '');
    const organizational = organizationalDomain(rawDomain);
    // Rubbish never becomes a queued job. Silent miss rather than a
    // 400: the caller is an <img> tag, which can do nothing with an
    // error, and a bad domain is indistinguishable from an unknown one
    // as far as the rendered result goes.
    if (!isResolvableDomain(organizational)) return { kind: 'miss' };

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
   * Enqueue resolution. Never throws into the read path — a queue
   * outage must degrade to "monogram forever" rather than break the
   * page that asked for an avatar.
   */
  private async schedule(domain: string, discoveryDomain: string): Promise<void> {
    if (!this.queue) return;
    try {
      await enqueueDomainIcon(this.queue, domain, discoveryDomain);
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
