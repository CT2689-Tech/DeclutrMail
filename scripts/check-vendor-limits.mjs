#!/usr/bin/env node
/**
 * check-vendor-limits.mjs
 *
 * Daily vendor-limits watchdog (D156). Reads usage vs limits for each
 * external vendor and exits 1 on any BREACH or ERROR — a failed
 * scheduled-workflow run is the alert (GH emails the founder via
 * "Send notifications for failed workflows").
 *
 * Zero npm dependencies — plain Node >= 22 (global fetch). Shells out
 * to `psql` (Supabase) and `gcloud` (GCP) only; both are preinstalled
 * on ubuntu-latest runners.
 *
 * Per-vendor statuses:
 *   OK           — under the warn threshold
 *   WARN         — >= warn threshold (bold in the table; exits 0 unless
 *                  WARN_IS_FAILURE=true)
 *   BREACH       — >= 2x warn threshold, or a vendor-native hard signal
 *                  (PostHog quota-limited, GH Actions net spend > $0)
 *   UNCONFIGURED — required env var(s) absent; check skipped. The
 *                  script is useful from day 1 with partial creds and
 *                  gets better as the founder adds tokens.
 *   ERROR        — vendor call failed (auth, network, parse)
 *
 * Env vars (creds — missing => UNCONFIGURED for that vendor):
 *   SUPABASE_SESSION_DSN                    DB size via psql
 *   GOOGLE_APPLICATION_CREDENTIALS +
 *     GCP_BILLING_ACCOUNT_ID                budget config via gcloud
 *   UPSTASH_EMAIL + UPSTASH_API_KEY         daily commands + storage
 *   (Anthropic spend: monitor via console.anthropic.com/cost — Admin API
 *    requires Teams/Enterprise plan, not available on individual orgs)
 *   VERCEL_TOKEN + VERCEL_TEAM_ID           MTD billed charges
 *   SENTRY_AUTH_TOKEN + SENTRY_ORG          accepted error events / day
 *   POSTHOG_API_KEY + POSTHOG_PROJECT_ID    quota limits + MTD events
 *     (+ POSTHOG_HOST, default us.posthog.com)
 *   GH_BILLING_PAT (+ GH_BILLING_ACCOUNT,   Actions minutes vs included
 *     default GITHUB_REPOSITORY_OWNER)
 *
 * Env vars (thresholds — defaults baked in):
 *   SUPABASE_DB_SIZE_WARN_MB      default 400
 *   UPSTASH_DAILY_CMD_WARN        default 1000000
 *   VERCEL_MTD_COST_WARN_USD      default 20
 *   SENTRY_DAILY_EVENTS_WARN      default 1000
 *   POSTHOG_MTD_EVENTS_WARN       default 1000000
 *   GH_ACTIONS_INCLUDED_MINUTES   default 2000
 *   WARN_IS_FAILURE               'true' => WARNs also exit 1
 *
 * Secret hygiene: secret values are never printed. psql errors are
 * rebuilt from stderr only (node's execFile error message embeds the
 * full command line, which would carry the DSN). HTTP error details
 * carry status code + truncated response body only.
 *
 * Exit codes: 0 — all OK/WARN/UNCONFIGURED · 1 — any BREACH or ERROR
 * (or WARN with WARN_IS_FAILURE=true).
 */

import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';

// One slow vendor must not hang the run — every external call (HTTP
// fetch or child process) gets this timeout.
const TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------- utils

function envNum(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} is not a number`);
  return n;
}

async function httpText(url, { headers = {}, method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${new URL(url).host}: ${text.slice(0, 200)}`);
  }
  return text;
}

async function httpJson(url, opts) {
  return JSON.parse(await httpText(url, opts));
}

// WARN at >= the warn threshold, BREACH at >= 2x it. usagePct is
// relative to the warn threshold, so 100% == "warn line crossed".
function gauge(value, warnAt) {
  const status = value >= warnAt * 2 ? 'BREACH' : value >= warnAt ? 'WARN' : 'OK';
  return { status, usagePct: Math.round((value / warnAt) * 100) };
}

