#!/usr/bin/env node
import { budgetStatus } from './gcp-budget-status.mjs';
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
 *   ERROR        — no value obtained: the vendor call failed (auth,
 *                  network, parse) or timed out twice in a row. Exits 1.
 *                  WARN/BREACH judge a value we HAVE; ERROR means we do
 *                  not have one, and must never be graded as a soft signal.
 *
 * Env vars (creds — missing => UNCONFIGURED for that vendor):
 *   SUPABASE_SESSION_DSN                    DB size via psql
 *   GOOGLE_APPLICATION_CREDENTIALS +
 *     GCP_BILLING_ACCOUNT_ID                budget config via gcloud
 *   UPSTASH_EMAIL + UPSTASH_API_KEY         daily commands + storage
 *   ANTHROPIC_ADMIN_KEY                     MTD cost via cost_report (added
 *                                           2026-08-29 — Admin API is
 *                                           documented as unavailable for
 *                                           individual accounts; an ERROR
 *                                           saying so is a real answer, not
 *                                           a bug)
 *   VERCEL_TOKEN + VERCEL_TEAM_ID           MTD billed charges
 *   SENTRY_AUTH_TOKEN + SENTRY_ORG          accepted error events / day
 *   POSTHOG_API_KEY + POSTHOG_PROJECT_ID    quota limits + MTD events
 *     (+ POSTHOG_HOST, default us.posthog.com)
 *   GH_BILLING_PAT (+ GH_BILLING_ACCOUNT,   Actions net spend (minutes are
 *     default GITHUB_REPOSITORY_OWNER)      reported but do not gate)
 *
 * Env vars (thresholds — defaults baked in):
 *   SUPABASE_DB_SIZE_WARN_MB      default 400
 *   UPSTASH_DAILY_CMD_WARN        default 1000000
 *   UPSTASH_BUDGET_WARN_FRACTION  default 0.8 (of the database's own
 *                                 Upstash budget, gauged against the
 *                                 PROJECTED month-end spend)
 *   ANTHROPIC_MTD_COST_WARN_USD   default 50
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
 * Known issues: scripts/known-vendor-issues.tsv acknowledges one failing
 * cause per line (vendor + status + text the cause contains, a ceiling on
 * its value or `-` for a cause with none, until a date at most 30 days
 * out). A failing row prints as a warning, and does not fail the run, only
 * when every failing cause in it is acknowledged and within its ceiling; so
 * red means a failure nobody has acknowledged yet, at a size nobody has
 * accepted. A check that joins causes into one detail (Upstash spend and
 * volume, each suspended database, each GCP budget, each PostHog quota)
 * reports them separately, so one line cannot mute another cause, and a
 * read that fails after others succeeded keeps what they measured. Before
 * the list, Anthropic's standing ERROR (no Admin API key) held the run red
 * every day from at least 2026-09-21, and the Sentry and Google Cloud
 * budget breaches of 2026-09-24/25 changed nothing anyone saw.
 *
 * Exit codes: 0 — nothing failing that is not acknowledged · 1 — an
 * unacknowledged BREACH or ERROR (or WARN with WARN_IS_FAILURE=true) ·
 * 2 — the known-issues list is missing or malformed.
 */

import { checkGcpBillingExport } from './gcp-billing-export.mjs';
import { execFile } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { anthropicCostUsd, finiteNumber, makeSnapshot } from './infra-observability.mjs';

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

async function httpText(url, { headers = {}, method = 'GET', body, timeoutMs = TIMEOUT_MS } = {}) {
  const res = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
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

/** Status severity order, for picking the worst of several gauges. */
const RANK = { OK: 0, UNCONFIGURED: 0, WARN: 1, BREACH: 2, ERROR: 3 };
const worstStatus = (causes) =>
  causes.reduce((worst, c) => (RANK[c.status] > RANK[worst] ? c.status : worst), 'OK');

/**
 * A request that ran out of time rather than failing on its merits.
 * `AbortSignal.timeout` throws a TimeoutError; the message match covers
 * fetch/undici wording differences and the `execFile` timeout path.
 */
function isTimeout(err) {
  return err?.name === 'TimeoutError' || /timeout|aborted/i.test(String(err?.message));
}

/**
 * Runs a read for a check that has already measured `causes`. A failure
 * still throws, so runVendor still retries a timeout, but the error carries
 * `causes` and runVendor reports them beside it. Before this, a failed second
 * read replaced a measured suspension or quota BREACH, and a line
 * acknowledging the error muted both (#795 review).
 */
async function readKeeping(causes, read) {
  try {
    return await read();
  } catch (err) {
    // A new error each time: a rejected promise can be read twice (the
    // timeout retry), and mutating it would list its causes twice.
    const e = new Error(String(err?.message ?? err), { cause: err });
    e.name = err?.name ?? 'Error';
    e.measuredCauses = [...causes, ...(err?.measuredCauses ?? [])];
    throw e;
  }
}

/**
 * Fraction of the current UTC month elapsed, for extrapolating a
 * month-to-date total to a month-end projection.
 *
 * Floored at 10%: in the first hours of a month the divisor approaches
 * zero and any spend at all projects to a fantasy number. Early in the
 * month the projection is therefore CONSERVATIVE (it under-projects)
 * rather than paging on noise — a real overspend still trips it within
 * a few days, which is all the warning the cap needs.
 */
function monthElapsedFraction(now = new Date()) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max((now.getTime() - start) / (end - start), 0.1);
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
      [
        dsn,
        '-At',
        '--quiet',
        '-c',
        "SELECT json_build_object('database_bytes', pg_database_size(current_database()), 'connections', (SELECT count(*) FROM pg_stat_activity), 'max_connections', current_setting('max_connections')::int);",
      ],
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
  const stats = JSON.parse(stdout.trim());
  const mb = finiteNumber(stats.database_bytes, 'database size') / (1024 * 1024);
  if (!Number.isFinite(mb)) throw new Error('psql returned a non-numeric DB size');
  const detail = `DB size ${mb.toFixed(1)} MB (warn ${warnMb} MB)`;
  const size = gauge(mb, warnMb);
  // Valued in MB, so an acknowledgment can bound it.
  const causes = [{ status: size.status, text: detail, value: mb }];
  // Read after the size, so a missing usage figure keeps it.
  const [connections, maxConnections] = await readKeeping(causes, () => [
    finiteNumber(stats.connections, 'database connections'),
    finiteNumber(stats.max_connections, 'maximum connections'),
  ]);
  return {
    ...size,
    detail,
    causes,
    usage: {
      database_mb: mb,
      database_connections: connections,
      database_max_connections: maxConnections,
    },
  };
}

