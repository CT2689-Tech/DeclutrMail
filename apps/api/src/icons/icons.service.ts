import { createHash } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Queue } from 'bullmq';

import { domainIcons } from '@declutrmail/db';
import { brandRoot } from '@declutrmail/shared/senders';
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
 * never coupled to a third party's DNS and TLS. That is the whole
 * reason the read path is allowed to be on the critical path at all.
 *
 * Refresh is demand-driven: a stale row is served AND re-queued
 * (stale-while-revalidate), so the TTL needs no background sweep and
 * we only spend fetches on domains someone is actually looking at.
 *
 * Privacy (D7, D228): the only input is a domain string and the only
 * output is public brand artwork. Nothing here reads or writes
 * user-scoped data — see `domain_icons`' no-user-linkage note.
 */
@Injectable()
export class IconsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Optional()
    @Inject(DOMAIN_ICON_QUEUE_TOKEN)
    private readonly queue: Queue<DomainIconJobData> | null = null,
  ) {}

  async lookup(rawDomain: string): Promise<IconLookup> {
    const domain = brandRoot(rawDomain);
    // Rubbish never becomes a queued job. Silent miss rather than a
    // 400: the caller is an <img> tag, which can do nothing with an
    // error, and a bad domain is indistinguishable from an unknown one
    // as far as the rendered result goes.
    if (!isResolvableDomain(domain)) return { kind: 'miss' };

    const [row] = await this.db
      .select({
        status: domainIcons.status,
        image: domainIcons.image,
        mime: domainIcons.mime,
        contentHash: domainIcons.contentHash,
        fetchedAt: domainIcons.fetchedAt,
      })
      .from(domainIcons)
      .where(eq(domainIcons.domain, domain))
      .limit(1);

    if (!row) {
      await this.schedule(domain);
      return { kind: 'miss' };
    }

    if (isStale({ status: row.status, fetchedAt: row.fetchedAt }, new Date())) {
      // Re-queue, then serve whatever we hold. A stale mark is a far
      // better answer than no mark, and the job dedups on the domain
      // so a busy page cannot pile up refreshes.
      await this.schedule(domain);
    }

    if (row.status === 'none' || !row.image || !row.mime) return { kind: 'miss' };

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

  /**
   * Enqueue resolution. Never throws into the read path — a queue
   * outage must degrade to "monogram forever" rather than break the
   * page that asked for an avatar.
   */
  private async schedule(domain: string): Promise<void> {
    if (!this.queue) return;
    try {
      await enqueueDomainIcon(this.queue, domain);
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
