import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { DOMAIN_ICON_RESOLVER_VERSION, domainIcons } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';

import {
  DomainIconWorker,
  isResolvableDomain,
  isStale,
  isWebsiteIconFallbackEnabled,
} from './domain-icon.worker.js';
import { domainIconJobOptions } from './domain-icon.queue.js';
import type { BimiHttpPort } from './bimi-resolver.js';
import type { BrandfetchIconHttpPort } from './brandfetch-icon-resolver.js';
import type { WebsiteIconHttpPort } from './website-icon-resolver.js';
import type { WorkerContext } from './worker-context.js';

/**
 * DomainIconWorker tests (ADR-0034).
 *
 * The behaviours worth pinning are the ones that keep outbound fetch
 * count at one-per-domain-per-TTL: the negative cache, the freshness
 * re-check, and the domain-keyed idempotency.
 */

const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect/></svg>';
const RECORD = 'v=BIMI1; l=https://brand.example/logo.svg; a=https://brand.example/vmc.pem';
const WEBSITE_PNG = readFileSync(
  new URL('../../../apps/web/public/icons/icon-192.png', import.meta.url),
);
const CTX: WorkerContext = {
  jobId: 'test',
  workerName: 'DomainIconWorker',
  attempt: 1,
  maxAttempts: 3,
  startedAt: new Date(),
  policy: 'batchPolicy',
};

function bimiDeps(overrides: { record?: string; http?: BimiHttpPort } = {}) {
  return {
    resolveTxt: async () => [[overrides.record ?? RECORD]],
    resolveHost: async () => ['93.184.216.34'],
    // Certificate verification is covered against a real chain in
    // `vmc-verifier.test.ts`; these cases are about cache behaviour.
    verifyVmc: () => ({ ok: true }) as const,
    http:
      overrides.http ??
      ({
        get: async () => ({
          status: 200,
          contentType: 'image/svg+xml',
          body: Buffer.from(LOGO),
        }),
      } satisfies BimiHttpPort),
  };
}

/**
 * An http port that counts dials — proves work was or was not repeated.
 *
 * One RESOLUTION is two dials since Phase 2: the logo, then the
 * certificate that has to stand behind it. `resolutions` is the number
 * the cache guarantees bound, so that is what the tests assert on.
 */
function countingHttp() {
  const port = {
    calls: 0,
    get resolutions() {
      return port.calls / FETCHES_PER_RESOLUTION;
    },
    get: async () => {
      port.calls++;
      return { status: 200, contentType: 'image/svg+xml', body: Buffer.from(LOGO) };
    },
  };
  return port;
}

/** Logo + VMC. */
const FETCHES_PER_RESOLUTION = 2;