async function checkGcpBudgets() {
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
  const spend = await gcpSpend();
  return budgetStatus(budgets, spend);
}

export async function checkUpstash() {
  const warnCmds = envNum('UPSTASH_DAILY_CMD_WARN', 1_000_000);
  const basic = Buffer.from(`${process.env.UPSTASH_EMAIL}:${process.env.UPSTASH_API_KEY}`).toString(
    'base64',
  );
  const headers = { Authorization: `Basic ${basic}` };
  const dbs = await httpJson('https://api.upstash.com/v2/redis/databases', { headers });
  if (!Array.isArray(dbs) || dbs.length === 0) {
    return { status: 'ERROR', detail: 'no Redis databases visible to this API key' };
  }
  // Lifecycle state FIRST — a budget-suspended DB reports 0 commands, so a
  // volume-only gauge reads it as "0% OK" while production drowns in
  // "database has been suspended" ReplyErrors (prod incident 2026-07-15:
  // login + all sync down for hours, watchdog stayed green). Upstash marks
  // a healthy DB `state: 'active'`; anything else (suspended/disabled/
  // deleted) is a hard BREACH regardless of usage. Scan EVERY DB so a
  // non-first prod database can't hide behind an idle one.
  // One cause per database: acknowledging one suspended database must not
  // cover the next (the 2026-07-15 outage was a second database). A state
  // that is not reported is not read as healthy (#795 review).
  const lifecycle = dbs
    .filter((db) => db.state !== 'active')
    .map((db) => ({
      status: typeof db.state === 'string' ? 'BREACH' : 'ERROR',
      text: `${db.database_name ?? db.database_id}: ${
        typeof db.state === 'string' ? `state=${db.state}` : 'state not reported'
      }`,
    }));
  // Every active database is gauged, each with causes of its own, even while
  // another is suspended: acknowledging a suspended staging database must not
  // stop the spend and volume checks on prod, and gauging only the first
  // active database let another one listed first stand in for prod.
  const gauged = [];
  for (const db of dbs.filter((d) => d.state === 'active')) {
    const kept = [...lifecycle, ...gauged.flatMap((g) => g.causes)];
    gauged.push(await readKeeping(kept, () => gaugeDatabase(db)));
  }
  const causes = [...lifecycle, ...gauged.flatMap((g) => g.causes)];
  const detail = [...lifecycle.map((c) => c.text), ...gauged.map((g) => g.detail)].join('; ');
  if (gauged.length <= 1) return { ...gauged[0], status: worstStatus(causes), detail, causes };
  // Several active databases: the row reports account totals, and leaves out
  // a total that any database could not supply rather than understate it.
  const total = (read) => {
    const values = gauged.map(read);
    return values.every(Number.isFinite) ? values.reduce((a, b) => a + b, 0) : undefined;
  };
  return {
    status: worstStatus(causes),
    costMtdUsd: total((g) => g.costMtdUsd) ?? null,
    usage: Object.fromEntries(
      ['commands_today', 'storage_mb', 'budget_usd', 'projected_month_usd']
        .map((k) => [k, total((g) => g.usage?.[k])])
        .filter(([, v]) => v !== undefined),
    ),
    detail,
    causes,
  };

  async function gaugeDatabase(db) {
    const stats = await httpJson(`https://api.upstash.com/v2/redis/stats/${db.database_id}`, {
      headers,
    });

    // SPEND, projected. Volume alone cannot see this coming: on 2026-07-25
    // this vendor read "🟢 OK 14% — 137,114 commands today" hours before the
    // production database was budget-suspended, because 137k/day is a
    // seventh of the command threshold while the MONTH's cost was already
    // at the cap. Commands and money are different axes and only one of
    // them suspends the database.
    //
    // Gauged against the database's OWN `budget` rather than an env
    // constant, so raising the cap in the Upstash console cannot leave a
    // stale threshold here.
    //
    // The projection is the part that buys warning time. A flat gauge on
    // spend-so-far is green early in the month by construction — day 5 of a
    // $30 budget at $8 reads 27% while the run-rate says $48 by month end.
    //
    // Measured before volume, so a volume field Upstash stops reporting
    // cannot take the spend cause down with it.
    //
    // Only an explicit number is a budget: a missing or unreadable one is not
    // "no cap", since the cap is the kill switch (#795 review). Upstash
    // documents `budget` as an integer on the Database object
    // (devops/developer-api/openapi.yaml, read 2026-09-27), so a response
    // without one is read as unreadable, not as uncapped.
    const budget = db.budget == null || db.budget === '' ? NaN : Number(db.budget);
    const monthCost =
      stats.total_monthly_billing == null ? NaN : Number(stats.total_monthly_billing);
    const billed = budget > 0 && Number.isFinite(monthCost);
    const projected = billed ? monthCost / monthElapsedFraction() : NaN;
    // Deliberately NOT `gauge()`. Its BREACH tier is 2x the warn threshold,
    // which for spend would mean "projecting 160% of the cap" — but the
    // damage is done the moment the projection crosses the cap ITSELF:
    // Upstash suspends the database and every BullMQ job stops. That is an
    // outage prediction, not a cost surprise, so it has to exit non-zero.
    //
    // WARN would not do: WARN exits 0, the workflow stays green, and GitHub
    // sends nothing — which is precisely how the 2026-07-25 suspension
    // arrived unannounced. Flipping WARN_IS_FAILURE globally is not the
    // alternative either: it would make every soft signal in the table fail
    // the workflow, and a row that is always red trains the failure away just
    // as surely as one that is always yellow. (The GH Actions row used to be
    // exactly that standing WARN — 574% of an allowance a public repo never
    // pays — and is now cost-keyed instead. Keep it that way.)
    const warnAt = budget * envNum('UPSTASH_BUDGET_WARN_FRACTION', 0.8);
    // BREACH at the WARN line — this row alone, and deliberately.
    //
    // Upstash's cap is not a spend threshold, it is a kill switch: crossing
    // it SUSPENDS the database, and a suspended Redis stops every BullMQ
    // queue at once — Gmail watch renewal included, which lapses the push
    // subscription after ~7 days and stops mail arriving even once Redis is
    // back. That is a total outage, so "on track to be suspended" is a hard
    // signal in the sense BREACH already documents ("a vendor-native hard
    // signal"), not the soft, costs-money signal WARN is for.
    //
    // Every other row keeps WARN: overshooting Vercel or Sentry costs money
    // or drops telemetry, and making those fail the run would leave a
    // permanently red workflow that trains the alert away — the objection
    // that (correctly) rules out flipping WARN_IS_FAILURE globally.
    //
    // The 80% projection is what makes this an alert BEFORE the outage. The
    // pre-existing `projected >= budget` BREACH fires only once month-end
    // spend is already modelled to hit the cap; on 2026-07-25 actual usage
    // reached the cap while the projection still sat under it, the 80% line
    // WARNed into a green run, and prod Redis suspended unannounced.
    const spend = billed && {
      status: projected >= warnAt ? 'BREACH' : 'OK',
      // Against the cap, so 100% reads as "projecting exactly the budget".
      usagePct: Math.round((projected / budget) * 100),
    };
    // A database whose cap or spend was not reported is not OK on volume:
    // the cap is the kill switch, so an unread one is an ERROR cause of its
    // own (#795 review). A budget of 0 is no cap, with nothing to breach.
    const unread = Number.isNaN(budget)
      ? 'budget not reported, so its cap cannot be gauged'
      : budget > 0 && !billed
        ? `no billing reported, so its $${budget.toFixed(2)} cap cannot be gauged`
        : null;
    const spendCauses = billed
      ? [
          {
            status: spend.status,
            text: `${db.database_name}: projecting $${projected.toFixed(2)} against a $${budget.toFixed(2)} cap`,
            value: projected,
          },
        ]
      : unread
        ? [{ status: 'ERROR', text: `${db.database_name}: ${unread}` }]
        : [];

    const cmds = await readKeeping(spendCauses, () =>
      latestValue(stats.daily_net_commands, 'daily_net_commands'),
    );
    const volume = {
      ...gauge(cmds, warnCmds),
      detail: `${fmtInt(cmds)} commands today (warn ${fmtInt(warnCmds)})`,
    };
    // Spend and volume fail independently. Acknowledging a volume spike
    // must not hide the spend projection that predicts a suspension.
    const causes = [
      ...spendCauses,
      { status: volume.status, text: `${db.database_name}: ${volume.detail}`, value: cmds },
    ];
    const storageMb =
      (await readKeeping(causes, () => latestValue(stats.current_storage, 'current_storage'))) /
      (1024 * 1024);

    if (!billed) {
      // No cap to breach, or no cap or billing to gauge: say which.
      const why = Number.isNaN(budget)
        ? 'budget not reported'
        : budget > 0
          ? 'no billing reported'
          : `no spend cap (type=${db.type ?? 'unknown'})`;
      return {
        ...volume,
        status: worstStatus(causes),
        costMtdUsd: Number.isFinite(monthCost) ? monthCost : null,
        usage: { commands_today: cmds, storage_mb: storageMb },
        detail: `${db.database_name}: ${volume.detail}, ${why}`,
        causes,
      };
    }

    // Worst axis wins — a database on track to blow its cap is not "OK"
    // because its command count happens to be low.
    const worst = RANK[spend.status] >= RANK[volume.status] ? spend : volume;
    return {
      status: worst.status,
      usagePct: worst.usagePct,
      costMtdUsd: monthCost,
      usage: {
        commands_today: cmds,
        storage_mb: storageMb,
        budget_usd: budget,
        projected_month_usd: projected,
      },
      detail:
        `${db.database_name}: $${monthCost.toFixed(2)} spent this month, ` +
        `projecting $${projected.toFixed(2)} against a $${budget.toFixed(2)} cap` +
        ` — ${volume.detail}, storage ${storageMb.toFixed(1)} MB`,
      causes,
    };
  }
}

