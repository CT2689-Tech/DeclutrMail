#!/usr/bin/env tsx
/**
 * Launch funnel aggregates. Local databases only. Never prints emails.
 *
 *   pnpm exec tsx scripts/launch-funnel-report.ts
 *   LAUNCH_FUNNEL_EXTRA_USER_IDS=<uuid>,<uuid> pnpm exec tsx scripts/launch-funnel-report.ts
 * Optional ISO timestamps with timezone: LAUNCH_FUNNEL_COHORT_START,
 * LAUNCH_FUNNEL_COHORT_END, LAUNCH_FUNNEL_OBSERVED_AT. Defaults cover all
 * retained signups from the Unix epoch through the invocation time.
 */
import postgres from 'postgres';

import {
  assertLocalFunnelDsn,
  extraUserIdsFromEnv,
  funnelSql,
  funnelWindowFromEnv,
} from './launch-funnel-sql.js';

export function formatFunnelReport(row: Record<string, unknown>): string {
  if ('email' in row || JSON.stringify(row).includes('@')) {
    throw new Error('launch-funnel-report: unexpected email data');
  }
  const lines = [
    '# Launch funnel — retained account records',
    '',
    'Accounts outside a provisional internal filter are not verified customers.',
    'Timing requires a positive completed forward job and matching manual activity; preview is unverified.',
    'Rates use only mature cohorts. null means unavailable, including an empty denominator.',
    'Signup anchors the 2h/24h/7d/D7 windows; connection timing starts at the first recorded Gmail connection.',
    'D7 is [signup + 168 hours, signup + 192 hours); days are elapsed hours, independent of timezone/DST.',
    'Completion rates describe recorded manual work; missing activity can undercount. D7 activity is not paid retention.',
    'Archive/Delete email effects are gross completed work, not monthly quota or retained cleanup.',
    'Product events are optional telemetry with incomplete coverage. Purchase events are not paying customers.',
    'Reconcile provider transactions and settled refunds separately; verified external-paying counts remain unknown.',
    'Unattributed purchase events cover the observation range and cannot be assigned to the signup cohort.',
    '',
  ];
  for (const [key, value] of Object.entries(row)) {
    lines.push(
      `- ${key}: ${value instanceof Date ? value.toISOString() : value === null ? 'null' : String(value)}`,
    );
  }
  return lines.join('\n') + '\n';
}

async function main(): Promise<void> {
  const dsn =
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/declutrmail';
  assertLocalFunnelDsn(dsn);
  const sql = funnelSql({
    ...funnelWindowFromEnv(process.env),
    extraUserIds: extraUserIdsFromEnv(process.env.LAUNCH_FUNNEL_EXTRA_USER_IDS),
  });
  const db = postgres(dsn, { max: 1 });
  try {
    const rows = await db.unsafe(sql);
    if (rows.length !== 1) throw new Error('launch-funnel-report: expected one aggregate row');
    const row = rows[0] as Record<string, unknown>;
    process.stdout.write(formatFunnelReport(row));
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