describe('DomainIconWorker', () => {
  it('stores a resolved mark', async () => {
    const db = await freshTestDb();
    const worker = new DomainIconWorker({ db: db as never, bimi: bimiDeps() });

    const result = await worker.processJob({ domain: 'brand.example' }, CTX);

    expect(result.outcome).toBe('stored');
    expect(result.source).toBe('bimi');
    const [row] = await db.select().from(domainIcons);
    expect(row?.domain).toBe('brand.example');
    expect(row?.status).toBe('ok');
    expect(row?.source).toBe('bimi');
    expect(Buffer.from(row!.image!).toString('utf8')).toBe(LOGO);
    expect(row?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.byteSize).toBe(Buffer.byteLength(LOGO));
  });

  it('caches a miss so the domain is not re-resolved forever', async () => {
    const db = await freshTestDb();
    const worker = new DomainIconWorker({
      db: db as never,
      bimi: { resolveTxt: async () => [['v=spf1 -all']] },
    });

    const result = await worker.processJob({ domain: 'nobody.example' }, CTX);

    expect(result.outcome).toBe('cached_miss');
    const [row] = await db.select().from(domainIcons);
    expect(row?.status).toBe('none');
    expect(row?.image).toBeNull();
  });

  it('stores an official website icon when BIMI has no usable mark', async () => {
    const db = await freshTestDb();
    const http: WebsiteIconHttpPort = {
      get: async (url) => {
        if (url === 'https://brand.example/') {
          return {
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: Buffer.from(
              '<html><head><link rel="apple-touch-icon" sizes="180x180" href="/brand.png"></head></html>',
            ),
          };
        }
        if (url === 'https://brand.example/brand.png') {
          return { status: 200, contentType: 'image/png', body: WEBSITE_PNG };
        }
        return { status: 404, contentType: 'text/plain' };
      },
    };
    const worker = new DomainIconWorker({
      db: db as never,
      bimi: { resolveTxt: async () => [['v=spf1 -all']] },
      website: {
        resolveHost: async () => ['93.184.216.34'],
        http,
      },
    });

    const result = await worker.processJob({ domain: 'brand.example' }, CTX);

    expect(result.outcome).toBe('stored');
    expect(result.source).toBe('website');
    const [row] = await db.select().from(domainIcons);
    expect(row?.domain).toBe('brand.example');
    expect(row?.status).toBe('ok');
    expect(row?.source).toBe('vendor');
    expect(row?.mime).toBe('image/png');
    expect(row?.byteSize).toBeGreaterThan(0);
  });

  it('tries BIMI on the sender domain before resolving website artwork on the canonical domain', async () => {
    const db = await freshTestDb();
    const dnsCalls: string[] = [];
    const websiteCalls: string[] = [];
    const worker = new DomainIconWorker({
      db: db as never,
      bimi: {
        resolveTxt: async (name) => {
          dnsCalls.push(name);
          return [['v=spf1 -all']];
        },
      },
      website: {
        resolveHost: async () => ['93.184.216.34'],
        http: {
          get: async (url) => {
            websiteCalls.push(url);
            if (url === 'https://temu.com/') {
              return {
                status: 200,
                contentType: 'text/html',
                body: Buffer.from(
                  '<link rel="apple-touch-icon" sizes="180x180" href="/brand.png">',
                ),
              };
            }
            if (url === 'https://temu.com/brand.png') {
              return { status: 200, contentType: 'image/png', body: WEBSITE_PNG };
            }
            return { status: 404, contentType: 'text/plain' };
          },
        },
      },
    });

    const result = await worker.processJob(
      { domain: 'temu.com', discoveryDomain: 'temuemail.com' },
      CTX,
    );

    expect(result).toMatchObject({ outcome: 'stored', source: 'website' });
    expect(dnsCalls[0]).toBe('default._bimi.temuemail.com');
    expect(websiteCalls).toEqual(['https://temu.com/', 'https://temu.com/brand.png']);
    expect((await db.select().from(domainIcons))[0]?.domain).toBe('temu.com');
  });

  it('stores a Brandfetch icon only after BIMI and the official website miss', async () => {
    const db = await freshTestDb();
    const calls: string[] = [];
    const http: BrandfetchIconHttpPort = {
      get: async (url) => {
        calls.push(url);
        if (url.includes('/v2/brands/domain/retailmenot.com')) {
          return {
            status: 200,
            contentType: 'application/json',
            body: Buffer.from(
              JSON.stringify({
                logos: [
                  {
                    type: 'icon',
                    formats: [
                      {
                        src: 'https://cdn.brandfetch.io/retailmenot.png',
                        format: 'png',
                        width: 400,
                        height: 400,
                      },
                    ],
                  },
                ],
              }),
            ),
          };
        }
        return { status: 200, contentType: 'image/png', body: WEBSITE_PNG };
      },
    };
    const dnsNotFound = Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    const worker = new DomainIconWorker({
      db: db as never,
      bimi: { resolveTxt: async () => [['v=spf1 -all']] },
      website: {
        resolveHost: async () => {
          throw dnsNotFound;
        },
      },
      brandfetch: {
        apiKey: 'server-secret',
        resolveHost: async () => ['93.184.216.34'],
        http,
      },
    });

    const result = await worker.processJob({ domain: 'retailmenot.com' }, CTX);

    expect(result).toMatchObject({ outcome: 'stored', source: 'brandfetch' });
    expect(calls).toEqual([
      'https://api.brandfetch.io/v2/brands/domain/retailmenot.com',
      'https://cdn.brandfetch.io/retailmenot.png',
    ]);
    const [row] = await db.select().from(domainIcons);
    expect(row?.source).toBe('brandfetch');
  });

  it('uses Brandfetch when the official website is temporarily unavailable', async () => {
    const db = await freshTestDb();
    const brandfetchHttp: BrandfetchIconHttpPort = {
      get: async (url) => {
        if (url.includes('api.brandfetch.io')) {
          return {
            status: 200,
            contentType: 'application/json',
            body: Buffer.from(
              JSON.stringify({
                logos: [
                  {
                    type: 'icon',
                    formats: [
                      {
                        src: 'https://cdn.brandfetch.io/icon.png',
                        format: 'png',
                        width: 400,
                        height: 400,
                      },
                    ],
                  },
                ],
              }),
            ),
          };
        }
        return { status: 200, contentType: 'image/png', body: WEBSITE_PNG };
      },
    };
    const result = await new DomainIconWorker({
      db: db as never,
      bimi: { resolveTxt: async () => [['v=spf1 -all']] },
      website: {
        resolveHost: async () => {
          throw Object.assign(new Error('temporary DNS failure'), { code: 'EAI_AGAIN' });
        },
      },
      brandfetch: {
        apiKey: 'server-secret',
        resolveHost: async () => ['93.184.216.34'],
        http: brandfetchHttp,
      },
    }).processJob({ domain: 'brand.example' }, CTX);

    expect(result).toMatchObject({ outcome: 'stored', source: 'brandfetch' });
  });

  // A PROVIDER QUOTA MUST NOT DEAD-LETTER, AND MUST NOT BECOME A `none`.
  //
  // Brandfetch answers 429 once its quota is spent. That used to escape
  // the job, burn all 3 attempts and park the domain in the dead-letter
  // queue — before `store` ran, so the domain never recorded that we
  // looked, the next demand re-enqueued it, and it dead-lettered again.
  // That loop is why production resolution stalled at 115 of ~3,344
  // domains.
  //
  // Writing `none` instead would be worse: a quota response is no more
  // proof this domain lacks a logo than an unreachable website is, and
  // `none` is cached for 30 days.
  it('defers on a provider quota instead of failing or caching a false miss', async () => {
    const db = await freshTestDb();
    const http: BrandfetchIconHttpPort = {
      get: async () => ({ status: 429, contentType: 'application/json', body: Buffer.from('{}') }),
    };
    const dnsNotFound = Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    const worker = new DomainIconWorker({
      db: db as never,
      bimi: { resolveTxt: async () => [['v=spf1 -all']] },
      website: {
        resolveHost: async () => {
          throw dnsNotFound;
        },
      },
      brandfetch: { apiKey: 'server-secret', resolveHost: async () => ['93.184.216.34'], http },
    });

    // Completes rather than throwing — nothing to retry, nothing to park.
    const result = await worker.processJob({ domain: 'retailmenot.com' }, CTX);
    expect(result).toMatchObject({ outcome: 'provider_exhausted', source: null });

    // And leaves no row, so the domain is neither claimed logo-less nor
    // suppressed for 30 days — the next list read tries it again.
    const rows = await db.select().from(domainIcons);
    expect(rows).toEqual([]);
  });

  it('normalizes bulk-mail subdomains to the brand root', async () => {
    const db = await freshTestDb();
    const worker = new DomainIconWorker({ db: db as never, bimi: bimiDeps() });

    // Every one of these is the same brand — and must be one row and
    // one resolution run, not four.
    for (const domain of [
      'mail1.brand.example',
      'email.brand.example',
      'notify.brand.example',
      'BRAND.example',
    ]) {
      await worker.processJob({ domain }, CTX);
    }

    const rows = await db.select().from(domainIcons);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.domain).toBe('brand.example');
  });

  it('does not re-fetch a domain resolved inside its TTL', async () => {
    const db = await freshTestDb();
    const http = countingHttp();
    const worker = new DomainIconWorker({ db: db as never, bimi: bimiDeps({ http }) });

    await worker.processJob({ domain: 'brand.example' }, CTX);
    // A queued job racing a completed one: jobId dedup covers concurrent
    // enqueues, not this, so the freshness re-check has to.
    const second = await worker.processJob({ domain: 'brand.example' }, CTX);

    expect(second.outcome).toBe('still_fresh');
    expect(http.resolutions).toBe(1);
  });

  it('re-resolves once the TTL has passed', async () => {
    const db = await freshTestDb();
    const http = countingHttp();
    const now = new Date('2026-08-14T12:00:00Z');
    const worker = new DomainIconWorker({
      db: db as never,
      bimi: bimiDeps({ http }),
      now: () => now,
    });

    await worker.processJob({ domain: 'brand.example' }, CTX);

    const later = new Date('2026-12-14T12:00:00Z'); // > 90d
    const refreshed = new DomainIconWorker({
      db: db as never,
      bimi: bimiDeps({ http }),
      now: () => later,
    });
    const result = await refreshed.processJob({ domain: 'brand.example' }, CTX);

    // Same bytes → the payload is left alone but the TTL restarts, so
    // every client's cached ETag stays valid.
    expect(result.outcome).toBe('unchanged');
    expect(http.resolutions).toBe(2);
    const [row] = await db.select().from(domainIcons);
    expect(row?.fetchedAt.toISOString()).toBe(later.toISOString());
  });

  it('updates provenance when byte-identical artwork moves to the verified tier', async () => {
    const db = await freshTestDb();
    const later = new Date('2026-08-14T12:00:00Z');
    await db.insert(domainIcons).values({
      domain: 'brand.example',
      status: 'ok',
      image: Buffer.from(LOGO),
      mime: 'image/svg+xml',
      source: 'vendor',
      contentHash: createHash('sha256').update(LOGO).digest('hex'),
      byteSize: Buffer.byteLength(LOGO),
      fetchedAt: new Date('2026-04-01T12:00:00Z'),
    });

    const result = await new DomainIconWorker({
      db: db as never,
      bimi: bimiDeps(),
      now: () => later,
    }).processJob({ domain: 'brand.example' }, CTX);

    expect(result.outcome).toBe('unchanged');
    expect(result.source).toBe('bimi');
    const [row] = await db.select().from(domainIcons);
    expect(row?.source).toBe('bimi');
    expect(row?.fetchedAt.toISOString()).toBe(later.toISOString());
  });

  it('preserves a last-known-good mark when a refresh temporarily finds nothing', async () => {
    const db = await freshTestDb();
    const now = new Date('2026-08-14T12:00:00Z');
    const fetchedAt = new Date('2026-04-16T12:00:00Z'); // 120d old: stale, inside grace
    await db.insert(domainIcons).values({
      domain: 'brand.example',
      status: 'ok',
      image: Buffer.from(LOGO),
      mime: 'image/svg+xml',
      source: 'bimi',
      contentHash: 'a'.repeat(64),
      byteSize: Buffer.byteLength(LOGO),
      fetchedAt,
    });
    const worker = new DomainIconWorker({
      db: db as never,
      now: () => now,
      bimi: { resolveTxt: async () => [['v=spf1 -all']] },
    });

    const result = await worker.processJob({ domain: 'brand.example' }, CTX);

    expect(result.outcome).toBe('preserved_stale');
    expect(result.source).toBe('bimi');
    const [row] = await db.select().from(domainIcons);
    expect(row?.status).toBe('ok');
    expect(Buffer.from(row!.image!).toString('utf8')).toBe(LOGO);
    // Keep the original age so the worker retries after the completed
    // job's short Redis tail instead of hiding the failed refresh for 90d.
    expect(row?.fetchedAt.toISOString()).toBe(fetchedAt.toISOString());
  });

  it('expires a last-known-good mark after the bounded stale grace period', async () => {
    const db = await freshTestDb();
    const now = new Date('2026-08-14T12:00:00Z');
    await db.insert(domainIcons).values({
      domain: 'brand.example',
      status: 'ok',
      image: Buffer.from(LOGO),
      mime: 'image/svg+xml',
      source: 'bimi',
      contentHash: 'a'.repeat(64),
      byteSize: Buffer.byteLength(LOGO),
      fetchedAt: new Date('2026-02-14T12:00:00Z'), // 181d old: outside grace
    });
    const worker = new DomainIconWorker({
      db: db as never,
      now: () => now,
      bimi: { resolveTxt: async () => [['v=spf1 -all']] },
    });

    const result = await worker.processJob({ domain: 'brand.example' }, CTX);

    expect(result.outcome).toBe('cached_miss');
    const [row] = await db.select().from(domainIcons);
    expect(row?.status).toBe('none');
    expect(row?.image).toBeNull();
  });

  it('replaces the mark when a brand re-publishes different art', async () => {
    const db = await freshTestDb();
    const now = new Date('2026-08-14T12:00:00Z');
    await new DomainIconWorker({ db: db as never, bimi: bimiDeps(), now: () => now }).processJob(
      { domain: 'brand.example' },
      CTX,
    );

    const rebranded = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle/></svg>';
    const later = new Date('2026-12-14T12:00:00Z');
    const result = await new DomainIconWorker({
      db: db as never,
      now: () => later,
      bimi: bimiDeps({
        http: {
          get: async () => ({
            status: 200,
            contentType: 'image/svg+xml',
            body: Buffer.from(rebranded),
          }),
        },
      }),
    }).processJob({ domain: 'brand.example' }, CTX);

    expect(result.outcome).toBe('stored');
    const [row] = await db.select().from(domainIcons);
    expect(Buffer.from(row!.image!).toString('utf8')).toBe(rebranded);
  });

  it('flips a cached miss to a mark when the brand starts publishing', async () => {
    const db = await freshTestDb();
    const now = new Date('2026-08-14T12:00:00Z');
    await new DomainIconWorker({
      db: db as never,
      now: () => now,
      bimi: { resolveTxt: async () => [['v=spf1 -all']] },
    }).processJob({ domain: 'brand.example' }, CTX);

    const later = new Date('2026-09-20T12:00:00Z'); // > 30d
    const result = await new DomainIconWorker({
      db: db as never,
      now: () => later,
      bimi: bimiDeps(),
    }).processJob({ domain: 'brand.example' }, CTX);

    expect(result.outcome).toBe('stored');
    const [row] = await db.select().from(domainIcons);
    expect(row?.status).toBe('ok');
  });

  it('re-resolves a fresh miss produced by an older resolver strategy', async () => {
    const db = await freshTestDb();
    await db.insert(domainIcons).values({
      domain: 'brand.example',
      status: 'none',
      resolverVersion: DOMAIN_ICON_RESOLVER_VERSION - 1,
    });

    const result = await new DomainIconWorker({
      db: db as never,
      bimi: bimiDeps(),
    }).processJob({ domain: 'brand.example' }, CTX);

    expect(result.outcome).toBe('stored');
    const [row] = await db.select().from(domainIcons);
    expect(row?.status).toBe('ok');
    expect(row?.resolverVersion).toBe(DOMAIN_ICON_RESOLVER_VERSION);
  });

  it('rejects an unusable domain terminally rather than retrying', async () => {
    const db = await freshTestDb();
    const worker = new DomainIconWorker({ db: db as never, bimi: bimiDeps() });

    await expect(worker.processJob({ domain: 'not a domain' }, CTX)).rejects.toThrow(
      /unusable domain/,
    );
    expect(await db.select().from(domainIcons)).toEqual([]);
  });

  it('writes no user-linked data', async () => {
    const db = await freshTestDb();
    await new DomainIconWorker({ db: db as never, bimi: bimiDeps() }).processJob(
      { domain: 'brand.example' },
      CTX,
    );

    // The whole row, as stored. If a future change adds anything
    // user-shaped, this snapshot is where it shows up.
    const [row] = await db
      .select()
      .from(domainIcons)
      .where(eq(domainIcons.domain, 'brand.example'));
    expect(Object.keys(row!).sort()).toEqual([
      'byteSize',
      'contentHash',
      'domain',
      'fetchedAt',
      'image',
      'mime',
      'resolverVersion',
      'source',
      'status',
    ]);
  });
});