export async function checkAnthropic() {
  // Cost API: GET /v1/organizations/cost_report, daily buckets only
  // (bucket_width=1d), max 31 buckets/page — a full month-to-date fits in
  // one page without group_by, so has_more should always be false; if it
  // isn't, the sum below would silently undercount, so that's an ERROR,
  // not a WARN.
  const warnUsd = envNum('ANTHROPIC_MTD_COST_WARN_USD', 50);
  const url = new URL('https://api.anthropic.com/v1/organizations/cost_report');
  url.searchParams.set('starting_at', monthStartIso());
  url.searchParams.set('ending_at', new Date().toISOString());
  url.searchParams.set('limit', '31');
  const res = await httpJson(url.toString(), {
    headers: {
      'x-api-key': process.env.ANTHROPIC_ADMIN_KEY,
      'anthropic-version': '2023-06-01',
    },
  });
  if (res.has_more) {
    throw new Error('cost_report has_more=true — one page cannot cover the full month');
  }
  const usd = anthropicCostUsd(res);
  return {
    ...gauge(usd, warnUsd),
    costMtdUsd: usd,
    detail: `MTD cost $${usd.toFixed(2)} (warn $${warnUsd})`,
  };
}

export async function checkVercel() {
  const warnUsd = envNum('VERCEL_MTD_COST_WARN_USD', 20);
  const url = new URL('https://api.vercel.com/v1/billing/charges');
  url.searchParams.set('from', monthStartIso());
  url.searchParams.set('to', new Date().toISOString());
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set('teamId', process.env.VERCEL_TEAM_ID);
  // This endpoint streams FOCUS JSONL for the whole month-to-date, so it is
  // structurally slower than every other call here and had been timing out
  // against the shared 10s budget on EIGHT consecutive runs (2026-07-24 →
  // 07-26), leaving Vercel spend unverified the entire time. The path itself
  // is fine — unauthenticated it answers 403 in ~88ms, so it is the response
  // body that is slow, not resolution. Give it its own budget.
  const text = await httpText(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
    timeoutMs: envNum('VERCEL_TIMEOUT_MS', 45_000),
  });
  // Response is FOCUS v1.3 JSONL — one charge object per line.
  let usd = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.BillingCurrency !== 'USD') throw new Error('Unexpected Vercel billing currency');
    usd += finiteNumber(row.BilledCost, 'Vercel BilledCost');
  }
  return {
    ...gauge(usd, warnUsd),
    costMtdUsd: usd,
    detail: `MTD billed $${usd.toFixed(2)} (warn $${warnUsd})`,
  };
}

