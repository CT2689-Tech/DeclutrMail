import { CanActivate, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IconsController } from './icons.controller.js';
import { IconsService, type IconLookup } from './icons.service.js';
import { OptionalJwtGuard } from './optional-jwt.guard.js';

/**
 * IconsController HTTP tests (ADR-0034).
 *
 * Driven over REAL HTTP against a listening Nest app rather than
 * through a mocked ExecutionContext, because everything worth
 * asserting here IS the transport: status codes carry the entire
 * contract (this route is exempt from the ADR-0008 JSON envelope — an
 * `<img>` cannot parse one), and the ETag/304 handshake only exists at
 * that layer.
 *
 * The guard is stubbed. `passGuard` stands in for a valid session and
 * populates `req.user`; `anonGuard` stands in for none. The difference
 * is load-bearing: since the founder's 2026-08-16 decision the route
 * READS anonymously — an image subresource cannot refresh an expired
 * token, so requiring one meant no logo ever rendered — but only a
 * session may cause an outbound resolution.
 */

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"/>');
const ETAG = `"${'a'.repeat(64)}"`;

/** A valid session: populates `req.user` exactly as the real guard does. */
const passGuard: CanActivate = {
  canActivate: (ctx: ExecutionContext) => {
    ctx.switchToHttp().getRequest().user = {
      userId: 'user-1',
      workspaceId: 'ws-1',
      sessionId: 'sess-1',
      jti: 'jti-1',
    };
    return true;
  },
};

/** No session — admitted, but must not be able to grow the cache. */
const anonGuard: CanActivate = { canActivate: () => true };

async function appFor(
  lookup: IconLookup,
  seen: string[] = [],
  guard: CanActivate = passGuard,
  seenOpts: Array<{ mayEnqueue: boolean }> = [],
) {
  const moduleRef = await Test.createTestingModule({
    controllers: [IconsController],
    providers: [
      {
        provide: IconsService,
        useValue: {
          lookup: async (domain: string, opts: { mayEnqueue: boolean }) => {
            seen.push(domain);
            seenOpts.push(opts);
            return lookup;
          },
        },
      },
    ],
  })
    .overrideGuard(OptionalJwtGuard)
    .useValue(guard)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  return app;
}