describe('domainIconJobOptions', () => {
  it('keys the job on the resolver version and domain so upgrades bypass old completions', () => {
    // 200 uncached senders on one grid render must produce ONE job.
    expect(domainIconJobOptions('brand.example').jobId).toBe(
      `DomainIconWorker-v${DOMAIN_ICON_RESOLVER_VERSION}-brand.example`,
    );
    expect(domainIconJobOptions('other.example').jobId).toBe(
      `DomainIconWorker-v${DOMAIN_ICON_RESOLVER_VERSION}-other.example`,
    );
  });

  it('uses a job id BullMQ will accept', () => {
    // BullMQ throws "Custom Id cannot contain :" on `Queue.add`. The
    // producer swallows enqueue errors so the read path survives a
    // Redis outage, which means a bad id fails INVISIBLY: every avatar
    // renders a monogram forever and nothing appears broken. Caught by
    // live smoke, 2026-08-14 — a unit test never would have, since the
    // queue is a stub here. This guards the regression cheaply.
    expect(domainIconJobOptions('brand.example').jobId).not.toContain(':');
  });

  it('releases a terminal failure after one hour so a transient outage cannot hide logos for days', () => {
    expect(domainIconJobOptions('brand.example').removeOnFail).toEqual({ age: 60 * 60 });
  });
});