export async function checkSentry() {
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
  const groups = res.groups ?? [];
  // An empty payload is NOT a healthy day. Reading zero groups as "0
  // accepted, all clear" would make an auth failure, a renamed field or
  // a changed statsPeriod indistinguishable from a quiet mailbox — the
  // check would pass hardest exactly when it could see least. Prove the
  // input was readable before asserting anything about its contents.
  if (groups.length === 0) {
    return {
      status: 'ERROR',
      detail: 'stats_v2 returned no outcome groups — cannot assess Sentry quota',
    };
  }

  const sumOutcome = (...names) =>
    groups
      .filter((g) => names.includes(g.by?.outcome))
      .reduce((sum, g) => sum + (Number(g.totals?.['sum(quantity)']) || 0), 0);

  // Outcomes where an event we WANTED was thrown away by enforcement.
  // Reading `accepted` alone (the only outcome that consumes paid quota)
  // made this check green at precisely the wrong moment: once the org
  // trips its quota Sentry stops accepting, so `accepted` FALLS and a
  // volume gauge reports healthier the blinder we actually are. Audit
  // 2026-08-21 — the PostHog check below has always alerted on its own
  // drop signal ("data being dropped"); this one now does the same.
  // `filtered` is excluded on purpose: that is inbound filters doing
  // what we asked, not a loss.
  const dropped = sumOutcome('rate_limited', 'abuse', 'cardinality_limited');
  // Client-side and malformed losses are real but are not enforcement,
  // so they warn rather than page.
  const lost = sumOutcome('invalid', 'client_discard');
  const accepted = sumOutcome('accepted');
  const volume = gauge(accepted, warnDaily);
  // All three are measured every run, so acknowledging dropped errors cannot
  // hide an accepted-volume breach, and the reverse.
  const causes = [
    {
      status: dropped > 0 ? 'BREACH' : 'OK',
      text: `quota/rate limited (errors being dropped): ${fmtInt(dropped)} in last 24h`,
      value: dropped,
    },
    {
      status: volume.status,
      text: `${fmtInt(accepted)} accepted errors last 24h (warn ${fmtInt(warnDaily)})`,
      value: accepted,
    },
    {
      status: lost > 0 ? 'WARN' : 'OK',
      text: `${fmtInt(lost)} invalid/client-discarded`,
      value: lost,
    },
  ];
  return {
    status: worstStatus(causes),
    usagePct: volume.usagePct,
    usage: { accepted_errors_24h: accepted, discarded_errors_24h: lost },
    detail: causes
      .filter((c, i) => i === 1 || c.value > 0)
      .map((c) => c.text)
      .join('; '),
    causes,
  };
}

