import { drizzle as postgresJsDrizzle } from 'drizzle-orm/postgres-js';
import { drizzle as nodePostgresDrizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { schema } from '@declutrmail/db';
import { Client, Pool } from 'pg';
import type { ConnectionOptions } from 'node:tls';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

import { apiPoolOptions } from './pool-config.js';

/** Common ORM contract; worker composition and its session pools keep postgres-js. */
export type DrizzleDb = PgDatabase<PgQueryResultHKT, typeof schema>;
export type ApiDbDriver = 'postgres-js' | 'node-postgres';
export interface ApiDatabaseConnection {
  readonly db: DrizzleDb;
  readonly driver: ApiDbDriver;
  close(): Promise<void>;
}

export function apiDbDriver(env: NodeJS.ProcessEnv = process.env): ApiDbDriver {
  const value = env.API_DB_DRIVER?.trim();
  if (!value || value === 'postgres-js') return 'postgres-js';
  if (value === 'node-postgres') return value;
  throw new Error('API_DB_DRIVER must be postgres-js or node-postgres');
}

export function nodePostgresPoolOptions(env: NodeJS.ProcessEnv = process.env) {
  let url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — see .env.example.');
  // A connection-string option can override a pg Client option. Do not let
  // a DSN turn on pipelining: the shared transaction pooler cannot support it.
  try {
    const parsed = new URL(url);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      parsed.searchParams.has('pipeline')
    ) {
      throw new Error();
    }
    if (env.NODE_ENV === 'production') {
      const modes = parsed.searchParams.getAll('sslmode');
      if (
        modes.length > 1 ||
        (modes.length === 1 && !['require', 'verify-full'].includes(modes[0]!)) ||
        (modes.length === 0 && parsed.searchParams.has('ssl')) ||
        parsed.searchParams.has('uselibpqcompat') ||
        env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
        process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
      )
        throw new Error();
      // Enforce verified TLS when the shared DSN omits a mode; do not change
      // that secret or the worker's connection settings. Pin require to its
      // current verified semantics across pg parser upgrades.
      // Duplicate options are last-wins in pg, unlike URLSearchParams.get().
      parsed.searchParams.set('sslmode', 'verify-full');
      // pg reads sslrootcert from the DSN; a separate ssl object would be
      // overwritten by sslmode. Scope this CA to Supabase, not global TLS.
      // Query-string host overrides win in pg (including the last duplicate).
      // Use the driver's effective host rather than the URL authority.
      const host = new Client({ connectionString: parsed.href }).host.toLowerCase();
      if (
        !parsed.searchParams.has('sslrootcert') &&
        (host.endsWith('.pooler.supabase.com') || /^db\.[a-z0-9]+\.supabase\.co$/.test(host))
      ) {
        parsed.searchParams.set(
          'sslrootcert',
          fileURLToPath(new URL('../../certificates/supabase-root-2021.crt', import.meta.url)),
        );
      }
      url = parsed.href;
      const ssl = new Client({ connectionString: url }).ssl as boolean | ConnectionOptions;
      if (
        !ssl ||
        (typeof ssl === 'object' && (ssl.rejectUnauthorized === false || ssl.checkServerIdentity))
      )
        throw new Error();
    }
  } catch {
    throw new Error(
      'DATABASE_URL must be a PostgreSQL URL without a pipeline option; production node-postgres requires verified TLS',
    );
  }
  return {
    connectionString: url,
    ...apiPoolOptions(env),
    pipeline: false,
    // postgres-js retains idle connections by default. Avoid pg's ten-second
    // idle expiry reintroducing connection setup on the next screen visit.
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 30_000,
    maxLifetimeSeconds: 30 * 60,
  };
}

/** Explicit opt-in adapter, with one pool owner and idempotent shutdown. */
export function createApiDatabase(env: NodeJS.ProcessEnv = process.env): ApiDatabaseConnection {
  const driver = apiDbDriver(env);
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — see .env.example.');
  let close: () => Promise<void>;
  let db: DrizzleDb;
  if (driver === 'node-postgres') {
    const pool = new Pool(nodePostgresPoolOptions(env));
    // Idle socket errors are emitted rather than rejecting a request. pg
    // removes that connection; a listener prevents a process-level crash.
    // Never log the message, connection, SQL, DSN or bound values.
    pool.on('error', (error: Error & { code?: string }) => {
      const code = error.code;
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'database.pool_error',
          driver,
          code:
            code && /^(?:[0-9A-Z]{5}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE)$/.test(code)
              ? code
              : 'unknown',
        }),
      );
    });
    // No query names or .prepare(name): Drizzle executes unnamed statements.
    // SSL settings come from the DSN; certificate verification is not weakened.
    db = nodePostgresDrizzle(pool, { schema });
    close = () => pool.end();
  } else {
    // Required by ADR-0022 for Supabase transaction pooling.
    const client = postgres(url, { prepare: false, ...apiPoolOptions(env) });
    db = postgresJsDrizzle(client, { schema });
    close = () => client.end({ timeout: 5 });
  }
  let closing: Promise<void> | undefined;
  return { db, driver, close: () => (closing ??= close()) };
}
