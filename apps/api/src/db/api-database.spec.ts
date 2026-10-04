import { Test } from '@nestjs/testing';
import { Client, type Pool } from 'pg';
import type { ConnectionOptions } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiDbDriver, createApiDatabase, nodePostgresPoolOptions } from './api-database.js';
import { DbModule, DRIZZLE } from './db.module.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe('API adapter selection and ownership', () => {
  it('keeps postgres-js unless the alternative is explicitly selected', () => {
    for (const value of [undefined, '', ' ', 'postgres-js']) {
      expect(apiDbDriver({ API_DB_DRIVER: value })).toBe('postgres-js');
    }
    expect(apiDbDriver({ API_DB_DRIVER: 'node-postgres' })).toBe('node-postgres');
    expect(() => apiDbDriver({ API_DB_DRIVER: 'credential-mistaken-for-option' })).toThrow(
      'API_DB_DRIVER must be postgres-js or node-postgres',
    );
  });
  it('bounds the alternative pool and rejects DSNs that could enable pipelining', () => {
    const env = { DATABASE_URL: 'postgres://synthetic:local@localhost/db', API_DB_POOL_MAX: '3' };
    expect(nodePostgresPoolOptions(env)).toMatchObject({
      max: 3,
      pipeline: false,
      idleTimeoutMillis: 0,
      connectionTimeoutMillis: 30_000,
    });
    for (const url of [
      'not-a-url-with-a-secret',
      'https://localhost/db',
      `${env.DATABASE_URL}?pipeline=true`,
      `${env.DATABASE_URL}?pipeline=false`,
    ]) {
      expect(() => nodePostgresPoolOptions({ DATABASE_URL: url })).toThrow(
        'DATABASE_URL must be a PostgreSQL URL without a pipeline option',
      );
    }
    expect(() => createApiDatabase({})).toThrow('DATABASE_URL is not set');
  });
  it('requires TLS in production without libpq compatibility disabling verification', () => {
    for (const suffix of [
      '?sslmode=disable',
      '?ssl=0',
      '?ssl=no-verify',
      '?sslmode=require&uselibpqcompat=true',
      '?sslmode=verify-full&sslmode=disable',
      '?sslmode=require&sslmode=no-verify',
      '?sslmode=verify-full&sslmode=verify-full',
    ]) {
      expect(() =>
        nodePostgresPoolOptions({
          NODE_ENV: 'production',
          DATABASE_URL: `postgres://synthetic:local@localhost/db${suffix}`,
        }),
      ).toThrow('production node-postgres requires verified TLS');
    }
    for (const suffix of ['', '?sslmode=require&ssl=no-verify', '?sslmode=verify-full']) {
      const options = nodePostgresPoolOptions({
        NODE_ENV: 'production',
        DATABASE_URL: `postgres://synthetic:local@localhost/db${suffix}`,
      });
      const ssl = new Client(options).ssl as boolean | ConnectionOptions;
      expect(ssl).toBeTruthy();
      expect(typeof ssl === 'object' && ssl.rejectUnauthorized === false).toBe(false);
      expect(new URL(options.connectionString).searchParams.getAll('sslmode')).toEqual([
        'verify-full',
      ]);
    }
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
    expect(() =>
      nodePostgresPoolOptions({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://synthetic:local@localhost/db?sslmode=verify-full',
      }),
    ).toThrow('production node-postgres requires verified TLS');
  });
  it.each(['postgres-js', 'node-postgres'] as const)(
    'injects %s and closes its owned pool once',
    async (driver) => {
      const connection = createApiDatabase({
        DATABASE_URL: 'postgres://synthetic:local@127.0.0.1:1/db',
        API_DB_DRIVER: driver,
      });
      const closing = connection.close();
      expect(connection.close()).toBe(closing);
      await closing;
    },
  );
  it('loads the pinned public CA only for production Supabase connections, with hostname verification', () => {
    const certificatePath = fileURLToPath(
      new URL('../../certificates/supabase-root-2021.crt', import.meta.url),
    );
    const certificate = readFileSync(certificatePath, 'utf8');
    const x509 = new X509Certificate(certificate);
    expect(x509.ca).toBe(true);
    expect(x509.fingerprint256.replaceAll(':', '').toLowerCase()).toBe(
      '807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa',
    );
    expect(Date.parse(x509.validTo)).toBeGreaterThan(Date.now());
    for (const host of ['aws-0-us-west-1.pooler.supabase.com', 'db.syntheticproject.supabase.co']) {
      const base = `postgres://synthetic:local@${host}/db`;
      const options = nodePostgresPoolOptions({ NODE_ENV: 'production', DATABASE_URL: base });
      expect(new URL(options.connectionString).searchParams.get('sslrootcert')).toBe(
        certificatePath,
      );
      const ssl = new Client(options).ssl as unknown as ConnectionOptions;
      expect(ssl.ca?.toString()).toBe(certificate);
      expect(ssl.rejectUnauthorized).not.toBe(false);
      expect(ssl.checkServerIdentity).toBeUndefined();
      expect(new URL(options.connectionString).searchParams.get('sslmode')).toBe('verify-full');
      expect(
        nodePostgresPoolOptions({ NODE_ENV: 'test', DATABASE_URL: base }).connectionString,
      ).toBe(base);
    }
    for (const host of [
      'localhost',
      'example.test',
      'db.syntheticproject.supabase.co.attacker.test',
      'pooler.supabase.com.attacker.test',
    ]) {
      const options = nodePostgresPoolOptions({
        NODE_ENV: 'production',
        DATABASE_URL: `postgres://synthetic:local@${host}/db`,
      });
      expect(new URL(options.connectionString).searchParams.has('sslrootcert')).toBe(false);
    }
  });
  it('preserves an explicit root certificate and fails closed when it cannot be read', () => {
    const certificatePath = fileURLToPath(
      new URL('../../certificates/supabase-root-2021.crt', import.meta.url),
    );
    const base = 'postgres://synthetic:local@db.syntheticproject.supabase.co/db';
    const url = new URL(base);
    url.searchParams.set('sslrootcert', certificatePath);
    const options = nodePostgresPoolOptions({ NODE_ENV: 'production', DATABASE_URL: url.href });
    expect(new URL(options.connectionString).searchParams.get('sslrootcert')).toBe(certificatePath);
    url.searchParams.set('sslrootcert', '/missing-synthetic-certificate.crt');
    expect(() =>
      nodePostgresPoolOptions({ NODE_ENV: 'production', DATABASE_URL: url.href }),
    ).toThrow('production node-postgres requires verified TLS');
  });
  it('scopes the CA to pg’s effective host, including last-wins DSN overrides', () => {
    const supabase = 'aws-0-us-west-1.pooler.supabase.com';
    for (const [authority, query, expectedCA] of [
      [supabase, '?host=example.test', false],
      ['example.test', `?host=${supabase}`, true],
      ['example.test', `?host=${supabase}&host=example.test`, false],
      ['example.test', `?host=example.test&host=${supabase}`, true],
    ] as const) {
      const options = nodePostgresPoolOptions({
        NODE_ENV: 'production',
        DATABASE_URL: `postgres://synthetic:local@${authority}/db${query}`,
      });
      expect(new URL(options.connectionString).searchParams.has('sslrootcert')).toBe(expectedCA);
      const ssl = new Client(options).ssl as unknown as ConnectionOptions;
      expect(ssl.rejectUnauthorized).not.toBe(false);
      expect(ssl.checkServerIdentity).toBeUndefined();
    }
  });
  it('wires the selected database through Nest and runs its shutdown lifecycle', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://synthetic:local@127.0.0.1:1/db');
    vi.stubEnv('API_DB_DRIVER', 'node-postgres');
    const module = await Test.createTestingModule({ imports: [DbModule] }).compile();
    expect(module.get(DRIZZLE)).toBeDefined();
    await module.close();
  });
  it('handles idle connection errors without logging SQL or credentials', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const connection = createApiDatabase({
      DATABASE_URL: 'postgres://synthetic:local@127.0.0.1:1/db',
      API_DB_DRIVER: 'node-postgres',
    });
    try {
      const pool = (connection.db as unknown as { $client: Pool }).$client;
      pool.emit(
        'error',
        Object.assign(new Error('secret DSN and SQL must not be logged'), { code: 'ECONNRESET' }),
      );
      pool.emit('error', Object.assign(new Error('another secret'), { code: 'secret-value' }));
      expect(log.mock.calls.map(([value]) => JSON.parse(value as string))).toEqual([
        {
          level: 'error',
          kind: 'database.pool_error',
          driver: 'node-postgres',
          code: 'ECONNRESET',
        },
        { level: 'error', kind: 'database.pool_error', driver: 'node-postgres', code: 'unknown' },
      ]);
    } finally {
      await connection.close();
    }
  });
});
