import { Controller, Get, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { of } from 'rxjs';
import { describe, expect, it, beforeEach, afterEach, vi, type Mock } from 'vitest';

import { InMemoryTokenBucketStore } from './in-memory-token-bucket.store.js';
import { RateLimit } from './rate-limit.decorator.js';
import { RateLimitInterceptor } from './rate-limit.interceptor.js';
import { BUCKET_DEFAULTS, type TokenBucketStore } from './rate-limit.types.js';

/**
 * Integration tests for the rate-limit interceptor (D156).
 *
 * Built with a tiny in-test controller. The in-memory store mirrors the
 * Lua algorithm, so an "exhaust → 429 → wait → 200" sequence here is
 * exactly what the deployed Redis path will do.
 *
 * Note on supertest: not installed in this workspace. We exercise the
 * interceptor through Nest's `ExecutionContext` directly — same code
 * path, no transport dependency, and we can read the throwing path
 * without spinning a real HTTP server.
 */

@Controller('test')
class TestController {
  @Get('limited')
  @RateLimit({ bucket: 'auth', limit: 2, windowSec: 60 })
  limited(): { ok: true } {
    return { ok: true };
  }

  @Get('unlimited')
  unlimited(): { ok: true } {
    return { ok: true };
  }
}

/**
 * Mock ExecutionContext + response/request — minimal surface the
 * interceptor reads. No bodies, no headers beyond ip — matches the D7
 * privacy claim (the interceptor doesn't touch them, so we don't
 * provide them).
 */
function makeContext(opts: {
  handler: (...args: unknown[]) => unknown;
  controller: new () => unknown;
  ip?: string;
  userId?: string;
  userAgent?: string;
  setHeader: (name: string, value: string) => void;
}): ExecutionContext {
  const req = {
    ip: opts.ip ?? '203.0.113.1',
    user: opts.userId ? { userId: opts.userId } : undefined,
    headers: opts.userAgent ? { 'user-agent': opts.userAgent } : {},
  };
  const res = { setHeader: opts.setHeader } as unknown as Response;
  return {
    getHandler: () => opts.handler,
    getClass: () => opts.controller,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

function makeHandler(): CallHandler {
  return { handle: () => of({ ok: true }) };
}

describe('RateLimitInterceptor (D156)', () => {
  let store: InMemoryTokenBucketStore;
  let interceptor: RateLimitInterceptor;
  let setHeader: Mock<(name: string, value: string) => void>;

  beforeEach(() => {
    store = new InMemoryTokenBucketStore();
    interceptor = new RateLimitInterceptor(new Reflector(), store);
    setHeader = vi.fn<(name: string, value: string) => void>();
  });

  afterEach(() => {
    store.reset();
  });

  it('passes through unannotated routes (opt-in by design)', async () => {
    const controller = new TestController();
    const ctx = makeContext({
      handler: controller.unlimited,
      controller: TestController,
      setHeader,
    });
    const result = await interceptor.intercept(ctx, makeHandler());
    // Should not throw, should not set Retry-After.
    await new Promise<void>((resolve) => result.subscribe(() => resolve()));
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('allows requests up to limit, then returns 429 with Retry-After', async () => {
    const controller = new TestController();
    const ctx = (): ExecutionContext =>
      makeContext({
        handler: controller.limited,
        controller: TestController,
        setHeader,
        ip: '203.0.113.1',
      });

    // Limit=2: two consumes succeed.
    for (let i = 0; i < 2; i++) {
      const obs = await interceptor.intercept(ctx(), makeHandler());
      await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
    }

    // Third must throw 429 — AllExceptionsFilter maps this to the D168
    // envelope `{ error: { code: 'RATE_LIMITED', message } }`.
    await expect(interceptor.intercept(ctx(), makeHandler())).rejects.toMatchObject({
      status: 429,
    });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    const [, retryAfter] = setHeader.mock.calls[0]!;
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
  });

  it('exhaust → wait → succeed (token bucket refills)', async () => {
    const controller = new TestController();
    // Patch Date.now so we can advance time deterministically.
    const realNow = Date.now;
    let clock = 1_000_000;
    Date.now = (): number => clock;

    try {
      const ctx = (): ExecutionContext =>
        makeContext({
          handler: controller.limited,
          controller: TestController,
          setHeader,
        });

      for (let i = 0; i < 2; i++) {
        const obs = await interceptor.intercept(ctx(), makeHandler());
        await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
      }
      await expect(interceptor.intercept(ctx(), makeHandler())).rejects.toMatchObject({
        status: 429,
      });

      // Advance the clock past one full refill: limit=2/60s → 1 token in 30s.
      clock += 31_000;
      const obs = await interceptor.intercept(ctx(), makeHandler());
      await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
      // No new Retry-After should have been emitted on this success.
      expect(setHeader).toHaveBeenCalledTimes(1);
    } finally {
      Date.now = realNow;
    }
  });

  it('isolates buckets per user/ip (one caller does not lock out another)', async () => {
    const controller = new TestController();
    const ctxA = (): ExecutionContext =>
      makeContext({
        handler: controller.limited,
        controller: TestController,
        setHeader,
        ip: '10.0.0.1',
      });
    const ctxB = (): ExecutionContext =>
      makeContext({
        handler: controller.limited,
        controller: TestController,
        setHeader,
        ip: '10.0.0.2',
      });

    // Exhaust A.
    for (let i = 0; i < 2; i++) {
      const obs = await interceptor.intercept(ctxA(), makeHandler());
      await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
    }
    await expect(interceptor.intercept(ctxA(), makeHandler())).rejects.toMatchObject({
      status: 429,
    });

    // B still has its full bucket.
    const obs = await interceptor.intercept(ctxB(), makeHandler());
    await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
  });

  it('prefers user id over ip when both present', async () => {
    const controller = new TestController();
    // Same IP, different user IDs → different buckets.
    const ctxUserA = makeContext({
      handler: controller.limited,
      controller: TestController,
      setHeader,
      ip: '10.0.0.1',
      userId: 'user_a',
    });
    const ctxUserB = makeContext({
      handler: controller.limited,
      controller: TestController,
      setHeader,
      ip: '10.0.0.1',
      userId: 'user_b',
    });

    for (let i = 0; i < 2; i++) {
      const obs = await interceptor.intercept(ctxUserA, makeHandler());
      await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
    }
    await expect(interceptor.intercept(ctxUserA, makeHandler())).rejects.toMatchObject({
      status: 429,
    });

    // user_b — same IP — should NOT be limited.
    const obs = await interceptor.intercept(ctxUserB, makeHandler());
    await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
  });

  it('fails open when the store throws (Redis blip must not crash)', async () => {
    const failingStore: TokenBucketStore = {
      consume: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    const failOpenInterceptor = new RateLimitInterceptor(new Reflector(), failingStore);
    const controller = new TestController();
    const ctx = makeContext({
      handler: controller.limited,
      controller: TestController,
      setHeader,
    });

    // Should NOT throw — should pass through.
    const obs = await failOpenInterceptor.intercept(ctx, makeHandler());
    await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('records a security event on breach (D181), metadata only — auth bucket emits severity=critical', async () => {
    // The `auth` bucket maps to `critical` per BUCKET_BREACH_SEVERITY:
    // a brute-force login signal must surface above scraper noise at
    // operator-read time.
    const record = vi.fn().mockResolvedValue(undefined);
    const withAudit = new RateLimitInterceptor(new Reflector(), store, {
      record,
    } as unknown as ConstructorParameters<typeof RateLimitInterceptor>[2]);
    const controller = new TestController();
    const ctx = (): ExecutionContext =>
      makeContext({
        handler: controller.limited,
        controller: TestController,
        setHeader,
        ip: '203.0.113.9',
        userId: 'user_x',
        userAgent: 'curl/8.0',
      });

    // Exhaust the limit (2), then the 3rd breaches.
    for (let i = 0; i < 2; i++) {
      const obs = await withAudit.intercept(ctx(), makeHandler());
      await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
    }
    expect(record).not.toHaveBeenCalled();

    await expect(withAudit.intercept(ctx(), makeHandler())).rejects.toMatchObject({ status: 429 });

    expect(record).toHaveBeenCalledWith({
      eventType: 'rate_limit.breach',
      severity: 'critical',
      userId: 'user_x',
      sourceIp: '203.0.113.9',
      userAgent: 'curl/8.0',
      payload: { bucket: 'auth' },
    });
  });

  it('emits per-bucket severity per BUCKET_BREACH_SEVERITY (D181)', async () => {
    // Drive each bucket through one breach + assert the recorded
    // severity matches the per-bucket map. A controller per bucket so
    // the @RateLimit metadata is read off the right handler.
    @Controller('test-buckets')
    class BucketController {
      @Get('a')
      @RateLimit({ bucket: 'gmail-action', limit: 1, windowSec: 60 })
      a(): { ok: true } {
        return { ok: true };
      }
      @Get('b')
      @RateLimit({ bucket: 'triage-load', limit: 1, windowSec: 60 })
      b(): { ok: true } {
        return { ok: true };
      }
      @Get('c')
      @RateLimit({ bucket: 'default', limit: 1, windowSec: 60 })
      c(): { ok: true } {
        return { ok: true };
      }
    }
    const c = new BucketController();
    const cases: Array<{
      bucket: 'gmail-action' | 'triage-load' | 'default';
      severity: 'warning' | 'info';
      handler: () => { ok: true };
    }> = [
      { bucket: 'gmail-action', severity: 'warning', handler: c.a },
      { bucket: 'triage-load', severity: 'info', handler: c.b },
      { bucket: 'default', severity: 'warning', handler: c.c },
    ];

    for (const tc of cases) {
      const freshStore = new InMemoryTokenBucketStore();
      const record = vi.fn().mockResolvedValue(undefined);
      const interceptor = new RateLimitInterceptor(new Reflector(), freshStore, {
        record,
      } as unknown as ConstructorParameters<typeof RateLimitInterceptor>[2]);
      const ctx = (): ExecutionContext =>
        makeContext({
          handler: tc.handler,
          controller: BucketController,
          setHeader,
          ip: `203.0.113.${tc.bucket.length}`,
        });

      // limit=1 — first request succeeds, second breaches.
      const obs = await interceptor.intercept(ctx(), makeHandler());
      await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
      await expect(interceptor.intercept(ctx(), makeHandler())).rejects.toMatchObject({
        status: 429,
      });
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'rate_limit.breach',
          severity: tc.severity,
          payload: { bucket: tc.bucket },
        }),
      );
    }
  });

  it('fails open when no store is provided (REDIS_URL missing in dev)', async () => {
    const noStoreInterceptor = new RateLimitInterceptor(new Reflector(), null);
    const controller = new TestController();
    const ctx = makeContext({
      handler: controller.limited,
      controller: TestController,
      setHeader,
    });

    const obs = await noStoreInterceptor.intercept(ctx, makeHandler());
    await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
    expect(setHeader).not.toHaveBeenCalled();
  });

  // ---- Key scoping (D156 fix 2026-06-11): default-config routes share
  // the bucket pool; per-route overrides get their own counter. One
  // counter checked against two different capacities is not a budget —
  // observed live when the limit-120 actions-preview route drained the
  // same `triage-load:user:<id>` tokens the default reads were checked
  // against, starving sender-detail loads into 429s.

  it('shares one pool across default-config routes on the same bucket', async () => {
    @Controller('pool')
    class PoolController {
      @Get('a')
      @RateLimit('auth')
      a(): { ok: true } {
        return { ok: true };
      }
      @Get('b')
      @RateLimit('auth')
      b(): { ok: true } {
        return { ok: true };
      }
    }
    const c = new PoolController();
    const ctxFor = (handler: () => { ok: true }): ExecutionContext =>
      makeContext({ handler, controller: PoolController, setHeader, userId: 'user_pool' });

    // auth default = 5/min. Drain 3 via route a + 2 via route b — the
    // pool is shared, so the 6th request 429s on EITHER route.
    for (let i = 0; i < 3; i++) {
      const obs = await interceptor.intercept(ctxFor(c.a), makeHandler());
      await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
    }
    for (let i = 0; i < 2; i++) {
      const obs = await interceptor.intercept(ctxFor(c.b), makeHandler());
      await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
    }
    await expect(interceptor.intercept(ctxFor(c.a), makeHandler())).rejects.toMatchObject({
      status: 429,
    });
    await expect(interceptor.intercept(ctxFor(c.b), makeHandler())).rejects.toMatchObject({
      status: 429,
    });
  });

  it('gives overridden routes a route-scoped counter — they neither drain nor are starved by the bucket pool', async () => {
    @Controller('mixed')
    class MixedController {
      @Get('plain')
      @RateLimit('auth')
      plain(): { ok: true } {
        return { ok: true };
      }
      @Get('boosted')
      @RateLimit({ bucket: 'auth', limit: 2, windowSec: 60 })
      boosted(): { ok: true } {
        return { ok: true };
      }
    }
    const c = new MixedController();
    const ctxFor = (handler: () => { ok: true }): ExecutionContext =>
      makeContext({ handler, controller: MixedController, setHeader, userId: 'user_mixed' });

    // Drain the overridden route to ITS capacity (2)…
    for (let i = 0; i < 2; i++) {
      const obs = await interceptor.intercept(ctxFor(c.boosted), makeHandler());
      await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
    }
    await expect(interceptor.intercept(ctxFor(c.boosted), makeHandler())).rejects.toMatchObject({
      status: 429,
    });

    // …and the shared pool is untouched: the default route still has its
    // full 5 (auth default), then 429s on the 6th.
    for (let i = 0; i < 5; i++) {
      const obs = await interceptor.intercept(ctxFor(c.plain), makeHandler());
      await new Promise<void>((resolve) => obs.subscribe(() => resolve()));
    }
    await expect(interceptor.intercept(ctxFor(c.plain), makeHandler())).rejects.toMatchObject({
      status: 429,
    });

    // And the drained pool does not leak back into the route-scoped
    // counter for a DIFFERENT user dimension check: same user, the
    // boosted route is still keyed apart (already 429 from its own 2).
    await expect(interceptor.intercept(ctxFor(c.boosted), makeHandler())).rejects.toMatchObject({
      status: 429,
    });
  });

  it('triage-load default is 120/min — it fronts Postgres reads, not Gmail quota', () => {
    // One sender-detail page load fans out to ~6 triage-load reads; the
    // old 30/min default 429'd a real user after ~5 page views.
    expect(BUCKET_DEFAULTS['triage-load']).toEqual({ limit: 120, windowSec: 60 });
  });
});
