/** Bounded read-only adapter validation; run explicitly, never from API bootstrap. */
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { createApiDatabase, type ApiDatabaseConnection } from './api-database.js';

function rows(result: unknown): Array<Record<string, unknown>> {
  return Array.isArray(result) ? result : (result as { rows: Array<Record<string, unknown>> }).rows;
}
function errorCode(error: unknown): string {
  const e = error as { code?: string; cause?: { code?: string } };
  const value = e.code ?? e.cause?.code;
  const allowed = [
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  ];
  return value &&
    (/^(?:[0-9A-Z]{5}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE)$/.test(value) ||
      allowed.includes(value))
    ? value
    : 'unknown';
}

export async function probeApiDatabase(env: NodeJS.ProcessEnv = process.env) {
  const connections: ApiDatabaseConnection[] = [];
  const records: Array<{
    driver: string;
    parameterized: boolean;
    pair: number;
    durationMs: number;
  }> = [];
  const rollbackChecks: Array<{ driver: string; expectedError: boolean; recovered: boolean }> = [];
  let stage = 'initialize';
  let tls: { encrypted: boolean; authorized: boolean } | undefined;
  try {
    for (const driver of ['postgres-js', 'node-postgres'] as const) {
      stage = `${driver}.configure`;
      const connection = createApiDatabase({ ...env, API_DB_DRIVER: driver, API_DB_POOL_MAX: '1' });
      connections.push(connection);
      stage = `${driver}.connect`;
      if (driver === 'node-postgres') {
        // Physical TLS state is a driver-specific diagnostic. Save only booleans.
        const pool = (connection.db as unknown as { $client: Pool }).$client;
        const client = await pool.connect();
        try {
          const stream = (
            client as unknown as {
              connection: { stream: { encrypted?: boolean; authorized?: boolean } };
            }
          ).connection.stream;
          tls = { encrypted: stream.encrypted === true, authorized: stream.authorized === true };
          if (env.NODE_ENV === 'production' && (!tls.encrypted || !tls.authorized))
            throw new Error('candidate TLS verification failed');
        } finally {
          client.release();
        }
      }
      await connection.db.execute(sql`SELECT 7::int AS value`);
      await connection.db.execute(sql`SELECT ${7}::int AS value`);
      stage = `${driver}.rollback`;
      let expectedError = false;
      try {
        await connection.db.transaction(async (tx) => {
          await tx.execute(sql`SET TRANSACTION READ ONLY`);
          await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
          if (rows(await tx.execute(sql`SELECT ${7}::int AS value`))[0]?.value !== 7)
            throw new Error('constant mismatch');
          await tx.execute(sql`SELECT 1/0`);
        });
      } catch (error) {
        expectedError = errorCode(error) === '22012';
      }
      const recovered =
        rows(await connection.db.execute(sql`SELECT ${7}::int AS value`))[0]?.value === 7;
      rollbackChecks.push({ driver, expectedError, recovered });
      if (!expectedError || !recovered) throw new Error('rollback contract failed');
    }
    stage = 'measure';
    for (let pair = 0; pair < 10; pair++) {
      const ordered = pair % 2 ? [...connections].reverse() : connections;
      for (const connection of ordered) {
        for (const parameterized of pair % 2 ? [true, false] : [false, true]) {
          const started = performance.now();
          const result = await connection.db.execute(
            parameterized ? sql`SELECT ${7}::int AS value` : sql`SELECT 7::int AS value`,
          );
          const durationMs = performance.now() - started;
          if (rows(result)[0]?.value !== 7) throw new Error('constant mismatch');
          records.push({ driver: connection.driver, parameterized, pair, durationMs });
        }
      }
    }
    const groups = connections.flatMap((connection) =>
      [false, true].map((parameterized) => {
        const times = records
          .filter((r) => r.driver === connection.driver && r.parameterized === parameterized)
          .map((r) => r.durationMs)
          .sort((a, b) => a - b);
        return {
          driver: connection.driver,
          parameterized,
          n: times.length,
          medianMs: (times[4]! + times[5]!) / 2,
          maxMs: times.at(-1),
        };
      }),
    );
    return {
      kind: 'database.driver_probe',
      status: 'passed',
      tls,
      rollbackChecks,
      groups,
      records,
      limits:
        'Constant SELECTs and read-only transactions only; max one connection per driver. Not account, HTTP, page-load, or load-capacity verification.',
    };
  } catch (error) {
    return {
      kind: 'database.driver_probe',
      status: 'failed',
      stage,
      code: errorCode(error),
      tls,
      rollbackChecks,
      records,
    };
  } finally {
    await Promise.all(connections.map((connection) => connection.close()));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await probeApiDatabase();
  console.log(JSON.stringify(result));
  if (result.status !== 'passed') process.exitCode = 1;
}
