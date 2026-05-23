import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimitModule } from './rate-limit.module.js';

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
