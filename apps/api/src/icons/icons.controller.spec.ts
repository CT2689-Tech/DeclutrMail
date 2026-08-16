import { CanActivate, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JwtGuard } from '../auth/jwt.guard.js';
import { IconsController } from './icons.controller.js';
import { IconsService, type IconLookup } from './icons.service.js';

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
 * The guard is stubbed to pass. That it is PRESENT is asserted
 * separately below, since the route being authenticated is a
 * deliberate decision (an anonymous caller could otherwise drive our
 * outbound fetches) and not an accident of copying another controller.
 */

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"/>');
const ETAG = `"${'a'.repeat(64)}"`;

const passGuard: CanActivate = { canActivate: () => true };

async function appFor(lookup: IconLookup, seen: string[] = []) {
  const moduleRef = await Test.createTestingModule({
    controllers: [IconsController],
    providers: [
      {
        provide: IconsService,
        useValue: {
          lookup: async (domain: string) => {
            seen.push(domain);
            return lookup;
          },
        },
      },
    ],
  })
    .overrideGuard(JwtGuard)
    .useValue(passGuard)
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
    expect(Buffer.from(await res.arrayBuffer()).equals(SVG)).toBe(true);
  });

  it('answers 204 — not an error — when there is no mark', async () => {
    app = await appFor({ kind: 'miss' });

    const res = await fetch(`${await app.getUrl()}/icons/nobody.example`);

    // 204 means "render the monogram". An error status would make every
    // logo-less sender look like a fault in the console.
    expect(res.status).toBe(204);
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
      .overrideGuard(JwtGuard)
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
      .overrideGuard(JwtGuard)
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

  it('is guarded by JwtGuard', async () => {
    // Asserted structurally: an anonymous caller must not be able to
    // enqueue outbound resolutions, so losing this guard is a security
    // regression rather than a behaviour change a test would catch by
    // accident.
    const guards = Reflect.getMetadata('__guards__', IconsController) as unknown[] | undefined;
    expect(guards).toContain(JwtGuard);
  });
});
