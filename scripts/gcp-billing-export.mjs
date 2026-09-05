/** Read bounded, project-scoped exported charges; no invoice/payment inference. */
import { gcpRequest, gcpToken, finiteNumber } from './infra-observability.mjs';
export function billingQuery(table) {
  if (!/^[a-z][a-z0-9-]+\.[A-Za-z0-9_]+\.gcp_billing_export_resource_v1_[A-Za-z0-9_]+$/.test(table))
    throw new Error('Invalid detailed billing export table');
  return `SELECT FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time, 'UTC')) AS day,
    service.description AS service, currency,
    SUM(CAST(cost AS NUMERIC)) AS gross,
    SUM(IFNULL((SELECT SUM(CAST(c.amount AS NUMERIC)) FROM UNNEST(credits) c), 0)) AS credits,
    MAX(export_time) AS exported_at
    FROM \`${table}\`
    WHERE project.id = @project
      AND usage_start_time >= TIMESTAMP(DATE_TRUNC(CURRENT_DATE('UTC'), MONTH))
      AND usage_start_time < CURRENT_TIMESTAMP()
      AND _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE('UTC'), INTERVAL 40 DAY))
    GROUP BY day, service, currency ORDER BY day, service`;
}
export function summarizeBilling(rows, now = Date.now()) {
  if (!rows.length)
    return {
      status: 'WARN',
      detail: 'Billing export has no current-month rows yet; cost unavailable',
    };
  let gross = 0,
    credits = 0,
    exported = 0;
  const services = new Map();
  for (const r of rows) {
    if (r.currency !== 'USD') throw new Error('Unexpected billing export currency');
    const g = finiteNumber(r.gross, 'gross charge'),
      c = finiteNumber(r.credits, 'credit');
    const stamp = Date.parse(r.exported_at);
    if (!Number.isFinite(stamp) || stamp > now) throw new Error('Invalid billing export timestamp');
    gross += g;
    credits += c;
    exported = Math.max(exported, stamp);
    services.set(r.service, (services.get(r.service) ?? 0) + g + c);
  }
  const age = (now - exported) / 3600000;
  if (age > 48)
    return {
      status: 'WARN',
      detail: `Billing export is ${Math.floor(age)}h old; cost withheld`,
      usage: { billing_export_age_hours: age },
    };
  const usage = {
    gcp_gross_mtd_usd: gross,
    gcp_credits_mtd_usd: credits,
    billing_export_age_hours: age,
  };
  for (const [name, key] of [
    ['Cloud Run', 'gcp_cloud_run_mtd_usd'],
    ['Artifact Registry', 'gcp_artifact_registry_mtd_usd'],
    ['Cloud Storage', 'gcp_storage_mtd_usd'],
    ['Cloud Logging', 'gcp_logging_mtd_usd'],
    ['Cloud Pub/Sub', 'gcp_pubsub_mtd_usd'],
    ['BigQuery', 'gcp_bigquery_mtd_usd'],
  ]) {
    if (services.has(name)) usage[key] = services.get(name);
  }
  return {
    status: 'OK',
    costMtdUsd: gross + credits,
    usage,
    detail: `Exported project usage charges $${(gross + credits).toFixed(2)} MTD after credits; export age ${age.toFixed(1)}h. Not a paid invoice.`,
  };
}
export async function checkGcpBillingExport(table, project = 'declutrmail-ai-prod') {
  if (!table)
    return { status: 'UNCONFIGURED', detail: 'Detailed billing export table not configured' };
  const token = gcpToken();
  let result = await gcpRequest(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`,
    token,
    'POST',
    {
      query: billingQuery(table),
      useLegacySql: false,
      location: 'US',
      timeoutMs: 10000,
      maximumBytesBilled: '268435456',
      parameterMode: 'NAMED',
      queryParameters: [
        { name: 'project', parameterType: { type: 'STRING' }, parameterValue: { value: project } },
      ],
    },
  );
  if (!result.jobComplete)
    throw new Error('Billing query still running; inspect BigQuery job before retrying');
  const schema = result.schema?.fields;
  if (!schema) throw new Error('Billing query returned no schema');
  const rows = [];
  let nextPage;
  do {
    for (const row of result.rows ?? [])
      rows.push(Object.fromEntries(row.f.map((c, i) => [schema[i].name, c.v])));
    nextPage = result.pageToken;
    if (!nextPage) break;
    const ref = result.jobReference;
    result = await gcpRequest(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries/${ref.jobId}?location=US&pageToken=${encodeURIComponent(result.pageToken)}`,
      token,
    );
  } while (nextPage);
  // BigQuery TIMESTAMP JSON values are Unix seconds.
  rows.forEach(
    (r) =>
      (r.exported_at = new Date(finiteNumber(r.exported_at, 'export time') * 1000).toISOString()),
  );
  return summarizeBilling(rows);
}
