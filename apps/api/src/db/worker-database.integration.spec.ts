import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { createWorkerDatabase } from './worker-database.js';
import { writeWorkerHeartbeat, workerHeartbeatIsFresh } from '@declutrmail/workers';
import { collectOperationalTelemetry } from '../ops/operational-telemetry.js';

const fixture = process.env.WORKER_DRIVER_TEST_PG_URL ?? process.env.API_DRIVER_TEST_PG_URL;
it.skipIf(!fixture)(
  'runs concurrent worker transactions, heartbeat and all database observations on PostgreSQL',
  async () => {
    const url = new URL(fixture!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !/^\/declutrmail_.*_test$/.test(url.pathname) ||
      url.search
    )
      throw new Error('WORKER_DRIVER_TEST_PG_URL must be an isolated loopback test database');
    const admin = new Client({ connectionString: url.href });
    const database = `dm_worker_${randomUUID().replaceAll('-', '')}`;
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    url.pathname = `/${database}`;
    const connection = createWorkerDatabase({ DATABASE_URL: url.href, WORKER_DB_POOL_MAX: '2' });
    try {
      // The real production driver and PostgreSQL system views are required:
      // PGlite cannot prove either transport behavior or database-pressure reads.
      const migrations = new URL('../../../../packages/db/migrations/', import.meta.url);
      const { readdirSync } = await import('node:fs');
      for (const name of readdirSync(migrations)
        .filter((f) => f.endsWith('.sql'))
        .sort()) {
        const content = readFileSync(new URL(name, migrations), 'utf8');
        for (const statement of content.split('--> statement-breakpoint')) {
          if (statement.trim()) await connection.db.execute(sql.raw(statement));
        }
      }
      await Promise.all(
        Array.from({ length: 80 }, (_, n) =>
          connection.db.transaction(async (tx) => {
            const rows = await tx.execute(sql`SELECT ${n}::int AS n`);
            expect(rows[0]?.n).toBe(n);
            await tx.transaction(async (nested) => {
              await nested.execute(sql`SELECT 1`);
            });
          }),
        ),
      );
      await writeWorkerHeartbeat(connection.db);
      expect(await workerHeartbeatIsFresh(connection.db)).toBe(true);
      const records: Array<Record<string, string | number>> = [];
      await collectOperationalTelemetry(connection.db, [], (row) => records.push(row));
      expect(records.filter((row) => row.kind === 'ops.collection' && row.success === 0)).toEqual(
        [],
      );
      expect(records).toContainEqual(
        expect.objectContaining({ kind: 'ops.database_health', connections: expect.any(Number) }),
      );
      expect(records).toContainEqual(
        expect.objectContaining({
          kind: 'ops.scheduler_health',
          worker: 'WorkerHeartbeat',
          status: 'succeeded',
        }),
      );
    } finally {
      await connection.close();
      await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
      await admin.end();
    }
  },
);
