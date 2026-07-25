import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
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

  it('treats an unconfigured Redis as ok — local dev has none, prod refuses to boot without it', async () => {
    const { r, captured } = res();
    await new ReadinessController(okDb, null).getReadiness(r as never);
    expect(captured.code).toBe(200);
    expect(captured.body).toEqual({
      status: 'ok',
      checks: { database: 'ok', redis: 'not_configured' },
    });
  });

  it('a HUNG dependency reads as down rather than hanging the probe', async () => {
    const hung = { ping: () => new Promise(() => {}) } as unknown as Redis;
    const { r, captured } = res();
    await new ReadinessController(okDb, hung).getReadiness(r as never);
    expect(captured.code).toBe(503);
  }, 10_000);
});
