import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { domainIcons } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';

import { DomainIconWorker, isResolvableDomain, isStale } from './domain-icon.worker.js';
import { domainIconJobOptions, DOMAIN_ICON_RESOLVER_VERSION } from './domain-icon.queue.js';
import type { BimiHttpPort } from './bimi-resolver.js';
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

  it('normalizes bulk-mail subdomains to the brand root', async () => {
    const db = await freshTestDb();
    const worker = new DomainIconWorker({ db: db as never, bimi: bimiDeps() });

    // Every one of these is the same brand — and must be one row and
    // one fetch, not four.
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
      'source',
      'status',
    ]);
  });
});

describe('domainIconJobOptions', () => {
  it('keys the job on the domain so concurrent misses collapse', () => {
    // 200 uncached senders on one grid render must produce ONE job.
    expect(domainIconJobOptions('brand.example').jobId).toBe('DomainIconWorker-v2-brand.example');
    expect(domainIconJobOptions('other.example').jobId).toBe('DomainIconWorker-v2-other.example');
  });

  it('carries the resolver generation so a fix is not masked by old jobs', () => {
    // `Queue.add` is a no-op while a job with the same id exists in any
    // state, and completions are retained 24h — so without a version
    // segment, correcting the resolver leaves every recently-resolved
    // domain un-enqueueable and the fix invisible. See the constant.
    expect(domainIconJobOptions('brand.example').jobId).toContain(
      `-${DOMAIN_ICON_RESOLVER_VERSION}-`,
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
    expect(isStale({ status: 'ok', fetchedAt: daysAgo(89) }, now)).toBe(false);
    expect(isStale({ status: 'ok', fetchedAt: daysAgo(91) }, now)).toBe(true);
  });

  it('retries a miss after 30 days', () => {
    expect(isStale({ status: 'none', fetchedAt: daysAgo(29) }, now)).toBe(false);
    expect(isStale({ status: 'none', fetchedAt: daysAgo(31) }, now)).toBe(true);
  });
});
