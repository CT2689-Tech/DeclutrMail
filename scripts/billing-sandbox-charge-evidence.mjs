/** Read only a named example.test rehearsal transaction. No financial writes. */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readSandboxEntity } from './paddle-sandbox-inspection.mjs';

const instant = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const id = (v, prefix) => typeof v === 'string' && new RegExp(`^${prefix}_[a-z\\d]{26}$`).test(v);
export async function inspectCharge({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const report = { sandboxOnly: true, readOnly: true, complete: false };
  try {
    const run = env.FIXTURE_RUN_ID;
    const scenario = env.FIXTURE_CASE;
    const txnId = env.FIXTURE_TRANSACTION_ID;
    const subId = env.FIXTURE_SUBSCRIPTION_ID;
    if (
      !/^\d{8,20}$/.test(run ?? '') ||
      !['monthly', 'cycle'].includes(scenario) ||
      !id(txnId, 'txn') ||
      !id(subId, 'sub')
    )
      throw new Error('boundary');
    const t = (await readSandboxEntity('transactions', txnId, env, fetchImpl)).data;
    if (
      t?.id !== txnId ||
      t.subscription_id !== subId ||
      !id(t.customer_id, 'ctm') ||
      t.origin !== 'subscription_update'
    )
      throw new Error('boundary');
    const customer = (await readSandboxEntity('customers', t.customer_id, env, fetchImpl)).data;
    if (
      customer?.id !== t.customer_id ||
      customer.email !== `refund-${run}-${scenario}@example.test`
    )
      throw new Error('boundary');
    // Only after exact fixture ownership is checked may any facts be projected.
    const sub = (await readSandboxEntity('subscriptions', subId, env, fetchImpl)).data;
    if (sub?.id !== subId || sub.customer_id !== customer.id) throw new Error('boundary');
    const period = (p) =>
      p && instant(p.starts_at) && instant(p.ends_at)
        ? { startsAt: p.starts_at, endsAt: p.ends_at }
        : null;
    const proration = (p) =>
      p && typeof p.rate === 'string' && /^\d+(\.\d+)?$/.test(p.rate)
        ? { rate: p.rate, period: period(p.billing_period) }
        : null;
    report.transaction = {
      id: txnId,
      subscriptionId: subId,
      completed: t.status === 'completed',
      createdAt: instant(t.created_at) ? t.created_at : null,
      billingPeriod: period(t.billing_period),
      signedIntentFieldsPresent: [
        'workspace_id',
        'sig',
        'upgrade_intent_id',
        'upgrade_price_id',
        'upgrade_sig',
      ].every((k) => typeof t.custom_data?.[k] === 'string'),
      items: Array.isArray(t.items)
        ? t.items.map((l) => ({
            priceId: id(l.price?.id, 'pri') ? l.price.id : null,
            quantity: Number.isSafeInteger(l.quantity) ? l.quantity : null,
            proration: proration(l.proration),
          }))
        : null,
      lines: Array.isArray(t.details?.line_items)
        ? t.details.line_items.map((l) => ({
            priceId: id(l.price_id, 'pri') ? l.price_id : null,
            quantity: Number.isSafeInteger(l.quantity) ? l.quantity : null,
            totalSign:
              typeof l.totals?.total === 'string' && /^-?\d+$/.test(l.totals.total)
                ? Math.sign(Number(l.totals.total))
                : null,
            proration: proration(l.proration),
          }))
        : null,
    };
    report.subscriptionStopped = sub.status === 'canceled';
    report.complete = true;
  } catch {
    report.error = 'sandbox_fixture_read_unconfirmed';
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Report output path required');
  const report = await inspectCharge();
  writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ complete: report.complete, error: report.error }));
  if (!report.complete) process.exitCode = 1;
}