export async function checkPosthog() {
  const host = process.env.POSTHOG_HOST || 'https://us.posthog.com';
  const pid = process.env.POSTHOG_PROJECT_ID;
  const headers = { Authorization: `Bearer ${process.env.POSTHOG_API_KEY}` };
  const quota = await httpJson(`${host}/api/projects/${pid}/quota_limits/`, { headers });
  const limited = [];
  for (const [resource, v] of Object.entries(quota ?? {})) {
    if (v === true || (v && typeof v === 'object' && v.limited === true)) limited.push(resource);
  }
  // Past the billing limit, PostHog is DROPPING data right now. One cause
  // per resource, so acknowledging one does not cover another, and the
  // events gauge still runs, so acknowledging a quota cannot hide it.
  const quotaCauses = limited.map((resource) => ({
    status: 'BREACH',
    text: `quota-limited (data being dropped): ${resource}`,
  }));
  const warnEvents = envNum('POSTHOG_MTD_EVENTS_WARN', 1_000_000);
  const events = await readKeeping(quotaCauses, async () => {
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
    return finiteNumber(res.results?.[0]?.[0], 'PostHog events');
  });
  const volume = gauge(events, warnEvents);
  const eventsCause = {
    status: volume.status,
    text: `MTD events ${fmtInt(events)} (warn ${fmtInt(warnEvents)})`,
    value: events,
  };
  const causes = [...quotaCauses, eventsCause];
  return {
    ...volume,
    status: worstStatus(causes),
    usage: { events_mtd: events },
    detail: quotaCauses.length
      ? `${causes.map((c) => c.text).join('; ')}`
      : `no quota limits hit; ${eventsCause.text}`,
    causes,
  };
}

async function checkPaddle() {
  // Paddle is a REVENUE vendor (merchant-of-record, % fees) — the
  // operational risk is not spend but silent webhook death: Paddle
  // auto-deactivates a notification destination after sustained
  // delivery failures, after which subscription tier flips stop
  // arriving with zero error on our side. The check asserts >= 1
  // ACTIVE destination exists (D117).
  const base =
    process.env.PADDLE_ENV === 'production'
      ? 'https://api.paddle.com'
      : 'https://sandbox-api.paddle.com';
  const res = await httpJson(`${base}/notification-settings`, {
    headers: { Authorization: `Bearer ${process.env.PADDLE_API_KEY}` },
  });
  const destinations = Array.isArray(res?.data) ? res.data : [];
  const active = destinations.filter((d) => d.active === true);
  if (active.length === 0) {
    return {
      status: 'BREACH',
      detail: `no ACTIVE webhook destination (${destinations.length} total) — subscription events are NOT being delivered`,
    };
  }
  return {
    status: 'OK',
    detail: `${active.length} active webhook destination(s) of ${destinations.length}`,
  };
}

