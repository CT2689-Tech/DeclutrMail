#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

/** A single dedicated connection; no workload queries or contention generation. */
export async function probeDbLatency(client, samples = 20) {
  if (!Number.isInteger(samples) || samples < 1 || samples > 100)
    throw new Error('samples must be 1–100');
  const start = performance.now();
  const connection = await client.reserve();
  const connectAndCheckoutMs = performance.now() - start;
  const timings = [];
  try {
    for (let i = 0; i < samples; i++) {
      const started = performance.now();
      const rows = await connection`EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1`;
      const roundTripMs = performance.now() - started;
      const plan = rows[0]?.['QUERY PLAN']?.[0];
      const planningMs = plan?.['Planning Time'];
      const executionMs = plan?.['Execution Time'];
      if (
        ![planningMs, executionMs].every(
          (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
        )
      ) {
        throw new Error('Database did not return execution timings');
      }
      timings.push({
        roundTripMs,
        planningMs,
        executionMs,
        outsideServerMs: Math.max(0, roundTripMs - planningMs - executionMs),
      });
    }
  } finally {
    connection.release();
  }
  const distribution = (field) => {
    const sorted = timings.map((row) => row[field]).sort((a, b) => a - b);
    return {
      p50Ms: sorted[Math.ceil(samples * 0.5) - 1],
      p95Ms: sorted[Math.ceil(samples * 0.95) - 1],
    };
  };
  return {
    samples,
    connectAndCheckoutMs,
    roundTrip: distribution('roundTripMs'),
    serverPlanning: distribution('planningMs'),
    serverExecution: distribution('executionMs'),
    outsideServer: distribution('outsideServerMs'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let client;
  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    client = postgres(process.env.DATABASE_URL, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      connection: {
        application_name: 'declutrmail-latency-probe',
        statement_timeout: 5000,
        default_transaction_read_only: 'on',
      },
      onnotice: () => {},
    });
    console.log(JSON.stringify(await probeDbLatency(client), null, 2));
  } catch {
    console.error(
      'UNVERIFIED: database latency probe failed; check credentials, connectivity and read-only query permissions.',
    );
    process.exitCode = 1;
  } finally {
    if (client) await client.end({ timeout: 5 });
  }
}
