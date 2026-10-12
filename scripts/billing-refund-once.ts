/**
 * Refuse a second refund for the same customer email.
 *
 * Looks at a revoked Pass grant or a subscription with
 * cancel_source='refund'. Does not call Paddle. --override is the
 * support escape hatch.
 *
 *   DATABASE_URL=... pnpm tsx scripts/billing-refund-once.ts --email you@example.com
 *   DATABASE_URL=... pnpm tsx scripts/billing-refund-once.ts --email you@example.com --override
 */
import postgres from 'postgres';

import { refundOnceVerdict } from '../packages/shared/src/entitlements/refund-once.js';

const args = process.argv.slice(2);
const emailFlag = args.indexOf('--email');
const email = emailFlag === -1 ? undefined : args[emailFlag + 1];
const override = args.includes('--override');
if (!email) {
  console.error('Usage: billing-refund-once.ts --email <address> [--override]');
  process.exit(2);
}
const dsn = process.env.DATABASE_URL ?? process.env.SUPABASE_SESSION_DSN;
if (!dsn) {
  console.error('UNVERIFIED: DATABASE_URL is unset');
  process.exit(1);
}

const sql = postgres(dsn, { max: 1, idle_timeout: 5, connect_timeout: 10 });
try {
  const [pass] = await sql<{ found: boolean }[]>`
    SELECT true AS found
    FROM entitlement_grants
    WHERE email = ${email} AND source = 'pass' AND revoked_at IS NOT NULL
    LIMIT 1
  `;
  const [sub] = await sql<{ found: boolean }[]>`
    SELECT true AS found
    FROM subscriptions s
    JOIN users u ON u.workspace_id = s.workspace_id
    WHERE u.email = ${email} AND s.cancel_source = 'refund'
    LIMIT 1
  `;
  const verdict = refundOnceVerdict({
    priorPassRefund: Boolean(pass?.found),
    priorSubscriptionRefund: Boolean(sub?.found),
    override,
  });
  console.log(verdict.message);
  process.exit(verdict.allow ? 0 : 1);
} finally {
  await sql.end({ timeout: 5 });
}
