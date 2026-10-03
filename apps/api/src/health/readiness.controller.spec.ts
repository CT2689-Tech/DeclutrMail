import { PATH_METADATA } from '@nestjs/common/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';

import { ReadinessController } from './readiness.controller.js';
import type { DrizzleDb } from '../db/db.module.js';

/**
 * `/readyz` exists because `/healthz` structurally cannot report an
 * outage: it is dependency-free on purpose, so it answered 200 for the
 * entire 46-day Upstash suspension while BullMQ could not reach Redis.
 * These assert the one property that makes an uptime check able to fire —
 * a dependency being down produces a NON-200.
 */

function res() {
  const captured: { code: number | null; body: unknown } = { code: null, body: null };
  const r = {
    status(code: number) {
      captured.code = code;
      return r;
    },
    json(body: unknown) {
      captured.body = body;
      return r;
    },
  };
  return { r, captured };
}

const okDb = { execute: vi.fn().mockResolvedValue([{ '?column?': 1 }]) } as unknown as DrizzleDb;
const downDb = {
  execute: vi.fn().mockRejectedValue(new Error('connection refused')),
} as unknown as DrizzleDb;

const okRedis = { ping: vi.fn().mockResolvedValue('PONG') } as unknown as Redis;
const suspendedRedis = {
  ping: vi
    .fn()
    .mockRejectedValue(
      new Error('ERR This database has been suspended for exceeding the defined budget limit.'),
    ),
} as unknown as Redis;

describe('ReadinessController', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['database', 'redis'] as const)(
    'records which dependency timed out: %s',
    async (dependency) => {
      vi.useFakeTimers();
      const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const hung = () => new Promise(() => {});
      const db = dependency === 'database' ? ({ execute: hung } as unknown as DrizzleDb) : okDb;
      const redis = dependency === 'redis' ? ({ ping: hung } as unknown as Redis) : okRedis;
      const { r, captured } = res();
      const response = new ReadinessController(db, redis).getReadiness(r as never);
      await vi.advanceTimersByTimeAsync(2000);
      await response;
      expect(captured.code).toBe(503);
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.parse(log.mock.calls[0]![0])).toEqual({
        level: 'warn',
        kind: 'readiness.dependency_failed',
        dependency,
        reason: 'timeout',
        durationMs: 2000,
      });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('records rejection without exposing provider details in logs', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { r } = res();
    await new ReadinessController(downDb, suspendedRedis).getReadiness(r as never);
    expect(log).toHaveBeenCalledTimes(2);
    const records = log.mock.calls.map(([line]) => JSON.parse(line));
    expect(records.map(({ dependency, reason }) => ({ dependency, reason }))).toEqual([
      { dependency: 'database', reason: 'error' },
      { dependency: 'redis', reason: 'error' },
    ]);
    expect(JSON.stringify(records)).not.toMatch(/budget|suspended|connection refused/i);
  });

  it('clears successful probe timers without logging failures', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { r } = res();
    await new ReadinessController(okDb, okRedis).getReadiness(r as never);
    expect(vi.getTimerCount()).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });
  it('is served at /readyz, distinct from the liveness path', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ReadinessController)).toBe('readyz');
  });

  it('reports 200 when both dependencies answer', async () => {
    const { r, captured } = res();
    await new ReadinessController(okDb, okRedis).getReadiness(r as never);
    expect(captured.code).toBe(200);
    expect(captured.body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('returns 503 when Redis is suspended — the case healthz cannot see', async () => {
    const { r, captured } = res();
    await new ReadinessController(okDb, suspendedRedis).getReadiness(r as never);
    expect(captured.code).toBe(503);
    expect(captured.body).toEqual({
      status: 'degraded',
      checks: { database: 'ok', redis: 'down' },
    });
  });

  it('returns 503 when the database is unreachable', async () => {
    const { r, captured } = res();
    await new ReadinessController(downDb, okRedis).getReadiness(r as never);
    expect(captured.code).toBe(503);
    expect(captured.body).toEqual({
      status: 'degraded',
      checks: { database: 'down', redis: 'ok' },
    });
  });

  it('never echoes the provider error into an UNAUTHENTICATED response', async () => {
    // Upstash's reply names the vendor and the billing state; Postgres
    // errors can carry host detail. Neither belongs in a public body.
    const { r, captured } = res();
    await new ReadinessController(downDb, suspendedRedis).getReadiness(r as never);
    const serialized = JSON.stringify(captured.body);
    expect(serialized).not.toMatch(/upstash|budget|suspended|connection refused/i);
  });

  it('treats an unconfigured Redis as ok OUTSIDE production — local dev has none', async () => {
    const { r, captured } = res();
    await new ReadinessController(okDb, null).getReadiness(r as never);
    expect(captured.code).toBe(200);
    expect(captured.body).toEqual({
      status: 'ok',
      checks: { database: 'ok', redis: 'not_configured' },
    });
  });

  it('a production instance with NO Redis configured is not ready', async () => {
    // The masking case. RateLimitModule's "production refuses to boot
    // without REDIS_URL" guard is conditioned on `rateLimitEnabled`, and
    // the production deploy sets RATE_LIMIT_ENABLED=false — so it never
    // fires, and a Redis-less production boots happily. If this endpoint
    // deferred to that guard it would answer 200 for exactly the
    // misconfiguration it exists to catch.
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { r, captured } = res();
      await new ReadinessController(okDb, null).getReadiness(r as never);
      expect(captured.code).toBe(503);
      expect(captured.body).toEqual({
        status: 'degraded',
        checks: { database: 'ok', redis: 'not_configured' },
      });
    } finally {
      process.env.NODE_ENV = prior;
    }
  });

  it('a HUNG dependency reads as down rather than hanging the probe', async () => {
    const hung = { ping: () => new Promise(() => {}) } as unknown as Redis;
    const { r, captured } = res();
    await new ReadinessController(okDb, hung).getReadiness(r as never);
    expect(captured.code).toBe(503);
  }, 10_000);
});