describe('IconsController', () => {
  let app: Awaited<ReturnType<typeof appFor>> | undefined;

  beforeEach(() => {
    app = undefined;
  });

  afterEach(async () => {
    await app?.close();
  });

  it('serves the mark as SVG with a strong ETag', async () => {
    app = await appFor({ kind: 'hit', image: SVG, mime: 'image/svg+xml', etag: ETAG });

    const res = await fetch(`${await app.getUrl()}/icons/chase.com`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('etag')).toBe(ETAG);
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(Buffer.from(await res.arrayBuffer()).equals(SVG)).toBe(true);
  });

  it('serves a normalized official-site mark as PNG', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    app = await appFor({ kind: 'hit', image: png, mime: 'image/png', etag: ETAG });

    const res = await fetch(`${await app.getUrl()}/icons/bankofamerica.com`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);
  });

  it('answers 204 — not an error — when there is no mark', async () => {
    app = await appFor({ kind: 'miss' });

    const res = await fetch(`${await app.getUrl()}/icons/nobody.example`);

    // 204 means "render the monogram". An error status would make every
    // logo-less sender look like a fault in the console.
    expect(res.status).toBe(204);
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect((await res.text()).length).toBe(0);
  });

  it('answers 304 when the caller already holds the mark', async () => {
    app = await appFor({ kind: 'hit', image: SVG, mime: 'image/svg+xml', etag: ETAG });

    const res = await fetch(`${await app.getUrl()}/icons/chase.com`, {
      headers: { 'If-None-Match': ETAG },
    });

    expect(res.status).toBe(304);
  });

  it('sends the bytes when the caller holds a DIFFERENT etag', async () => {
    app = await appFor({ kind: 'hit', image: SVG, mime: 'image/svg+xml', etag: ETAG });

    const res = await fetch(`${await app.getUrl()}/icons/chase.com`, {
      headers: { 'If-None-Match': '"stale"' },
    });

    expect(res.status).toBe(200);
  });

  it('lets the browser cache but never a shared proxy', async () => {
    app = await appFor({ kind: 'hit', image: SVG, mime: 'image/svg+xml', etag: ETAG });

    const res = await fetch(`${await app.getUrl()}/icons/chase.com`);

    // `private` because the route is authenticated; revalidating daily
    // rather than `immutable` so a rebrand lands within a day.
    expect(res.headers.get('cache-control')).toContain('private');
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
  });

  it('caches a MISS briefly — it is provisional, not an answer', async () => {
    app = await appFor({ kind: 'miss' });

    const res = await fetch(`${await app.getUrl()}/icons/nobody.example`);

    // The 204 means "not resolved YET": the lookup only enqueued the
    // work, which lands seconds later. Sending the hit's day-long
    // lifetime with it committed the browser to "this sender has no
    // logo" for a day — and since EVERY domain starts as a miss, one
    // page view made the whole feature look dead no matter what the
    // worker resolved afterwards (incident 2026-08-16).
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
    // No stale-while-revalidate either: that is what fired the
    // initiator-less background revalidations which show up as
    // `(failed) net::ERR_ABORTED` and read like a broken endpoint.
    expect(res.headers.get('cache-control')).not.toContain('stale-while-revalidate');
  });

  it('restarts the freshness window on a 304', async () => {
    app = await appFor({ kind: 'hit', image: SVG, mime: 'image/svg+xml', etag: ETAG });

    const res = await fetch(`${await app.getUrl()}/icons/chase.com`, {
      headers: { 'If-None-Match': ETAG },
    });

    // Without this the entry stays stale forever and every later view
    // pays for a revalidation it already made.
    expect(res.status).toBe(304);
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
  });

  it('serves the SVG under a locked-down CSP with sniffing off', async () => {
    app = await appFor({ kind: 'hit', image: SVG, mime: 'image/svg+xml', etag: ETAG });

    const res = await fetch(`${await app.getUrl()}/icons/chase.com`);

    // Defence in depth: the bytes were validated against SVG Tiny PS
    // at resolution time and `<img>` does not execute script, but this
    // covers someone opening the URL directly.
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('passes the raw path segment through to the service', async () => {
    const seen: string[] = [];
    app = await appFor({ kind: 'miss' }, seen);

    await fetch(`${await app.getUrl()}/icons/${encodeURIComponent('mail1.brand.example')}`);

    // Normalization is the service's job (one brand root ⇒ one cache
    // key); the controller must not pre-chew it into something else.
    expect(seen).toEqual(['mail1.brand.example']);
  });

  it('answers a REJECTED request with a status and no body', async () => {
    const denyGuard: CanActivate = {
      canActivate: () => {
        throw new UnauthorizedException('Missing session.');
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [IconsController],
      providers: [{ provide: IconsService, useValue: { lookup: async () => ({ kind: 'miss' }) } }],
    })
      .overrideGuard(OptionalJwtGuard)
      .useValue(denyGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');

    const res = await fetch(`${await app.getUrl()}/icons/chase.com`);

    // The status must be READABLE. A JSON error body here is dropped by
    // Chromium's ORB before the status reaches the page — the caller is
    // a cross-origin no-cors image and we send nosniff — so DevTools
    // showed `(failed) net::ERR_BLOCKED_BY_ORB` with no status at all,
    // for three rounds of debugging (incident 2026-08-16).
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type') ?? '').not.toContain('application/json');
    expect((await res.text()).length).toBe(0);
  });

  it('answers an unexpected FAILURE with a status and no body', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IconsController],
      providers: [
        {
          provide: IconsService,
          useValue: {
            lookup: async () => {
              throw new Error('db down');
            },
          },
        },
      ],
    })
      .overrideGuard(OptionalJwtGuard)
      .useValue(passGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');

    const res = await fetch(`${await app.getUrl()}/icons/chase.com`);

    // Same rule for a 500: an image cannot read an envelope, and a body
    // it cannot read is worse than none — it hides the status.
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type') ?? '').not.toContain('application/json');
    expect((await res.text()).length).toBe(0);
  });

  it('serves a cached mark to an ANONYMOUS caller', async () => {
    app = await appFor(
      { kind: 'hit', image: SVG, mime: 'image/svg+xml', etag: ETAG },
      [],
      anonGuard,
    );

    const res = await fetch(`${await app.getUrl()}/icons/chase.com`);

    // The whole point of the 2026-08-16 decision: an image subresource
    // cannot rotate an expired 15-minute token the way the web client
    // does, so requiring a session meant every icon 401'd and no logo
    // ever rendered.
    expect(res.status).toBe(200);
  });

  it('lets a SESSION cause outbound work, and an anonymous caller never', async () => {
    const authed: Array<{ mayEnqueue: boolean }> = [];
    app = await appFor({ kind: 'miss' }, [], passGuard, authed);
    await fetch(`${await app.getUrl()}/icons/nobody.example`);
    await app.close();

    const anon: Array<{ mayEnqueue: boolean }> = [];
    app = await appFor({ kind: 'miss' }, [], anonGuard, anon);
    await fetch(`${await app.getUrl()}/icons/nobody.example`);

    // This is the half of the old guard that still matters and is still
    // enforced: a miss ENQUEUES an outbound resolution, and a stranger
    // must not be able to drive our DNS and HTTPS fetches at domains of
    // their choosing or fill our cache table doing it. Reading the
    // cache is free; growing it needs a session.
    expect(authed).toEqual([{ mayEnqueue: true }]);
    expect(anon).toEqual([{ mayEnqueue: false }]);
  });

  it('admits an anonymous caller instead of refusing', async () => {
    // Structural: the route must carry the OPTIONAL guard. Swapping the
    // strict `JwtGuard` back in is the exact regression that made every
    // logo invisible in production, and it would not fail any other
    // test here (they all stub the guard).
    const guards = Reflect.getMetadata('__guards__', IconsController) as unknown[] | undefined;
    expect(guards).toContain(OptionalJwtGuard);
  });
});
