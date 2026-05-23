import { Controller, Get, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { of } from 'rxjs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { InMemoryTokenBucketStore } from './in-memory-token-bucket.store.js';
import { RateLimit } from './rate-limit.decorator.js';
import { RateLimitInterceptor } from './rate-limit.interceptor.js';
import { type TokenBucketStore } from './rate-limit.types.js';

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
  setHeader: (name: string, value: string) => void;
}): ExecutionContext {
  const req = { ip: opts.ip ?? '203.0.113.1', user: opts.userId ? { id: opts.userId } : undefined };
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
  let setHeader: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new InMemoryTokenBucketStore();
    interceptor = new RateLimitInterceptor(new Reflector(), store);
    setHeader = vi.fn();
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
});
