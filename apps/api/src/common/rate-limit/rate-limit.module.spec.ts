import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimitInterceptor } from './rate-limit.interceptor.js';
import { RateLimitModule } from './rate-limit.module.js';
import { SecurityEventsService } from '../../security-events/security-events.service.js';
import { DRIZZLE } from '../../db/db.module.js';

/**
 * Production startup guard (D156).
 *
 * The module factory must REFUSE to boot when running in production
 * with rate limiting enabled but no REDIS_URL — per-process in-memory
 * fail-open is a security gap on multi-instance Cloud Run.
 *
 * Dev / test posture is unchanged: missing REDIS_URL warns and the
 * interceptor fails open. RATE_LIMIT_ENABLED=false is the explicit
 * acknowledged-gap escape hatch for prod incidents.
 *
 * We test by compiling the module — Nest invokes the factory eagerly,
 * which is exactly the boot path we want to gate.
 */
describe('RateLimitModule — REDIS_URL startup guard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clone so per-test mutations don't leak.
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('throws at boot when NODE_ENV=production and REDIS_URL is unset', async () => {
    process.env.NODE_ENV = 'production';

    await expect(
      Test.createTestingModule({ imports: [RateLimitModule] }).compile(),
    ).rejects.toThrow(/REDIS_URL is required in production/);
  });

  it('boots without REDIS_URL when RATE_LIMIT_ENABLED=false in production (explicit opt-out)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const mod = await Test.createTestingModule({ imports: [RateLimitModule] }).compile();
    expect(mod).toBeDefined();
    await mod.close();
  });

  it('boots without REDIS_URL in non-production (fail-open warn path)', async () => {
    process.env.NODE_ENV = 'development';

    const mod = await Test.createTestingModule({ imports: [RateLimitModule] }).compile();
    expect(mod).toBeDefined();
    await mod.close();
  });
});

/**
 * D181 DI-wiring regression — guards a smoke-only bug observed on main
 * 2026-05-29: a union type (`SecurityEventsService | null`) collapsed
 * Nest's `design:paramtypes` reflect metadata to `Object`, so the
 * `@Optional()` parameter resolved to `null` even though the
 * `SecurityEventsModule` was registered globally and the service was
 * available. The 429 path's emit silently no-op'd in production —
 * never showed up in tests because the interceptor tests construct
 * the class directly and pass a mock recorder explicitly.
 *
 * This test compiles the real Nest container with both modules
 * registered, resolves the APP_INTERCEPTOR provider, and asserts the
 * interceptor instance received a NON-NULL `SecurityEventsService`.
 * Forces the fix (`@Inject(SecurityEventsService)` decorator) to
 * stay in place across future refactors.
 */
describe('RateLimitInterceptor — D181 SecurityEvents DI wiring', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // SecurityEventsModule transitively imports AuthModule (via forwardRef
    // — needed for the admin read surface's JwtGuard), which pulls in
    // SyncModule, which boot-checks REDIS_URL. We're testing DI shape,
    // not Redis behavior, so a stub URL is sufficient — no real ioredis
    // client is constructed for this test because we don't exercise the
    // store.
    process.env.REDIS_URL = 'redis://stub:6379';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('resolves SecurityEventsService into the interceptor via @Inject decorator (not the @Optional null fallback)', async () => {
    // Standalone test of the EXACT injection shape: a small module
    // that provides only SecurityEventsService + the interceptor.
    // Avoids dragging in the whole AppModule (and its DB / Redis /
    // Gmail constraints) while still exercising the real Nest
    // container's DI resolution.
    const { Module } = await import('@nestjs/common');
    @Module({
      providers: [SecurityEventsService, { provide: DRIZZLE, useValue: {} }, RateLimitInterceptor],
    })
    class TestModule {}

    const mod = await Test.createTestingModule({ imports: [TestModule] }).compile();

    const interceptor = mod.get(RateLimitInterceptor);
    expect(interceptor).toBeInstanceOf(RateLimitInterceptor);
    // The fix: `securityEvents` is a real instance, NOT the null
    // default. If reflect-metadata regresses to `Object` again, this
    // private read returns `null` and the test fails.
    const recorded = (interceptor as unknown as { securityEvents: SecurityEventsService | null })
      .securityEvents;
    expect(recorded).not.toBeNull();
    expect(recorded).toBeInstanceOf(SecurityEventsService);

    await mod.close();
  });
});