describe('isWebsiteIconFallbackEnabled', () => {
  it('defaults on and accepts the deployed true value', () => {
    expect(isWebsiteIconFallbackEnabled(undefined)).toBe(true);
    expect(isWebsiteIconFallbackEnabled('true')).toBe(true);
  });

  it('provides an exact false kill switch without disabling BIMI', () => {
    expect(isWebsiteIconFallbackEnabled('false')).toBe(false);
  });
});

describe('isResolvableDomain', () => {
  it.each(['brand.example', 'a.b.co.uk', 'x-y.example.com'])('accepts %s', (d) => {
    expect(isResolvableDomain(d)).toBe(true);
  });

  it.each([
    '',
    'localhost',
    'not a domain',
    'https://brand.example',
    'brand.example/logo',
    '-brand.example',
    `${'a'.repeat(250)}.example`,
  ])('rejects %s', (d) => {
    expect(isResolvableDomain(d)).toBe(false);
  });
});

describe('isStale', () => {
  const now = new Date('2026-08-14T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  it('holds a mark for 90 days', () => {
    expect(
      isStale(
        {
          status: 'ok',
          source: 'bimi',
          fetchedAt: daysAgo(89),
          resolverVersion: DOMAIN_ICON_RESOLVER_VERSION,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isStale(
        {
          status: 'ok',
          source: 'vendor',
          fetchedAt: daysAgo(91),
          resolverVersion: DOMAIN_ICON_RESOLVER_VERSION,
        },
        now,
      ),
    ).toBe(true);
  });

  it('refreshes Brandfetch artwork at its 30-day cache limit', () => {
    expect(
      isStale(
        {
          status: 'ok',
          source: 'brandfetch',
          fetchedAt: daysAgo(29),
          resolverVersion: DOMAIN_ICON_RESOLVER_VERSION,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isStale(
        {
          status: 'ok',
          source: 'brandfetch',
          fetchedAt: daysAgo(31),
          resolverVersion: DOMAIN_ICON_RESOLVER_VERSION,
        },
        now,
      ),
    ).toBe(true);
  });

  it('retries a miss after 30 days', () => {
    expect(
      isStale(
        {
          status: 'none',
          source: null,
          fetchedAt: daysAgo(29),
          resolverVersion: DOMAIN_ICON_RESOLVER_VERSION,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isStale(
        {
          status: 'none',
          source: null,
          fetchedAt: daysAgo(31),
          resolverVersion: DOMAIN_ICON_RESOLVER_VERSION,
        },
        now,
      ),
    ).toBe(true);
  });

  it('retries a fresh miss produced by an older resolver strategy', () => {
    expect(
      isStale(
        {
          status: 'none',
          source: null,
          fetchedAt: daysAgo(1),
          resolverVersion: 2,
        },
        now,
      ),
    ).toBe(true);
  });
});