function monthStartIso() {
  const now = new Date();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${now.getUTCFullYear()}-${m}-01T00:00:00Z`;
}

function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

// Upstash stats fields are sometimes scalars, sometimes time series of
// {x, y} points — normalize to the latest scalar value. An absent or
// non-numeric field THROWS (vendor reports ERROR): silently coercing
// to 0 would read as "OK, 0 commands", which is impossible for an
// always-on poller.
function latestValue(v, field) {
  if (Array.isArray(v)) v = v[v.length - 1];
  if (v && typeof v === 'object') v = v.y ?? v.value;
  const n = Number(v);
  if (v == null || !Number.isFinite(n)) {
    throw new Error(`Upstash stats response missing numeric ${field}`);
  }
  return n;
}

// ---------------------------------------------------------------- checks

async function checkSupabaseDbSize() {
  const warnMb = envNum('SUPABASE_DB_SIZE_WARN_MB', 400);
  const base = process.env.SUPABASE_SESSION_DSN;
  const dsn = base + (base.includes('?') ? '&' : '?') + 'sslmode=require';
  const stdout = await new Promise((resolve, reject) => {
    execFile(
      'psql',
      [dsn, '-At', '--quiet', '-c', 'SELECT pg_database_size(current_database());'],
      { timeout: TIMEOUT_MS },
      (err, out, stderr) => {
        if (err) {
          // NEVER propagate err.message — node embeds the full command
          // line (which carries the DSN) in it. Rebuild from stderr,
          // with the DSN redacted defensively.
          const safe = String(stderr)
            .replaceAll(process.env.SUPABASE_SESSION_DSN, '***')
            .slice(0, 200);
          reject(new Error(`psql failed (${err.code ?? 'killed'}): ${safe}`));
        } else {
          resolve(out);
        }
      },
    );
  });
  const mb = Number(stdout.trim()) / (1024 * 1024);
  if (!Number.isFinite(mb)) throw new Error('psql returned a non-numeric DB size');
  return {
    ...gauge(mb, warnMb),
    detail: `DB size ${mb.toFixed(1)} MB (warn ${warnMb} MB)`,
  };
}

async function checkGcpBudgets() {
  // No GCP REST endpoint returns current spend — budgets carry config
  // only; spend flows via the budget's Pub/Sub topic. This check
  // asserts a budget EXISTS (i.e. Google's own threshold emails are
  // armed) — zero budgets means zero spend alerting, which is the
  // failure worth surfacing daily.
  const account = process.env.GCP_BILLING_ACCOUNT_ID;
  const stdout = await new Promise((resolve, reject) => {
    execFile(
      'gcloud',
      ['billing', 'budgets', 'list', `--billing-account=${account}`, '--format=json'],
      { timeout: TIMEOUT_MS },
      (err, out, stderr) => {
        if (err && err.code === 'ENOENT')
          resolve(null); // gcloud absent
        else if (err) reject(new Error(`gcloud failed: ${String(stderr).slice(0, 200)}`));
        else resolve(out);
      },
    );
  });
  if (stdout === null) return { status: 'UNCONFIGURED', detail: 'gcloud not on PATH' };
  const budgets = JSON.parse(stdout || '[]');
  if (budgets.length === 0) {
    return { status: 'WARN', detail: 'no budgets configured — GCP spend has no alerting net' };
  }
  const parts = budgets.map((b) => {
    const amt = b.amount?.specifiedAmount;
    const usd = amt ? `${amt.units ?? 0} ${amt.currencyCode ?? 'USD'}` : 'last-period amount';
    return `${b.displayName ?? 'budget'}: ${usd}`;
  });
  return { status: 'OK', detail: `budgets armed — ${parts.join('; ')}` };
}

async function checkUpstash() {
  const warnCmds = envNum('UPSTASH_DAILY_CMD_WARN', 1_000_000);
  const basic = Buffer.from(`${process.env.UPSTASH_EMAIL}:${process.env.UPSTASH_API_KEY}`).toString(
    'base64',
  );
  const headers = { Authorization: `Basic ${basic}` };
  const dbs = await httpJson('https://api.upstash.com/v2/redis/databases', { headers });
  if (!Array.isArray(dbs) || dbs.length === 0) {
    return { status: 'ERROR', detail: 'no Redis databases visible to this API key' };
  }
  // Single prod Redis today — check the first database.
  const db = dbs[0];
  const stats = await httpJson(`https://api.upstash.com/v2/redis/stats/${db.database_id}`, {
    headers,
  });
  const cmds = latestValue(stats.daily_net_commands, 'daily_net_commands');
  const storageMb = latestValue(stats.current_storage, 'current_storage') / (1024 * 1024);
  return {
    ...gauge(cmds, warnCmds),
    detail: `${db.database_name}: ${fmtInt(cmds)} commands today (warn ${fmtInt(warnCmds)}), storage ${storageMb.toFixed(1)} MB`,
  };
}

