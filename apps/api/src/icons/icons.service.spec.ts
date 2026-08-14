import { domainIcons, schema } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import type { Queue } from 'bullmq';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';

import { IconsService } from './icons.service.js';

/**
 * IconsService integration tests (ADR-0034).
 *
 * The load-bearing behaviours are all about what the read path does
 * NOT do: it never fetches inline, it never lets a queue failure reach
 * the caller, and it never lets a caller distinguish a never-seen
 * domain from a logo-less one.
 */

type Db = ReturnType<typeof drizzle<typeof schema>>;

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

    const result = await new IconsService(db as never, queue).lookup('brand.example');

    expect(result.kind).toBe('hit');
    expect(result.kind === 'hit' && result.image.equals(SVG)).toBe(true);
    expect(result.kind === 'hit' && result.etag).toBe(`"${HASH}"`);
    // A fresh hit schedules nothing.
    expect(added).toEqual([]);
  });

  it('misses and schedules resolution for an unknown domain', async () => {
    const db = await freshTestDb();
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('unknown.example');

    expect(result).toEqual({ kind: 'miss' });
    expect(added).toHaveLength(1);
    expect(added[0]?.data).toEqual({ domain: 'unknown.example' });
    // Domain-keyed so a grid full of the same sender collapses to one job.
    expect(added[0]?.opts).toMatchObject({ jobId: 'DomainIconWorker-unknown.example' });
  });

  it('misses WITHOUT scheduling for a cached negative', async () => {
    const db = await freshTestDb();
    await db.insert(domainIcons).values({ domain: 'nobody.example', status: 'none' });
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('nobody.example');

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
      expect((await service.lookup(domain)).kind).toBe('hit');
    }
  });

  it('serves a stale mark and re-queues it', async () => {
    const db = await freshTestDb();
    const longAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await seedIcon(db, { fetchedAt: longAgo });
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('brand.example');

    // Stale-while-revalidate: a stale mark beats no mark.
    expect(result.kind).toBe('hit');
    expect(added).toHaveLength(1);
  });

  it('re-queues a stale negative but still reports a miss', async () => {
    const db = await freshTestDb();
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await db
      .insert(domainIcons)
      .values({ domain: 'nobody.example', status: 'none', fetchedAt: longAgo });
    const { queue, added } = fakeQueue();

    const result = await new IconsService(db as never, queue).lookup('nobody.example');

    expect(result).toEqual({ kind: 'miss' });
    expect(added).toHaveLength(1);
  });

  it.each(['', 'not a domain', 'https://brand.example', '../../etc/passwd', 'localhost'])(
    'refuses to schedule anything for %s',
    async (domain) => {
      const db = await freshTestDb();
      const { queue, added } = fakeQueue();

      const result = await new IconsService(db as never, queue).lookup(domain);

      expect(result).toEqual({ kind: 'miss' });
      expect(added).toEqual([]);
    },
  );

  it('degrades to a miss when the queue is unavailable', async () => {
    const db = await freshTestDb();

    // No Redis in local dev — serve what is cached, schedule nothing,
    // and never fail the read.
    const result = await new IconsService(db as never, null).lookup('unknown.example');

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
    await expect(new IconsService(db as never, broken).lookup('unknown.example')).resolves.toEqual({
      kind: 'miss',
    });
  });
});
