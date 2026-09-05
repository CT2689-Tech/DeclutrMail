/** Render verified invoice history without inventing historical Monitoring samples. */
import { readFileSync } from 'node:fs';

export function invoiceHistoryWidget(ledger) {
  if (ledger.version !== 1 || !Number.isFinite(Date.parse(ledger.verifiedAt)))
    throw new Error('Invalid invoice ledger version or verification time');
  const seen = new Set();
  const vendorScopes = new Map();
  const rows = ledger.entries
    .map((e) => {
      if (!/^[A-Za-z0-9 .()-]{1,60}$/.test(e.vendor) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(e.month))
        throw new Error('Invalid invoice vendor or month');
      if (e.currency !== 'USD' || !['statement', 'invoice'].includes(e.kind))
        throw new Error('Unsupported invoice currency or document kind');
      if (!['billing account', 'project', 'organization'].includes(e.scope))
        throw new Error('Invoice scope is required');
      if (typeof e.amount !== 'number' || !Number.isFinite(e.amount) || e.amount < 0)
        throw new Error('Invalid invoice amount');
      if (
        e.paidOn != null &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(e.paidOn) || !Number.isFinite(Date.parse(e.paidOn)))
      )
        throw new Error('Invalid payment date');
      const source = new URL(e.sourceUrl);
      if (source.protocol !== 'https:' || source.username || source.password)
        throw new Error('Invalid invoice source');
      if (e.basis != null && !['payment month', 'statement month'].includes(e.basis))
        throw new Error('Invalid invoice month basis');
      const columnScope = `${e.scope}:${e.basis ?? 'statement month'}`;
      if (vendorScopes.has(e.vendor) && vendorScopes.get(e.vendor) !== columnScope)
        throw new Error('Mixed scope or month basis in invoice vendor column');
      vendorScopes.set(e.vendor, columnScope);
      const key = `${e.vendor}:${e.month}`;
      if (seen.has(key))
        throw new Error('Duplicate invoice month; consolidate source documents first');
      seen.add(key);
      return e;
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.vendor.localeCompare(b.vendor));
  const max = Math.max(1, ...rows.map((e) => e.amount));
  const vendors = [...new Set(rows.map((e) => e.vendor))];
  const months = [...new Set(rows.map((e) => e.month))];
  const table = months
    .map(
      (month) =>
        `| ${month} | ${vendors
          .map((vendor) => {
            const e = rows.find((r) => r.vendor === vendor && r.month === month);
            if (!e) return 'Unknown';
            const bar =
              '▰'.repeat(Math.max(e.amount > 0 ? 1 : 0, Math.round((e.amount / max) * 8))) || '—';
            return `${bar} [$${e.amount.toFixed(2)}](${e.sourceUrl})`;
          })
          .join(' | ')} |`,
    )
    .join('\n');
  const evidence = vendors
    .map((vendor) => {
      const entries = rows.filter((r) => r.vendor === vendor);
      return `**${vendor}** (${entries[0].scope}; ${entries[0].basis ?? 'statement month'}): ${entries.map((e) => `${e.month}: ${e.paidOn ? 'Paid ' + e.paidOn : 'Payment unverified'}`).join('; ')}.`;
    })
    .join('\n\n');
  return {
    title: 'Historical invoices and statements — verified USD charges',
    text: {
      format: 'MARKDOWN',
      content: `Verified ${ledger.verifiedAt}. USD document totals; bars share one scale. Columns use the stated month basis below. Account totals may include other projects. Missing readings are unknown. History is independent of the dashboard time selector.\n\n| Month | ${vendors.map((vendor) => `${vendor} (${rows.find((e) => e.vendor === vendor).basis ?? 'statement month'})`).join(' | ')} |\n|---|${vendors.map(() => '---|').join('')}\n${table}\n\n${evidence}`,
    },
  };
}
export function loadInvoiceHistory(path) {
  return invoiceHistoryWidget(JSON.parse(readFileSync(path, 'utf8')));
}
