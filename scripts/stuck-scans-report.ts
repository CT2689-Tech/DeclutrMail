#!/usr/bin/env tsx
/**
 * Read-only list of failed initial scans. Local databases only.
 *
 *   pnpm exec tsx scripts/stuck-scans-report.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { assertLocalOpsDsn } from './local-dsn.ts';

export function stuckScansSql(): string {
  return readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'sql', 'stuck-scans-report.sql'),
    'utf8',
  );
}

async function main(): Promise<void> {
  const dsn =
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/declutrmail';
  assertLocalOpsDsn(dsn, 'stuck-scans-report');
  const db = postgres(dsn, { max: 1 });
  try {
    const rows = await db.unsafe(stuckScansSql());
    process.stdout.write(`# Stuck initial scans\n\n`);
    if (rows.length === 0) {
      process.stdout.write('No failed initial scans.\n');
      return;
    }
    for (const row of rows) {
      const record = row as Record<string, unknown>;
      if ('email' in record || 'provider_account_id' in record) {
        throw new Error('stuck-scans-report: row included an address');
      }
      process.stdout.write(
        `- ${String(record.mailbox_account_id)} error=${String(record.error_class)} attempts=${String(record.recovery_attempts)} deadline=${String(record.next_deadline)} onboarded=${String(record.owner_onboarded)}\n`,
      );
    }
  } finally {
    await db.end();
  }
}

const invoked = process.argv[1]?.includes('stuck-scans-report');
if (invoked) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : 'stuck-scans-report failed'}\n`);
    process.exitCode = 1;
  });
}
