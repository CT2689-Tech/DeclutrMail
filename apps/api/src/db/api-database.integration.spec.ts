import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { createApiDatabase, readApiPoolDiagnostics, type ApiDbDriver } from './api-database.js';
import { DRIZZLE } from './db.module.js';
import { ReadinessController } from '../health/readiness.controller.js';
import { READINESS_REDIS } from '../health/readiness-redis.provider.js';
import { AllExceptionsFilter } from '../common/all-exceptions.filter.js';

const fixtureUrl = process.env.API_DRIVER_TEST_PG_URL;
function fixtureDatabaseUrl(value: string): URL {
  const url = new URL(value);
  // pg permits query parameters to override host/database. Fixture DDL must
  // never accept any such overrides, even on an otherwise loopback URL.
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^\/declutrmail_.*_test$/.test(url.pathname) ||
    url.search !== ''
  )
    throw new Error(
      'API_DRIVER_TEST_PG_URL must point to a loopback declutrmail_*_test database without query options',
    );
  return url;
}
describe('native fixture isolation', () => {
  it('rejects endpoint and database query overrides before any DDL', () => {
    const base = 'postgres://synthetic:local@localhost/declutrmail_driver_test';
    expect(fixtureDatabaseUrl(base).hostname).toBe('localhost');
    for (const value of [
      `${base}?host=remote.example.test`,
      `${base}?database=production`,
      'postgres://synthetic:local@remote.example.test/declutrmail_driver_test',
      'postgres://synthetic:local@localhost/production',
    ]) {
      expect(() => fixtureDatabaseUrl(value)).toThrow('loopback');
    }
  });
});
function rows(result: unknown): Array<Record<string, unknown>> {
  return Array.isArray(result) ? result : (result as { rows: Array<Record<string, unknown>> }).rows;
}
function code(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
}

