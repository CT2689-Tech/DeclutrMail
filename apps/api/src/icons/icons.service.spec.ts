import { brandDomainAliases, DOMAIN_ICON_RESOLVER_VERSION, domainIcons } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import type { Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';

import { IconsService, MAX_SCHEDULED_PER_READ } from './icons.service.js';

/**
 * IconsService integration tests (ADR-0034).
 *
 * The load-bearing behaviours are all about what the read path does
 * NOT do: it never fetches inline, it never lets a queue failure reach
 * the caller, and it never lets a caller distinguish a never-seen
 * domain from a logo-less one.
 */

/** Sourced from the helper the tests actually construct `db` with. */
type Db = Awaited<ReturnType<typeof freshTestDb>>;

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"/>');
const HASH = 'a'.repeat(64);

/** A queue stub that records what was scheduled. */
function fakeQueue() {
  const added: Array<{ name: string; data: unknown; opts: unknown }> = [];
  return {
    added,
    queue: {
      add: async (name: string, data: unknown, opts: unknown) => {
        added.push({ name, data, opts });
        return {} as never;
      },
    } as unknown as Queue<{ domain: string }>,
  };
}

async function seedIcon(db: Db, overrides: Partial<typeof domainIcons.$inferInsert> = {}) {
  await db.insert(domainIcons).values({
    domain: 'brand.example',
    status: 'ok',
    image: SVG,
    mime: 'image/svg+xml',
    source: 'bimi',
    contentHash: HASH,
    byteSize: SVG.byteLength,
    ...overrides,
  });
}

describe('IconsService', () => {
  it('serves a cached mark with a strong ETag', async () => {
    const db = await freshTestDb();
    await seedIcon(db);
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('brand.example', {
      mayEnqueue: true,
    });

    expect(result.kind).toBe('hit');
    expect(result.kind === 'hit' && result.image.equals(SVG)).toBe(true);
    expect(result.kind === 'hit' && result.etag).toBe(`"${HASH}"`);
    // A fresh hit schedules nothing.
    expect(added).toEqual([]);
  });

  it('misses and schedules resolution for an unknown domain', async () => {
    const db = await freshTestDb();
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('unknown.example', {
      mayEnqueue: true,
    });

    expect(result).toEqual({ kind: 'miss' });
    expect(added).toHaveLength(1);
    expect(added[0]?.data).toEqual({ domain: 'unknown.example' });
    // Domain-keyed so a grid full of the same sender collapses to one job.
    expect(added[0]?.opts).toMatchObject({
      jobId: `DomainIconWorker-v${DOMAIN_ICON_RESOLVER_VERSION}-unknown.example`,
    });
  });

  it('misses WITHOUT scheduling for a cached negative', async () => {
    const db = await freshTestDb();
    await db.insert(domainIcons).values({ domain: 'nobody.example', status: 'none' });
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('nobody.example', {
      mayEnqueue: true,
    });

    // The whole point of the negative cache: a logo-less sender must
    // not re-enqueue work on every render.
    expect(result).toEqual({ kind: 'miss' });
    expect(added).toEqual([]);
  });

  it('normalizes bulk-mail subdomains to the brand root', async () => {
    const db = await freshTestDb();
    await seedIcon(db);
    const { queue } = fakeQueue();
    const service = new IconsService(db as never, queue);

    for (const domain of ['mail1.brand.example', 'NOTIFY.brand.example', 'brand.example']) {
      expect((await service.lookup(domain, { mayEnqueue: true })).kind).toBe('hit');
    }
  });

  it('reuses a cached organizational-domain mark for an arbitrary sender subdomain', async () => {
    const db = await freshTestDb();
    await seedIcon(db, { domain: 'chase.com' });
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('alertsp.chase.com', {
      mayEnqueue: true,
    });

    expect(result.kind).toBe('hit');
    expect(added).toEqual([]);
  });

  it('reuses a canonical cache entry through a verified mailing-domain alias', async () => {
    const db = await freshTestDb();
    await seedIcon(db, { domain: 'temu.com' });
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('news.temuemail.com', {
      mayEnqueue: true,
    });

    expect(result.kind).toBe('hit');
    expect(added).toEqual([]);
  });

  it('does not rewrite a domain from an alias candidate below automatic confidence', async () => {
    const db = await freshTestDb();
    await db.insert(brandDomainAliases).values({
      aliasDomain: 'mailing-brand.example',
      canonicalDomain: 'brand.example',
      source: 'manual_review',
      confidence: 80,
    });
    await seedIcon(db);
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('mailing-brand.example', {
      mayEnqueue: true,
    });

    expect(result).toEqual({ kind: 'miss' });
    expect(added[0]?.data).toEqual({ domain: 'mailing-brand.example' });
  });

  it('schedules the canonical domain while retaining the sender domain for exact BIMI discovery', async () => {
    const db = await freshTestDb();
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('news.temuemail.com', {
      mayEnqueue: true,
    });

    expect(result).toEqual({ kind: 'miss' });
    expect(added[0]?.data).toEqual({
      domain: 'temu.com',
      discoveryDomain: 'temuemail.com',
    });
    expect(added[0]?.opts).toMatchObject({
      jobId: `DomainIconWorker-v${DOMAIN_ICON_RESOLVER_VERSION}-temu.com`,
    });
  });

  it('keeps serving an existing exact-domain mark while canonical cache migration is queued', async () => {
    const db = await freshTestDb();
    await seedIcon(db, { domain: 'welcome.americanexpress.com' });
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup(
      'welcome.americanexpress.com',
      { mayEnqueue: true },
    );

    expect(result.kind).toBe('hit');
    expect(added[0]?.data).toEqual({
      domain: 'americanexpress.com',
      discoveryDomain: 'welcome.americanexpress.com',
    });
  });

  it('serves a stale mark and re-queues it', async () => {
    const db = await freshTestDb();
    const longAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await seedIcon(db, { fetchedAt: longAgo });
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('brand.example', {
      mayEnqueue: true,
    });

    // Stale-while-revalidate: a stale mark beats no mark.
    expect(result.kind).toBe('hit');
    expect(added).toHaveLength(1);
  });

  it('stops serving stale Brandfetch artwork while its refresh is queued', async () => {
    const db = await freshTestDb();
    const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await seedIcon(db, { source: 'brandfetch', mime: 'image/png', fetchedAt: longAgo });
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('brand.example', {
      mayEnqueue: true,
    });

    expect(result).toEqual({ kind: 'miss' });
    expect(added).toHaveLength(1);
  });

  it('re-queues a stale negative but still reports a miss', async () => {
    const db = await freshTestDb();
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await db
      .insert(domainIcons)
      .values({ domain: 'nobody.example', status: 'none', fetchedAt: longAgo });
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('nobody.example', {
      mayEnqueue: true,
    });

    expect(result).toEqual({ kind: 'miss' });
    expect(added).toHaveLength(1);
  });

  it('re-queues a fresh negative produced by an older resolver strategy', async () => {
    const db = await freshTestDb();
    await db.insert(domainIcons).values({
      domain: 'nobody.example',
      status: 'none',
      resolverVersion: DOMAIN_ICON_RESOLVER_VERSION - 1,
    });
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('nobody.example', {
      mayEnqueue: true,
    });

    expect(result).toEqual({ kind: 'miss' });
    expect(added).toHaveLength(1);
  });

  it.each(['', 'not a domain', 'https://brand.example', '../../etc/passwd', 'localhost'])(
    'refuses to schedule anything for %s',
    async (domain) => {
      const db = await freshTestDb();
      const { queue, added } = fakeQueue();

      const result = await new IconsService(db as never, queue).lookup(domain, {
        mayEnqueue: true,
      });

      expect(result).toEqual({ kind: 'miss' });
      expect(added).toEqual([]);
    },
  );

  it('serves an anonymous caller from cache but schedules nothing for one', async () => {
    const db = await freshTestDb();
    await seedIcon(db);
    const { queue, added } = fakeQueue();
    const service = new IconsService(db as never, queue);

    const hit = await service.lookup('brand.example', { mayEnqueue: false });
    const miss = await service.lookup('unknown.example', { mayEnqueue: false });

    // Reading the cache without a session is deliberate (founder
    // decision 2026-08-16): an image subresource cannot refresh an
    // expired token, so requiring one meant no logo ever rendered.
    expect(hit.kind).toBe('hit');
    expect(miss).toEqual({ kind: 'miss' });
    // Growing it is not. This is the half of the old guard that still
    // matters: a stranger must not drive our DNS and HTTPS fetches at
    // domains of their choosing, or fill this table doing it.
    expect(added).toEqual([]);
  });

  it('degrades to a miss when the queue is unavailable', async () => {
    const db = await freshTestDb();

    // No Redis in local dev — serve what is cached, schedule nothing,
    // and never fail the read.
    const result = await new IconsService(db as never, null).lookup('unknown.example', {
      mayEnqueue: true,
    });

    expect(result).toEqual({ kind: 'miss' });
  });

  it('never lets a queue failure reach the caller', async () => {
    const db = await freshTestDb();
    const broken = {
      add: async () => {
        throw new Error('redis is down');
      },
    } as unknown as Queue<{ domain: string }>;

    // A queue outage means "monograms until it recovers", never a
    // broken avatar or a 500 on the page that asked for one.
    await expect(
      new IconsService(db as never, broken).lookup('unknown.example', { mayEnqueue: true }),
    ).resolves.toEqual({
      kind: 'miss',
    });
  });

  describe('marksFor', () => {
    it("reports availability for a page in one pass, keyed by the caller's strings", async () => {
      const db = await freshTestDb();
      await seedIcon(db, { domain: 'brand.example' });
      // Looked, found nothing — a cached miss is NOT availability.
      await seedIcon(db, {
        domain: 'nothing.example',
        status: 'none',
        image: null,
        mime: null,
        source: null,
        contentHash: null,
        byteSize: null,
      });
      const { queue } = fakeQueue();

      const marks = await new IconsService(db as never, queue).marksFor(
        ['brand.example', 'nothing.example', 'never-seen.example'],
        { mayEnqueue: false },
      );

      expect(marks).toEqual(new Set(['brand.example']));
    });

    // THE DRIFT GUARD. `marksFor` answers the same question as `lookup`
    // without reading the image bytes, so the two must never disagree
    // — a page that says "no mark" for a domain the route would happily
    // serve is a silently missing logo, and the opposite is the 204
    // request this whole change exists to remove.
    it('agrees with lookup on every domain shape', async () => {
      const db = await freshTestDb();
      await seedIcon(db, { domain: 'brand.example' });
      await seedIcon(db, {
        domain: 'stale-provider.example',
        source: 'brandfetch',
        fetchedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      });
      await seedIcon(db, {
        domain: 'nothing.example',
        status: 'none',
        image: null,
        mime: null,
        source: null,
        contentHash: null,
        byteSize: null,
      });
      const domains = [
        'brand.example',
        'stale-provider.example',
        'nothing.example',
        'never-seen.example',
        'not a domain',
      ];
      const { queue } = fakeQueue();
      const svc = new IconsService(db as never, queue);

      const marks = await svc.marksFor(domains, { mayEnqueue: false });
      for (const domain of domains) {
        const viaLookup = (await svc.lookup(domain, { mayEnqueue: false })).kind === 'hit';
        expect({ domain, marked: marks.has(domain) }).toEqual({ domain, marked: viaLookup });
      }
    });

    // The reason enqueueing moved here: an image subresource cannot
    // refresh an expired token, so scheduling from the authenticated
    // list read is the path that actually grows the cache.
    it('schedules resolution for what it does not have, once per domain', async () => {
      const db = await freshTestDb();
      const { queue, added } = fakeQueue();

      await new IconsService(db as never, queue).marksFor(
        ['first.example', 'second.example', 'first.example'],
        { mayEnqueue: true },
      );

      expect(added.map((job) => job.data)).toEqual([
        { domain: 'first.example' },
        { domain: 'second.example' },
      ]);
      // Deterministic job id per domain + resolver version, so a
      // re-listed page collapses onto the same job.
      expect(added[0]?.opts).toMatchObject({
        jobId: `DomainIconWorker-v${DOMAIN_ICON_RESOLVER_VERSION}-first.example`,
      });
    });

    it('bounds how much background work one read can schedule', async () => {
      const db = await freshTestDb();
      const { queue, added } = fakeQueue();
      const domains = Array.from({ length: 40 }, (_, i) => `d${i}.example`);

      await new IconsService(db as never, queue).marksFor(domains, { mayEnqueue: true });

      // A read that schedules a job per uncached domain turns one page
      // view into a page-sized burst on the resolver.
      expect(added).toHaveLength(MAX_SCHEDULED_PER_READ);
    });

    it('never causes outbound work without a session', async () => {
      const db = await freshTestDb();
      const { queue, added } = fakeQueue();

      await new IconsService(db as never, queue).marksFor(['unknown.example'], {
        mayEnqueue: false,
      });

      expect(added).toEqual([]);
    });

    it('resolves a page through the alias registry', async () => {
      const db = await freshTestDb();
      await seedIcon(db, { domain: 'canonical.example' });
      await db.insert(brandDomainAliases).values({
        aliasDomain: 'alias.example',
        canonicalDomain: 'canonical.example',
        source: 'manual_review',
        confidence: 100,
      });
      const { queue } = fakeQueue();

      const marks = await new IconsService(db as never, queue).marksFor(['alias.example'], {
        mayEnqueue: false,
      });

      expect(marks).toEqual(new Set(['alias.example']));
    });
  });
});
