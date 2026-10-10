import { sql } from 'drizzle-orm';
import type { BillingProviderId } from '@declutrmail/shared/contracts';
import type { DrizzleDb } from '../db/db.module.js';

/** The one advisory-lock expression used by every Billing subscription writer. */
export async function lockSubscription(
  tx: Pick<DrizzleDb, 'execute'>,
  provider: BillingProviderId,
  id: string,
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${provider}:${id}`}))`);
}
