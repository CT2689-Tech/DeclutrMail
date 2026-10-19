import { sql } from 'drizzle-orm';
import type { BillingProviderId } from '@declutrmail/shared/contracts';
import type { DrizzleDb } from '../db/db.module.js';
import { currentVerdictSignal, VERDICT_DB_STATEMENT_TIMEOUT_MS } from './provider-signal.js';

/**
 * The one advisory-lock expression used by every Billing subscription writer.
 *
 * A verdict pass sets a transaction-local statement timeout first, so a
 * lock wait cannot outlive the cron slot. Webhook and checkout callers
 * are not inside that scope and keep an unbounded wait.
 */
export async function lockSubscription(
  tx: Pick<DrizzleDb, 'execute'>,
  provider: BillingProviderId,
  id: string,
): Promise<void> {
  if (currentVerdictSignal()) {
    await tx.execute(
      sql`select set_config('statement_timeout', ${String(VERDICT_DB_STATEMENT_TIMEOUT_MS)}, true)`,
    );
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${provider}:${id}`}))`);
}
