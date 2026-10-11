#!/usr/bin/env tsx
/**
 * Launch funnel aggregates. Local databases only. Never prints emails.
 *
 *   pnpm exec tsx scripts/launch-funnel-report.ts
 *   LAUNCH_FUNNEL_EXTRA_USER_IDS=<uuid>,<uuid> pnpm exec tsx scripts/launch-funnel-report.ts
 */
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import postgres from 'postgres';

import { assertLocalFunnelDsn, extraUserIdsFromEnv, funnelSql } from './launch-funnel-sql.ts';

async function main(): Promise<void> {
  const dsn =
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/declutrmail';
  assertLocalFunnelDsn(dsn);
  const allowance = TIER_MANIFEST.free.cleanupActionsPerMonth;
  if (allowance === null) throw new Error('launch-funnel-report: free allowance is unlimited');
  const sql = funnelSql(allowance, extraUserIdsFromEnv(process.env.LAUNCH_FUNNEL_EXTRA_USER_IDS));
  const db = postgres(dsn, { max: 1 });
  try {
    const rows = await db.unsafe(sql);
    if (rows.length !== 1) throw new Error('launch-funnel-report: expected one aggregate row');
    const row = rows[0] as Record<string, unknown>;
    if ('email' in row) throw new Error('launch-funnel-report: row included email');
    process.stdout.write(`# Launch funnel\n\n`);
    for (const [key, value] of Object.entries(row)) {
      process.stdout.write(`- ${key}: ${value === null ? 'null' : String(value)}\n`);
    }
  } finally {
    await db.end();
  }
}

const invoked = process.argv[1]?.includes('launch-funnel-report');
if (invoked) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : 'launch-funnel-report failed'}\n`);
    process.exitCode = 1;
  });
}