async function checkVercel() {
  const warnUsd = envNum('VERCEL_MTD_COST_WARN_USD', 20);
  const url = new URL('https://api.vercel.com/v1/billing/charges');
  url.searchParams.set('from', monthStartIso());
  url.searchParams.set('to', new Date().toISOString());
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set('teamId', process.env.VERCEL_TEAM_ID);
  const text = await httpText(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
  });
  // Response is FOCUS v1.3 JSONL — one charge object per line.
  let usd = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    usd += Number(JSON.parse(line).BilledCost) || 0;
  }
  return {
    ...gauge(usd, warnUsd),
    detail: `MTD billed $${usd.toFixed(2)} (warn $${warnUsd})`,
  };
}

async function checkSentry() {
  const warnDaily = envNum('SENTRY_DAILY_EVENTS_WARN', 1_000);
  const url = new URL(`https://sentry.io/api/0/organizations/${process.env.SENTRY_ORG}/stats_v2/`);
  url.searchParams.set('field', 'sum(quantity)');
  url.searchParams.set('groupBy', 'outcome');
  url.searchParams.set('category', 'error');
  url.searchParams.set('interval', '1d');
  url.searchParams.set('statsPeriod', '1d');
  const res = await httpJson(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
  });
  // Only `accepted` outcomes consume paid quota.
  const accepted = (res.groups ?? [])
    .filter((g) => g.by?.outcome === 'accepted')
    .reduce((sum, g) => sum + (Number(g.totals?.['sum(quantity)']) || 0), 0);
  return {
    ...gauge(accepted, warnDaily),
    detail: `${fmtInt(accepted)} accepted errors last 24h (warn ${fmtInt(warnDaily)})`,
  };
}

async function checkPosthog() {
  const host = process.env.POSTHOG_HOST || 'https://us.posthog.com';
  const pid = process.env.POSTHOG_PROJECT_ID;
  const headers = { Authorization: `Bearer ${process.env.POSTHOG_API_KEY}` };
  const quota = await httpJson(`${host}/api/projects/${pid}/quota_limits/`, { headers });
  const limited = [];
  for (const [resource, v] of Object.entries(quota ?? {})) {
    if (v === true || (v && typeof v === 'object' && v.limited === true)) limited.push(resource);
  }
  if (limited.length > 0) {
    // Past the billing limit — PostHog is DROPPING data right now.
    return {
      status: 'BREACH',
      detail: `quota-limited (data being dropped): ${limited.join(', ')}`,
    };
  }
  const warnEvents = envNum('POSTHOG_MTD_EVENTS_WARN', 1_000_000);
  const res = await httpJson(`${host}/api/projects/${pid}/query/`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: {
        kind: 'HogQLQuery',
        query: 'SELECT count() FROM events WHERE timestamp >= toStartOfMonth(now())',
      },
    }),
  });
  const events = Number(res.results?.[0]?.[0]) || 0;
  return {
    ...gauge(events, warnEvents),
    detail: `no quota limits hit; MTD events ${fmtInt(events)} (warn ${fmtInt(warnEvents)})`,
  };
}

async function checkGithubActions() {
  const account = process.env.GH_BILLING_ACCOUNT || process.env.GITHUB_REPOSITORY_OWNER;
  if (!account) {
    return { status: 'UNCONFIGURED', detail: 'set GH_BILLING_ACCOUNT (auto in Actions)' };
  }
  const included = envNum('GH_ACTIONS_INCLUDED_MINUTES', 2_000);
  const now = new Date();
  const qs = `?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`;
  const headers = {
    Authorization: `Bearer ${process.env.GH_BILLING_PAT}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  let usage;
  try {
    usage = await httpJson(`https://api.github.com/users/${account}/settings/billing/usage${qs}`, {
      headers,
    });
  } catch {
    // Account may be an organization — the user endpoint 404s; retry
    // the org endpoint before giving up.
    usage = await httpJson(
      `https://api.github.com/organizations/${account}/settings/billing/usage${qs}`,
      { headers },
    );
  }
  let minutes = 0;
  let netUsd = 0;
  for (const item of usage.usageItems ?? []) {
    if (item.product !== 'actions') continue;
    minutes += Number(item.quantity) || 0;
    netUsd += Number(item.netAmount) || 0;
  }
  const usagePct = Math.round((minutes / included) * 100);
  // Included minutes net out via discountAmount — any netAmount > 0
  // means the free tier is exhausted and real money is being spent.
  const status = netUsd > 0 ? 'BREACH' : usagePct >= 80 ? 'WARN' : 'OK';
  return {
    status,
    usagePct,
    detail: `${fmtInt(minutes)} Actions min MTD of ${fmtInt(included)} included; net spend $${netUsd.toFixed(2)}`,
  };
}

