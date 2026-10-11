/**
 * Sandbox-only Backlog Pass rehearsal for the Oct 22 go/no-go.
 *
 * Does not call the live Paddle API. Prints the checks Billing/Ops run
 * against sandbox: purchase, grant, accelerated expiry, refund revoke.
 *
 *   PADDLE_ENV=sandbox pnpm tsx scripts/billing-pass-sandbox-rehearsal.ts
 *
 * The unattended proof is `.github/workflows/billing-pass-sandbox-rehearsal.yml`.
 */
const env = process.env.PADDLE_ENV;
if (env !== 'sandbox') {
  console.error('Refusing to run: set PADDLE_ENV=sandbox. This script never targets live.');
  process.exit(1);
}

console.log(`Backlog Pass sandbox rehearsal
1. Confirm BILLING_PASS_ENABLED is on only in the sandbox API, and the Pass price id is a sandbox pri_ (not FILL_ME).
2. Buy the Pass once in the Paddle sandbox overlay. Expect entitlement_grants.source='pass' and workspaces.tier='plus'.
3. Buy it again with a new transaction. Expect a second pass row whose expires_at is 30 days after the first row's expires_at.
4. Set the first row's expires_at to now() to accelerate expiry, then run the billing reconciliation sweep. The second row still grants Plus. Set both to the past and confirm the tier returns to the paid subscription, or to free when there is none.
5. Refund the latest transaction in the Paddle sandbox dashboard (full, approved). Expect that row's revoked_at to be set and the tier recomputed.
6. Run: pnpm tsx scripts/billing-refund-once.ts --email <sandbox customer>. A second refund must exit 1. --override exits 0 and does not call Paddle.
7. Go/no-go is a human call. This script does not flip PRICING_V2, METER_V2, or BILLING_PASS_ENABLED.`);