describe.skipIf(!fixtureUrl)('API adapters on real PostgreSQL', () => {
  let admin: Pool;
  let databaseUrl: string;
  const database = `dm_api_driver_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    const url = fixtureDatabaseUrl(fixtureUrl!);
    admin = new Pool({ connectionString: url.href, max: 1 });
    await admin.query(`CREATE DATABASE "${database}"`);
    url.pathname = `/${database}`;
    databaseUrl = url.href;
  });
  afterAll(async () => {
    if (admin) {
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  });
  it('exposes starvation in the real HTTP readiness failure, then drains and recovers', async () => {
    const connection = createApiDatabase({
      DATABASE_URL: databaseUrl,
      API_DB_DRIVER: 'node-postgres',
      API_DB_POOL_MAX: '1',
    });
    const module = await Test.createTestingModule({
      controllers: [ReadinessController],
      providers: [
        { provide: DRIZZLE, useValue: connection.db },
        { provide: READINESS_REDIS, useValue: { ping: async () => 'PONG' } },
      ],
    }).compile();
    const app = module.createNestApplication();
    app.useGlobalFilters(
      new AllExceptionsFilter().withPoolDiagnostics(() => readApiPoolDiagnostics(connection.db)),
    );
    app.setGlobalPrefix('api');
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = connection.db.transaction(async (tx) => {
      await tx.execute(sql`select 1`);
      acquired();
      await gate;
    });
    try {
      await app.listen(0, '127.0.0.1');
      await Promise.race([held, transaction]);
      const origin = await app.getUrl();
      const failed = await fetch(`${origin}/api/readyz`);
      expect(failed.status).toBe(503);
      expect(await failed.json()).toEqual({
        status: 'degraded',
        checks: { database: 'down', redis: 'ok' },
      });
      expect(log).toHaveBeenCalledTimes(1);
      const record = JSON.parse(log.mock.calls[0]![0]);
      expect(record).toMatchObject({
        kind: 'readiness.dependency_failed',
        dependency: 'database',
        reason: 'timeout',
        databasePool: { driver: 'node-postgres', total: 1, idle: 0, waiting: 1, checkedOut: 1 },
      });
      expect(record.databasePool.oldestCheckoutMs).toBeGreaterThanOrEqual(1900);
      release();
      await transaction;
      const healthy = await fetch(`${origin}/api/readyz`);
      expect(healthy.status).toBe(200);
      expect(await healthy.json()).toEqual({
        status: 'ok',
        checks: { database: 'ok', redis: 'ok' },
      });
      expect(readApiPoolDiagnostics(connection.db)).toMatchObject({
        total: 1,
        idle: 1,
        waiting: 0,
        checkedOut: 0,
        oldestCheckoutMs: 0,
      });
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      release();
      try {
        await transaction;
      } finally {
        await app.close();
        await connection.close();
        log.mockRestore();
      }
    }
  });
  for (const driver of ['postgres-js', 'node-postgres'] as const satisfies readonly ApiDbDriver[]) {
    it(`${driver} preserves parameterized types, rollback, savepoint and post-error recovery`, async () => {
      const connection = createApiDatabase({
        DATABASE_URL: databaseUrl,
        API_DB_DRIVER: driver,
        API_DB_POOL_MAX: '2',
      });
      try {
        const db = connection.db;
        const value = await db.execute(sql`SELECT ${7}::int AS n, ${'2026-10-01'}::date AS day,
          ${'9007199254740993'}::bigint AS large, ${JSON.stringify({ synthetic: true })}::jsonb AS data,
          ${'comma,value'}::text AS escaped, ${null}::text AS absent`);
        expect(rows(value)).toEqual([
          {
            n: 7,
            day: '2026-10-01',
            large: '9007199254740993',
            data: { synthetic: true },
            escaped: 'comma,value',
            absent: null,
          },
        ]);
        await db.execute(
          sql`CREATE TABLE IF NOT EXISTS driver_counter(driver text PRIMARY KEY, n integer NOT NULL)`,
        );
        await db.execute(sql`INSERT INTO driver_counter VALUES (${driver},0)`);
        await db.transaction(async (tx) => {
          await tx.execute(sql`UPDATE driver_counter SET n=n+1 WHERE driver=${driver}`);
          await expect(
            tx.transaction(async (nested) => {
              await nested.execute(sql`UPDATE driver_counter SET n=n+100 WHERE driver=${driver}`);
              throw new Error('synthetic rollback');
            }),
          ).rejects.toThrow('synthetic rollback');
        });
        let observedCode: string | undefined;
        try {
          await db.transaction(async (tx) => {
            await tx.execute(sql`UPDATE driver_counter SET n=n+1000 WHERE driver=${driver}`);
            await tx.execute(sql`SELECT 1/0`);
          });
        } catch (error) {
          observedCode = code(error);
        }
        expect(observedCode).toBe('22012');
        expect(
          rows(await db.execute(sql`SELECT n FROM driver_counter WHERE driver=${driver}`)),
        ).toEqual([{ n: 1 }]);
      } finally {
        await connection.close();
      }
    });
    it(`${driver} serializes row locks across two concurrent transactions`, async () => {
      const connection = createApiDatabase({
        DATABASE_URL: databaseUrl,
        API_DB_DRIVER: driver,
        API_DB_POOL_MAX: '2',
      });
      let release!: () => void;
      try {
        const db = connection.db;
        await db.execute(
          sql`CREATE TABLE IF NOT EXISTS driver_counter(driver text PRIMARY KEY, n integer NOT NULL)`,
        );
        await db.execute(
          sql`INSERT INTO driver_counter VALUES (${driver},0) ON CONFLICT(driver) DO NOTHING`,
        );
        await db.execute(sql`UPDATE driver_counter SET n=0 WHERE driver=${driver}`);
        let notify!: () => void;
        const acquired = new Promise<void>((resolve) => {
          notify = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const first = db.transaction(async (tx) => {
          await tx.execute(sql`SELECT n FROM driver_counter WHERE driver=${driver} FOR UPDATE`);
          notify();
          await gate;
          await tx.execute(sql`UPDATE driver_counter SET n=n+1 WHERE driver=${driver}`);
        });
        await acquired;
        let secondEntered = false;
        const second = db.transaction(async (tx) => {
          await tx.execute(sql`SELECT n FROM driver_counter WHERE driver=${driver} FOR UPDATE`);
          secondEntered = true;
          await tx.execute(sql`UPDATE driver_counter SET n=n+1 WHERE driver=${driver}`);
        });
        await new Promise((resolve) => setTimeout(resolve, 30));
        try {
          expect(secondEntered).toBe(false);
        } finally {
          release();
        }
        await Promise.all([first, second]);
        expect(
          rows(await db.execute(sql`SELECT n FROM driver_counter WHERE driver=${driver}`)),
        ).toEqual([{ n: 2 }]);
      } finally {
        release?.();
        await connection.close();
      }
    });
  }
  it('recovers after a terminated idle candidate connection', async () => {
    const connection = createApiDatabase({
      DATABASE_URL: databaseUrl,
      API_DB_DRIVER: 'node-postgres',
      API_DB_POOL_MAX: '1',
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const pool = (connection.db as unknown as { $client: Pool }).$client;
      const client = await pool.connect();
      const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      client.release();
      // Only this test's held backend in its private loopback database.
      await admin.query('SELECT pg_terminate_backend($1)', [pid]);
      await vi.waitFor(() => expect(log).toHaveBeenCalled(), { timeout: 2000 });
      expect(rows(await connection.db.execute(sql`SELECT ${7}::int AS n`))).toEqual([{ n: 7 }]);
    } finally {
      log.mockRestore();
      await connection.close();
    }
  });
});