// -------------------------------------------------------------- registry

const VENDORS = [
  { name: 'Supabase (DB size)', requires: ['SUPABASE_SESSION_DSN'], check: checkSupabaseDbSize },
  {
    name: 'Google Cloud (budgets)',
    requires: ['GOOGLE_APPLICATION_CREDENTIALS', 'GCP_BILLING_ACCOUNT_ID'],
    check: checkGcpBudgets,
  },
  { name: 'Upstash Redis', requires: ['UPSTASH_EMAIL', 'UPSTASH_API_KEY'], check: checkUpstash },
  {
    // VERCEL_TEAM_ID is required (not just forwarded): the billing
    // endpoint is team-scoped, so without it the check would ERROR
    // daily on today's Hobby plan instead of staying UNCONFIGURED.
    name: 'Vercel',
    requires: ['VERCEL_TOKEN', 'VERCEL_TEAM_ID'],
    check: checkVercel,
  },
  { name: 'Sentry', requires: ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG'], check: checkSentry },
  {
    name: 'PostHog',
    requires: ['POSTHOG_API_KEY', 'POSTHOG_PROJECT_ID'],
    check: checkPosthog,
  },
  { name: 'GitHub Actions', requires: ['GH_BILLING_PAT'], check: checkGithubActions },
];

async function runVendor(vendor) {
  const missing = vendor.requires.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return { name: vendor.name, status: 'UNCONFIGURED', detail: `missing ${missing.join(', ')}` };
  }
  try {
    return { name: vendor.name, ...(await vendor.check()) };
  } catch (err) {
    return {
      name: vendor.name,
      status: 'ERROR',
      detail: String(err?.message ?? err).slice(0, 300),
    };
  }
}

// ---------------------------------------------------------------- output

const STATUS_ICON = {
  OK: '🟢',
  WARN: '🟡',
  BREACH: '🔴',
  ERROR: '🔴',
  UNCONFIGURED: '⚪',
};

function toMarkdown(results) {
  const lines = [
    `## Vendor limits watchdog — ${new Date().toISOString().slice(0, 10)}`,
    '',
    '| Vendor | Status | Usage | Detail |',
    '|---|---|---|---|',
  ];
  for (const r of results) {
    const bold = r.status === 'WARN';
    const cell = (s) => (bold ? `**${s}**` : s);
    const usage = r.usagePct == null ? '—' : `${r.usagePct}%`;
    // Pipes and newlines in vendor output would break the table row.
    const detail = String(r.detail ?? '')
      .replaceAll('|', '\\|')
      .replace(/\s+/g, ' ')
      .trim();
    lines.push(
      `| ${cell(r.name)} | ${STATUS_ICON[r.status]} ${cell(r.status)} | ${usage} | ${cell(detail)} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  // Vendors run in parallel — each external call carries its own 10s
  // timeout, so worst case is bounded by the slowest single vendor.
  const results = await Promise.all(VENDORS.map(runVendor));

  const table = toMarkdown(results);
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
  }

  const warnIsFailure = process.env.WARN_IS_FAILURE === 'true';
  const failing = results.filter(
    (r) => r.status === 'BREACH' || r.status === 'ERROR' || (warnIsFailure && r.status === 'WARN'),
  );
  if (failing.length > 0) {
    // `::error::` surfaces as a red annotation on the Actions run.
    console.log(
      `::error::Vendor limits watchdog failing: ${failing.map((r) => `${r.name} (${r.status})`).join('; ')}`,
    );
    process.exit(1);
  }
}

await main();