async function checkRazorpay() {
  // Same posture as Paddle: Razorpay disables webhooks that fail
  // consistently for 24h — assert >= 1 active webhook so India-side
  // subscription events keep flowing (D117).
  const basic = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`,
  ).toString('base64');
  const res = await httpJson('https://api.razorpay.com/v1/webhooks?count=100', {
    headers: { Authorization: `Basic ${basic}` },
  });
  const hooks = Array.isArray(res?.items) ? res.items : [];
  const active = hooks.filter((h) => h.active === true);
  if (active.length === 0) {
    return {
      status: 'BREACH',
      detail: `no ACTIVE webhook (${hooks.length} total) — subscription events are NOT being delivered`,
    };
  }
  return { status: 'OK', detail: `${active.length} active webhook(s) of ${hooks.length}` };
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
  // Minutes-vs-included is NOT a cost signal for this repo and must not
  // drive status. DeclutrMail is a PUBLIC repo, and public repos bill $0 on
  // standard GitHub-hosted runners: GitHub reports
  // `billable.UBUNTU.total_ms: 0` for a run whose `run_duration_ms` is
  // 13,000. Keying WARN off the ratio pinned this row permanently yellow at
  // 574% of an allowance that does not apply — and a guardrail that is always
  // yellow trains the whole column away (see the Upstash note above, which
  // already had to reason around this row as a standing WARN).
  //
  // netAmount is the only figure that tracks real money, and for a repo that
  // should cost exactly $0 the correct alarm threshold is the first cent: any
  // spend at all means something structural changed — the repo was made
  // private (~$76/mo at current volume), or a larger runner was added, which
  // IS billed even on public repos. So this stays BREACH-on-first-cent rather
  // than warning through a dollar band; WARN exits 0 and notifies nobody.
  //
  // `included` still frames the minute count for the private-repo case.
  const status = netUsd > 0 ? 'BREACH' : 'OK';
  const framing =
    netUsd > 0 ? `of ${fmtInt(included)} included` : '— public repo, standard runners bill $0';
  return {
    status,
    costMtdUsd: netUsd,
    usage: { actions_minutes_mtd: minutes },
    // No usagePct: the ratio is meaningless here and renders as a false
    // near-breach percentage in the table.
    detail: `${fmtInt(minutes)} Actions min MTD ${framing}; net spend $${netUsd.toFixed(2)}`,
  };
}

// -------------------------------------------------------------- registry

let gcpSpendPromise;
function gcpSpend() {
  return (gcpSpendPromise ??= checkGcpBillingExport(process.env.GCP_BILLING_EXPORT_TABLE));
}

const VENDORS = [
  {
    name: 'Google Cloud (project charges)',
    requires: ['GOOGLE_APPLICATION_CREDENTIALS', 'GCP_BILLING_EXPORT_TABLE'],
    check: gcpSpend,
  },
  { name: 'Supabase (DB size)', requires: ['SUPABASE_SESSION_DSN'], check: checkSupabaseDbSize },
  {
    name: 'Google Cloud (budgets)',
    requires: ['GOOGLE_APPLICATION_CREDENTIALS', 'GCP_BILLING_ACCOUNT_ID'],
    check: checkGcpBudgets,
  },
  { name: 'Upstash Redis', requires: ['UPSTASH_EMAIL', 'UPSTASH_API_KEY'], check: checkUpstash },
  {
    name: 'Anthropic',
    requires: ['ANTHROPIC_ADMIN_KEY'],
    check: checkAnthropic,
  },
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
  // Billing providers (D117, ADR-0023): revenue vendors — the check
  // guards webhook-delivery health, not spend (see each check's note).
  { name: 'Paddle (webhooks)', requires: ['PADDLE_API_KEY'], check: checkPaddle },
  {
    name: 'Razorpay (webhooks)',
    requires: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'],
    check: checkRazorpay,
  },
];

/**
 * The row for a check that threw. Causes it measured before the throw
 * (readKeeping) stay causes of their own beside the error, so a line
 * acknowledging the error cannot also cover them.
 */
function errorRow(name, detail, err) {
  const measured = err?.measuredCauses ?? [];
  if (!measured.length) return { name, status: 'ERROR', detail };
  const causes = [...measured, { status: 'ERROR', text: detail }];
  return { name, status: 'ERROR', detail: causes.map((c) => c.text).join('; '), causes };
}

export async function runVendor(vendor) {
  const missing = vendor.requires.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return { name: vendor.name, status: 'UNCONFIGURED', detail: `missing ${missing.join(', ')}` };
  }
  try {
    return { name: vendor.name, ...(await vendor.check()) };
  } catch (err) {
    if (!isTimeout(err)) {
      // A genuine config/auth/parse failure. Loud, immediately.
      return errorRow(vendor.name, String(err?.message ?? err).slice(0, 300), err);
    }
    // A timeout MIGHT be a transient blip — so find out instead of assuming.
    // One retry is the whole test: a real blip succeeds on the second try,
    // and anything that times out twice in a row is not transient, it is an
    // observability outage for a metered vendor.
    //
    // This used to assume rather than test, and stamped every timeout
    // "transient:". Vercel then timed out on EIGHT consecutive runs across
    // three days while the table reported a reassuring yellow, because the
    // word made a standing outage read like weather. Same defect as the
    // GitHub Actions row above: a status that could not distinguish a real
    // state from a null one.
    try {
      const res = await vendor.check();
      // Surface the retry: a vendor that needs a second attempt is flaky,
      // and that is worth seeing before it becomes a standing outage.
      return { name: vendor.name, ...res, detail: `${res.detail} [slow — succeeded on retry]` };
    } catch (err2) {
      // ERROR, not WARN. WARN and BREACH are judgments ABOUT A MEASURED
      // VALUE; ERROR is the absence of one. Two timeouts produced no value,
      // so grading this WARN would file "never read it" alongside "read it,
      // it is fine" — and WARN exits 0, so the run reports SUCCESS and
      // GitHub sends nothing. That is the watchdog telling exactly the lie
      // it exists to catch: a green signal standing in for a check that
      // never happened.
      //
      // The anti-red-training argument that used to live here ("a
      // chronically slow vendor API must not turn the run red daily") was
      // calibrated to a world where Vercel timed out most days against the
      // 10s budget shared by every call in this file. The per-vendor
      // timeout above removed that world: Vercel now answers on the FIRST
      // attempt inside 45s. A double timeout is exceptional again, and
      // failing to read a metered vendor's spend is precisely what should
      // exit 1.
      // Whichever attempt got further keeps what it measured: a retry that
      // fails earlier must not drop a suspension the first attempt saw.
      const further =
        (err2?.measuredCauses?.length ?? 0) >= (err?.measuredCauses?.length ?? 0) ? err2 : err;
      return errorRow(
        vendor.name,
        `${isTimeout(err2) ? 'unreachable — timed out twice' : 'timed out, then failed on retry'}, value NOT verified: ${String(err2?.message ?? err2).slice(0, 240)}`,
        further,
      );
    }
  }
}

// ---------------------------------------------------------- known issues

const FAILING_STATUSES = ['WARN', 'BREACH', 'ERROR'];
/** Longest an acknowledgment may run: long enough to fix, short enough to re-read. */
const MAX_ACK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parses scripts/known-vendor-issues.tsv. Refuses anything it cannot use: a
 * misspelt vendor or an OK status never matches a row, an empty
 * `cause_contains` matches every cause, a ceiling that is not a number
 * bounds nothing, and a date years out never expires. Each would read as a
 * careful acknowledgment while muting more than anyone looked at.
 */
export function parseKnownIssues(text, vendorNames, { today }) {
  const known = [];
  const latest = new Date(Date.parse(`${today}T00:00:00Z`) + MAX_ACK_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  text.split('\n').forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    const [vendor, status, contains, upTo, until, note, ...extra] = line.split('\t');
    const ceiling =
      upTo === '-' ? null : /^\d+(\.\d+)?$/.test(upTo ?? '') ? Number(upTo) : undefined;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(until ?? '') ? new Date(`${until}T00:00:00Z`) : null;
    const valid =
      vendorNames.includes(vendor) &&
      FAILING_STATUSES.includes(status) &&
      Boolean(contains?.trim()) &&
      ceiling !== undefined &&
      date !== null &&
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === until &&
      Boolean(note?.trim()) &&
      extra.length === 0;
    if (!valid)
      throw new Error(
        `line ${i + 1}: expected vendor<TAB>WARN|BREACH|ERROR<TAB>cause_contains<TAB>up_to (a number, or - for a cause with no measured value)<TAB>acknowledged_until (YYYY-MM-DD)<TAB>note, naming a vendor this script checks`,
      );
    if (until > latest)
      throw new Error(
        `line ${i + 1}: acknowledged_until ${until} is more than ${MAX_ACK_DAYS} days after ${today}`,
      );
    if (known.some((k) => k.vendor === vendor && k.status === status && k.contains === contains))
      throw new Error(`line ${i + 1}: ${vendor} ${status} "${contains}" is listed twice`);
    known.push({ line: i + 1, vendor, status, contains, upTo: ceiling, until, note: note.trim() });
  });
  return known;
}

const fails = (status, warnIsFailure) =>
  status === 'BREACH' || status === 'ERROR' || (warnIsFailure && status === 'WARN');

/**
 * The failing causes behind a failing row. A check that joins independent
 * causes into one detail reports them separately; any other row is one
 * cause, its detail, valued at its month-to-date cost when it has one. A
 * failing row that names no failing cause is still one cause: it is never
 * waved through with nothing checked.
 */
function failingCauses(r, warnIsFailure) {
  const listed = (r.causes ?? []).filter((c) => fails(c.status, warnIsFailure));
  return listed.length
    ? listed
    : [{ status: r.status, text: String(r.detail ?? ''), value: r.costMtdUsd }];
}

/**
 * Splits failing rows into acknowledged and not. A row is acknowledged only
 * when every one of its failing causes is: by a line for its vendor and
 * status whose text the cause contains, through the line's date, and at or
 * under the line's ceiling. A measured cause needs a numeric ceiling, and a
 * cause with no measured value needs `-`. A line whose text matches
 * several of a row's causes, failing or not, holds none of them. Lines that
 * matched no failing cause come back as `unmatched`, to be deleted.
 */
export function triage(results, known, { today, warnIsFailure = false }) {
  const failing = [];
  const acknowledged = [];
  const used = new Set();
  for (const r of results) {
    if (!fails(r.status, warnIsFailure)) continue;
    const open = [];
    const covered = [];
    const causes = failingCauses(r, warnIsFailure);
    const matching = (cause) =>
      known.filter(
        (k) => k.vendor === r.name && k.status === cause.status && cause.text.includes(k.contains),
      );
    // A line whose text names more than one of the row's causes holds none
    // of them, whether the others fail this run or not. One ceiling cannot
    // bound a spend projection and a command count at once, and text that
    // covers two suspended databases would cover the next one too.
    const listed = r.causes ?? [];
    const pool = listed.some((c) => fails(c.status, warnIsFailure)) ? listed : causes;
    const reach = (k) => pool.filter((c) => c.text.includes(k.contains)).length;
    for (const cause of causes) {
      const matches = matching(cause);
      for (const k of matches) used.add(k);
      // A ceiling bounds a measured value, and `-` is for a cause with none:
      // a `-` line on a measured cause would hold at any size (#795 review).
      const measured = Number.isFinite(cause.value);
      const holds = (k) =>
        reach(k) === 1 && (k.upTo === null ? !measured : measured && cause.value <= k.upTo);
      // When several lines name one cause, the tightest ceiling decides: a
      // broader line must not override a limit someone wrote down.
      const inDate = matches.filter((k) => today <= k.until);
      const refusing = inDate.find((k) => !holds(k));
      if (inDate.length && !refusing) {
        covered.push({ cause, line: inDate[0] });
        continue;
      }
      open.push({
        cause,
        why: !refusing
          ? matches.length
            ? `acknowledgment expired ${matches[0].until}`
            : 'not acknowledged'
          : reach(refusing) > 1
            ? `line ${refusing.line} matches ${reach(refusing)} causes in this row; make its text name one`
            : refusing.upTo === null
              ? `is measured, so line ${refusing.line} needs a number in up_to, not -`
              : measured
                ? `above the acknowledged ${refusing.upTo} (line ${refusing.line})`
                : `has no measured value, so the ceiling ${refusing.upTo} on line ${refusing.line} cannot hold`,
      });
    }
    if (open.length) failing.push({ ...r, open });
    else acknowledged.push({ ...r, covered });
  }
  return { failing, acknowledged, unmatched: known.filter((k) => !used.has(k)) };
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

  if (process.env.INFRA_SNAPSHOT_PATH) {
    writeFileSync(
      process.env.INFRA_SNAPSHOT_PATH,
      JSON.stringify(makeSnapshot(results), null, 2) + '\n',
      { mode: 0o600 },
    );
  }
  const table = toMarkdown(results);
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
  }

  // Read on every run, failing rows or not, so a broken list fails the day
  // it lands instead of the day the next vendor breaches. A broken list
  // acknowledges nothing: the failing rows are still named below.
  const today = new Date().toISOString().slice(0, 10);
  const listPath =
    process.env.KNOWN_VENDOR_ISSUES_FILE ||
    fileURLToPath(new URL('./known-vendor-issues.tsv', import.meta.url));
  let known = [];
  let listBroken = false;
  try {
    known = parseKnownIssues(
      readFileSync(listPath, 'utf8'),
      VENDORS.map((v) => v.name),
      { today },
    );
  } catch (err) {
    listBroken = true;
    console.log(
      `::error title=Known vendor issues list unreadable::${listPath}: ${err.message} — the watchdog cannot tell known vendor issues from new ones.`,
    );
  }
  const { failing, acknowledged, unmatched } = triage(results, known, {
    today,
    warnIsFailure: process.env.WARN_IS_FAILURE === 'true',
  });
  const ackLabel = (k) =>
    `"${k.contains}"${k.upTo === null ? '' : ` up to ${k.upTo}`} until ${k.until}`;
  for (const r of acknowledged) {
    for (const { cause, line } of r.covered) {
      console.log(
        `::warning title=Known vendor issue::${r.name} (${cause.status}) — ${ackLabel(line)}: ${line.note}`,
      );
    }
  }
  // A leftover entry would quietly cover the same cause if it came back.
  for (const k of unmatched) {
    console.log(
      `::warning title=Known vendor issue not failing::line ${k.line} (${k.vendor} ${k.status}) matched nothing this run — delete it once the issue is fixed.`,
    );
  }
  if (acknowledged.length > 0 && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Acknowledged in scripts/known-vendor-issues.tsv, not failing this run: ${acknowledged
        .flatMap((r) => r.covered.map(({ line }) => `${r.name} ${ackLabel(line)}`))
        .join('; ')}\n`,
    );
  }
  if (failing.length > 0) {
    // `::error::` surfaces as a red annotation on the Actions run.
    console.log(
      `::error::Vendor limits watchdog failing: ${failing
        .flatMap((r) =>
          r.open.map(({ cause, why }) => `${r.name} (${cause.status}): ${cause.text} — ${why}`),
        )
        .join('; ')}`,
    );
  }
  if (listBroken) process.exit(2);
  if (failing.length > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
