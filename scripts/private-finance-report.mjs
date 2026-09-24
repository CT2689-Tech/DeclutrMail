/** Private finance reporting: source documents, usage and estimates remain distinct. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const validDate = (s) =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  new Date(s).toISOString().slice(0, 10) === s;
const text = (s) => String(s ?? 'Unknown').replace(/[|\r\n]/g, ' ');
export function normalizeLedger(ledger) {
  if (ledger.version !== 1 || !Array.isArray(ledger.entries)) throw new Error('Invalid ledger');
  const entries = new Map();
  for (const e of ledger.entries) {
    if (
      !e.vendor ||
      !e.documentId ||
      !e.scope ||
      !e.scopeId ||
      !/^[A-Z]{3}$/.test(e.currency) ||
      !['invoice', 'statement', 'refund', 'unclassified'].includes(e.kind) ||
      !validDate(e.issuedOn) ||
      !Number.isFinite(e.amount) ||
      e.amount < 0 ||
      (e.paidOn != null && !validDate(e.paidOn))
    )
      throw new Error('Invalid ledger entry');
    const source = new URL(e.sourceUrl);
    if (source.protocol !== 'https:' || source.username || source.password)
      throw new Error('Invalid document source');
    const key = JSON.stringify([e.vendor, e.scope, e.scopeId, e.documentId]);
    const prior = entries.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(e))
      throw new Error('Conflicting duplicate document');
    entries.set(key, e);
  }
  return [...entries.values()].sort((a, b) => a.issuedOn.localeCompare(b.issuedOn));
}
export function financeReport(ledger, registry, snapshot, now = new Date()) {
  const entries = normalizeLedger(ledger);
  if (
    registry.version !== 1 ||
    !Array.isArray(registry.subscriptions) ||
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.vendors)
  )
    throw new Error('Invalid inputs');
  const observed = Date.parse(snapshot.observedAt);
  const age = (now - observed) / 3600000;
  if (!Number.isFinite(age) || age < 0) throw new Error('Invalid observation time');
  const fresh = age <= 30 && snapshot.observedAt.slice(0, 7) === now.toISOString().slice(0, 7);
  const lines = [
    '# DeclutrMail spending',
    '',
    `Generated ${now.toISOString()}. Usage snapshot ${snapshot.observedAt} (${age.toFixed(1)}h old).`,
    '',
    '**Coverage is partial. Paid documents, accrued usage and estimates are separate; no combined total is implied. Currency and account/project scope are never merged. Missing values are unknown.**',
    '',
    '| Vendor | Accrued MTD USD (usage only) | Month-end estimate | Coverage |',
    '|---|---:|---:|---|',
  ];
  for (const v of snapshot.vendors) {
    const available =
      fresh && ['OK', 'WARN', 'BREACH'].includes(v.status) && Number.isFinite(v.costMtdUsd);
    const forecast =
      available && Number.isFinite(v.usage?.projected_month_usd)
        ? v.usage.projected_month_usd
        : null;
    // Fixed plans cannot be extrapolated safely from aggregate MTD. Only show a
    // provider-specific existing forecast, otherwise expose the measurement gap.
    lines.push(
      `| ${text(v.name)} | ${available ? v.costMtdUsd.toFixed(2) : 'Unknown'} | ${forecast == null ? 'Unknown' : forecast.toFixed(2)} | ${available ? 'Measured usage; invoice coverage separate' : 'Unavailable or stale'} |`,
    );
  }
  lines.push(
    '',
    '## Historical documents',
    '',
    '| Vendor | Document date / recorded period | Scope | Currency | Document charges | Payment verified |',
    '|---|---|---|---|---:|---|',
  );
  for (const e of entries)
    lines.push(
      `| ${text(e.vendor)} | ${e.issuedDateBasis ? e.issuedOn.slice(0, 7) + ' (month only)' : e.issuedOn} | ${text(e.scope)}: ${text(e.scopeId)} | ${e.currency} | ${e.kind === 'refund' ? '-' : ''}${e.amount.toFixed(2)} | ${e.paidOn ?? 'Unknown'} |`,
    );
  if (!entries.length) lines.push('| No imported documents | — | — | — | Unknown | Unknown |');
  const paid = new Map();
  for (const e of entries.filter(
    (e) =>
      ['invoice', 'refund'].includes(e.kind) &&
      e.scopeId !== 'legacy-import-unverified-account' &&
      e.paidOn &&
      e.paidOn <= now.toISOString().slice(0, 10),
  )) {
    const key = JSON.stringify([e.vendor, e.scope, e.scopeId, e.currency]);
    paid.set(key, (paid.get(key) ?? 0) + (e.kind === 'refund' ? -e.amount : e.amount));
  }
  lines.push(
    '',
    '## Verified paid history totals (imported coverage only)',
    '',
    '| Vendor | Scope | Currency | Paid net of refunds |',
    '|---|---|---|---:|',
  );
  for (const [key, amount] of paid) {
    const [vendor, scope, scopeId, currency] = JSON.parse(key);
    lines.push(
      `| ${text(vendor)} | ${text(scope)}: ${text(scopeId)} | ${currency} | ${amount.toFixed(2)} |`,
    );
  }
  if (!paid.size) lines.push('| Unknown | — | — | No verified payments imported |');
  lines.push(
    '',
    '## Recurring commitments and next 90 days',
    '',
    '| Vendor | Scope | Amount / currency | Frequency | Next renewal | Status |',
    '|---|---|---|---|---|---|',
  );
  for (const s of registry.subscriptions) {
    if (
      !s.vendor ||
      (s.amount != null && (!Number.isFinite(s.amount) || s.amount < 0)) ||
      (s.currency != null && !/^[A-Z]{3}$/.test(s.currency)) ||
      (s.nextRenewal != null && !validDate(s.nextRenewal))
    )
      throw new Error('Invalid subscription');
    const days =
      s.nextRenewal == null
        ? null
        : (Date.parse(s.nextRenewal) - Date.parse(now.toISOString().slice(0, 10))) / 86400000;
    lines.push(
      `| ${text(s.vendor)} | ${text(s.scope)} | ${s.amount == null || !s.currency ? 'Unknown' : `${s.amount.toFixed(2)} ${s.currency}`} | ${text(s.frequency)} | ${text(s.nextRenewal)} | ${days == null ? 'Needs verification' : days < 0 ? 'Renewal date needs refresh' : days <= 90 ? 'Due within 90 days' : 'Later'} |`,
    );
  }
  lines.push(
    '',
    'Forecast coverage: no consolidated forecast until fixed commitments and variable cost bases are verified. Statements, unclassified documents and unverified account scopes excluded from paid totals to prevent invoice/statement overlap. No inference of paid cash from usage or invoice issue dates.',
  );
  return lines.join('\n') + '\n';
}
/** Convert old dashboard records conservatively; statement month is not a date. */
export function importInvoiceHistory(history) {
  if (history.version !== 1 || !Array.isArray(history.entries))
    throw new Error('Invalid legacy history');
  const entries = history.entries.map((e) => {
    if (!/^\d{4}-\d{2}$/.test(e.month)) throw new Error('Invalid historical month');
    const source = new URL(e.sourceUrl);
    return {
      vendor: e.vendor,
      documentId: createHash('sha256')
        .update(JSON.stringify([e.vendor, e.month, e.kind, source.href]))
        .digest('hex'),
      scope: e.scope,
      scopeId: 'legacy-import-unverified-account',
      currency: e.currency,
      kind: e.kind,
      issuedOn: `${e.month}-01`,
      issuedDateBasis: 'month only; day placeholder',
      issueDatePrecision: 'month',
      originalMonthBasis: e.basis ?? 'unknown',
      amount: e.amount,
      paidOn: e.paidOn ?? null,
      sourceUrl: source.href,
    };
  });
  normalizeLedger({ version: 1, entries });
  return { version: 1, verifiedAt: history.verifiedAt ?? null, entries };
}
export function reportHtml(markdown) {
  const escape = (s) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  let table = false;
  const body = markdown
    .split('\n')
    .map((line) => {
      if (line.startsWith('|')) {
        if (/^\|[-| :]+$/.test(line)) return '';
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((c) => `<td>${escape(c.trim())}</td>`)
          .join('');
        const open = table ? '' : '<table>';
        table = true;
        return `${open}<tr>${cells}</tr>`;
      }
      const close = table ? '</table>' : '';
      table = false;
      if (line.startsWith('# ')) return `${close}<h1>${escape(line.slice(2))}</h1>`;
      if (line.startsWith('## ')) return `${close}<h2>${escape(line.slice(3))}</h2>`;
      return `${close}<p>${escape(line)}</p>`;
    })
    .join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DeclutrMail spending</title><style>body{font:15px system-ui;max-width:1200px;margin:40px auto;padding:20px;color:#202632}table{border-collapse:collapse;width:100%;margin-bottom:24px}td{padding:12px;border-bottom:1px solid #ddd}tr:first-child{font-weight:700;background:#e9edf5}tr:nth-child(even){background:#f7f8fa}h1,h2{color:#23395b}</style><body>${body}${table ? '</table>' : ''}</body></html>`;
}
export function assertPrivateBucket(metadata, policy) {
  const iam = metadata.iamConfiguration ?? metadata.iam_configuration ?? metadata;
  if (
    (iam.publicAccessPrevention ?? iam.public_access_prevention) !== 'enforced' ||
    (iam.uniformBucketLevelAccess?.enabled ??
      iam.uniform_bucket_level_access?.enabled ??
      iam.uniform_bucket_level_access) !== true
  )
    throw new Error('Finance bucket requires enforced public access prevention and uniform access');
  if (
    (policy.bindings ?? []).some((b) =>
      (b.members ?? []).some((m) => ['allUsers', 'allAuthenticatedUsers'].includes(m)),
    )
  )
    throw new Error('Finance bucket must not grant public access');
}
function main() {
  const bucket = process.env.PRIVATE_FINANCE_BUCKET;
  if (!bucket || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket))
    throw new Error('Configure private finance bucket name');
  const gc = (...args) =>
    execFileSync('gcloud', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });
  const uri = `gs://${bucket}`;
  assertPrivateBucket(
    JSON.parse(gc('storage', 'buckets', 'describe', uri, '--format=json')),
    JSON.parse(gc('storage', 'buckets', 'get-iam-policy', uri, '--format=json')),
  );
  const ledger = JSON.parse(gc('storage', 'cat', `${uri}/config/invoices.json`));
  const registry = JSON.parse(gc('storage', 'cat', `${uri}/config/subscriptions.json`));
  const snapshot = JSON.parse(readFileSync(process.env.INFRA_SNAPSHOT_PATH, 'utf8'));
  const report = financeReport(ledger, registry, snapshot);
  const dir = mkdtempSync(join(tmpdir(), 'private-finance-'));
  try {
    const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const date = new Date(snapshot.observedAt).toISOString().slice(0, 10);
    const snapshotPath = join(dir, 'snapshot.json');
    const reportPath = join(dir, 'report.md');
    const htmlPath = join(dir, 'report.html');
    writeFileSync(htmlPath, reportHtml(report), { mode: 0o600 });
    writeFileSync(snapshotPath, JSON.stringify(snapshot), { mode: 0o600 });
    writeFileSync(reportPath, report, { mode: 0o600 });
    const object = `${uri}/observations/${date}/${hash}.json`;
    try {
      gc('storage', 'cp', '--if-generation-match=0', snapshotPath, object);
    } catch {
      if (gc('storage', 'cat', object) !== JSON.stringify(snapshot))
        throw new Error('Observation write conflict');
    }
    gc('storage', 'cp', reportPath, `${uri}/reports/latest.md`);
    gc('storage', 'cp', htmlPath, `${uri}/reports/latest.html`);
    gc('storage', 'cp', reportPath, `${uri}/reports/${date}.md`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('Private finance report updated; document contents omitted from workflow logs.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch {
    console.error(
      'Private finance reporting failed; check bucket privacy, input schema and scoped permissions. No financial document contents logged.',
    );
    process.exitCode = 1;
  }
}
