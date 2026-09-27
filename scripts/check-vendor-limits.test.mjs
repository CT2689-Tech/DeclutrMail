import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkPosthog,
  checkSentry,
  checkUpstash,
  parseKnownIssues,
  triage,
} from './check-vendor-limits.mjs';
import { budgetStatus } from './gcp-budget-status.mjs';

const VENDORS = ['Anthropic', 'Google Cloud (budgets)', 'Sentry', 'Upstash Redis', 'PostHog'];
const TODAY = '2026-09-26';
const ADMIN_KEY = 'The Admin API requires an Admin API key';
const LIST = [
  '# vendor\tstatus\tcause_contains\tup_to\tacknowledged_until\tnote',
  '',
  `Anthropic\tERROR\t${ADMIN_KEY}\t-\t2026-10-26\tno Admin API key; see FOUNDER-FOLLOWUPS 2026-08-29`,
  '',
].join('\n');
const parse = (text, today = TODAY) => parseKnownIssues(text, VENDORS, { today });

// The rows the scheduled run produced on 2026-09-26 (details shortened).
const RUN_2026_09_26 = [
  {
    name: 'Anthropic',
    status: 'ERROR',
    detail: `HTTP 401 from api.anthropic.com: "${ADMIN_KEY} or an organization-scoped API key."`,
  },
  { name: 'Google Cloud (budgets)', status: 'BREACH', detail: '$84.21 accrued / $20.00 budget' },
  { name: 'Sentry', status: 'BREACH', detail: 'quota/rate limited (errors being dropped): 23' },
  { name: 'Upstash Redis', status: 'OK', detail: 'projecting $10.12 against a $30.00 cap' },
];

function names(rows) {
  return rows.map((r) => `${r.name} (${r.status})`);
}

test('new breaches fail the run while the long-standing known one only warns', () => {
  // 2026-09-24/25: Sentry and the GCP budget breached while Anthropic's
  // standing ERROR already held the run red, so nothing anyone saw changed.
  const { failing, acknowledged } = triage(RUN_2026_09_26, parse(LIST), { today: TODAY });
  assert.deepEqual(names(failing), ['Google Cloud (budgets) (BREACH)', 'Sentry (BREACH)']);
  assert.deepEqual(names(acknowledged), ['Anthropic (ERROR)']);
  assert.equal(acknowledged[0].covered[0].line.until, '2026-10-26');
});

test('only acknowledged issues: nothing fails', () => {
  const rows = [RUN_2026_09_26[0], RUN_2026_09_26[3]];
  assert.deepEqual(triage(rows, parse(LIST), { today: TODAY }).failing, []);
});

test('an acknowledgment covers only the cause it names', () => {
  const known = parse(
    `${LIST}Upstash Redis\tBREACH\tcommands today\t-\t2026-10-03\tqueue backfill, founder watching\n`,
  );
  const rows = [
    // Same vendor and status, different cause: the check could not run at all.
    { name: 'Anthropic', status: 'ERROR', detail: 'unreachable — timed out twice' },
    // The 2026-07-15 outage shape behind an acknowledged volume spike.
    { name: 'Upstash Redis', status: 'BREACH', detail: 'declutrmail-v2-bullmq: state=suspended' },
  ];
  assert.deepEqual(names(triage(rows, known, { today: TODAY }).failing), [
    'Anthropic (ERROR)',
    'Upstash Redis (BREACH)',
  ]);
  const spike = [{ name: 'Upstash Redis', status: 'BREACH', detail: '3,414,878 commands today' }];
  assert.deepEqual(triage(spike, known, { today: TODAY }).failing, []);
});

test('a known vendor in a different failing status is new', () => {
  const rows = [{ name: 'Anthropic', status: 'BREACH', detail: `$212 MTD; ${ADMIN_KEY}` }];
  assert.deepEqual(names(triage(rows, parse(LIST), { today: TODAY }).failing), [
    'Anthropic (BREACH)',
  ]);
});

test('an acknowledgment stops holding the day after it expires', () => {
  const known = parse(LIST);
  const row = [RUN_2026_09_26[0]];
  assert.deepEqual(triage(row, known, { today: '2026-10-26' }).failing, []);
  const { failing } = triage(row, known, { today: '2026-10-27' });
  assert.deepEqual(names(failing), ['Anthropic (ERROR)']);
  assert.equal(failing[0].open[0].why, 'acknowledgment expired 2026-10-26');
});

test('an acknowledgment cannot be dated more than 30 days ahead', () => {
  const line = (until) => `Sentry\tBREACH\tquota\t-\t${until}\tquiet it\n`;
  assert.doesNotThrow(() => parse(line('2026-10-26')));
  for (const until of ['2026-10-27', '9999-12-31']) {
    assert.throws(() => parse(line(until)), /line 1: .*30 days/, until);
  }
});

test('an acknowledgment that matched nothing is reported, so it gets deleted', () => {
  const { unmatched } = triage([RUN_2026_09_26[3]], parse(LIST), { today: TODAY });
  assert.deepEqual(
    unmatched.map((k) => `${k.vendor} ${k.status}`),
    ['Anthropic ERROR'],
  );
});

test('WARN fails only when WARN_IS_FAILURE is set, as before', () => {
  const rows = [{ name: 'Sentry', status: 'WARN', detail: '1,200 events' }];
  const known = parse(LIST);
  assert.deepEqual(triage(rows, known, { today: TODAY }).failing, []);
  assert.deepEqual(names(triage(rows, known, { today: TODAY, warnIsFailure: true }).failing), [
    'Sentry (WARN)',
  ]);
});

test('a malformed entry is refused and names its line', () => {
  for (const bad of [
    'Anthropic\tERROR\tadmin\t-\t2026-10-26', // no note
    `Anthropic\tERROR\t-\t2026-10-26\tno cause column`,
    'Anthropic\tERROR\t\t-\t2026-10-26\tempty cause matches everything',
    'Anthropc\tERROR\tadmin\t-\t2026-10-26\ttypo never matches a vendor',
    'Sentry\tOK\tquota\t-\t2026-10-26\tOK never fails, so it cannot be acknowledged',
    'Sentry\tBREACH\tquota\t-\t26-10-2026\tdate format',
    'Sentry\tBREACH\tquota\tlots\t2026-10-26\ta ceiling that is not a number bounds nothing',
    'Sentry\tBREACH\tquota\t\t2026-10-26\tan empty ceiling is not "none"; write -',
    'Sentry\tBREACH\tquota\t2026-10-26\tthe old five-column form has no ceiling',
    'Sentry BREACH quota - 2026-10-26 spaces, not tabs',
    `Sentry\tBREACH\tquota\t-\t2026-10-01\tfirst\nSentry\tBREACH\tquota\t1000\t2026-10-02\tduplicate`,
  ]) {
    assert.throws(() => parse(`# header\n${bad}\n`), /line [23]/, bad);
  }
});

function cli(listPath) {
  // No vendor credentials: every vendor is UNCONFIGURED, so no network.
  return spawnSync(process.execPath, ['scripts/check-vendor-limits.mjs'], {
    env: { PATH: process.env.PATH, ...(listPath ? { KNOWN_VENDOR_ISSUES_FILE: listPath } : {}) },
    encoding: 'utf8',
  });
}

test('a missing or malformed list fails the run even when no vendor is failing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'known-vendor-'));
  const bad = join(dir, 'bad.tsv');
  writeFileSync(bad, 'Sentry BREACH\n');
  for (const path of [join(dir, 'missing.tsv'), bad]) {
    const run = cli(path);
    assert.equal(run.status, 2, run.stdout + run.stderr);
    assert.match(run.stdout, /::error title=Known vendor issues list/);
  }
});

test('the committed list is well formed', () => {
  const run = cli();
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

/** Runs a real vendor check against canned API responses, keyed by URL prefix. */
async function withFetch(routes, env, check) {
  const realFetch = globalThis.fetch;
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  globalThis.fetch = async (url) => {
    const hit = Object.entries(routes).find(([prefix]) => String(url).startsWith(prefix));
    if (!hit) throw new Error(`no canned response for ${url}`);
    return new Response(JSON.stringify(hit[1]), { status: 200 });
  };
  try {
    return await check();
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const UPSTASH = { UPSTASH_EMAIL: 'ops@example.com', UPSTASH_API_KEY: 'key' };
const UPSTASH_DBS = 'https://api.upstash.com/v2/redis/databases';
const UPSTASH_STATS = 'https://api.upstash.com/v2/redis/stats/';
const prodDb = {
  database_id: 'db1',
  database_name: 'declutrmail-v2-bullmq',
  state: 'active',
  budget: 30,
};
const openCauses = (result) => result.failing.flatMap((r) => r.open.map((o) => o.cause.text));

test('acknowledging Upstash volume no longer hides the spend projection that predicts a suspension', async () => {
  // #782 review: every active row's detail ends with "N commands today", so a
  // line for a volume spike also covered the spend BREACH that, on
  // 2026-07-25, came before the production database was suspended.
  const row = {
    name: 'Upstash Redis',
    ...(await withFetch(
      {
        [UPSTASH_DBS]: [prodDb],
        [UPSTASH_STATS]: {
          daily_net_commands: 137114,
          current_storage: 12_900_000,
          total_monthly_billing: 29.5,
        },
      },
      UPSTASH,
      checkUpstash,
    )),
  };
  assert.equal(row.status, 'BREACH');
  assert.match(row.detail, /commands today/);
  const known = parse(
    `${LIST}Upstash Redis\tBREACH\tcommands today\t-\t2026-10-03\tvolume spike, watching\n`,
  );
  const result = triage([row], known, { today: TODAY });
  assert.equal(openCauses(result).length, 1);
  assert.match(
    openCauses(result)[0],
    /^declutrmail-v2-bullmq: projecting \$[\d.]+ against a \$30\.00 cap$/,
  );
});

test('each suspended Upstash database is its own cause', async () => {
  const dbs = [
    { ...prodDb, database_name: 'staging-cache', state: 'suspended' },
    { ...prodDb, state: 'suspended' },
  ];
  const row = {
    name: 'Upstash Redis',
    ...(await withFetch({ [UPSTASH_DBS]: dbs }, UPSTASH, checkUpstash)),
  };
  const known = parse(
    `${LIST}Upstash Redis\tBREACH\tstaging-cache: state=suspended\t-\t2026-10-03\tstaging, being deleted\n`,
  );
  assert.deepEqual(openCauses(triage([row], known, { today: TODAY })), [
    'declutrmail-v2-bullmq: state=suspended',
  ]);
});

test('each GCP budget is its own cause, and a ceiling bounds month-to-date spend', () => {
  const budget = (units, displayName) => ({
    displayName,
    amount: { specifiedAmount: { currencyCode: 'USD', units } },
    budgetFilter: {
      calendarPeriod: 'MONTH',
      projects: ['projects/387835380133'],
      creditTypesTreatment: 'INCLUDE_ALL_CREDITS',
    },
  });
  const spend = (costMtdUsd) => ({
    status: 'OK',
    costMtdUsd,
    budgetPeriodStart: Date.parse('2026-09-01T07:00:00Z'),
    budgetPeriodEnd: Date.parse('2026-10-01T07:00:00Z'),
  });
  const now = new Date('2026-09-24T12:00:00Z');
  const row = (mtd, budgets) => ({
    name: 'Google Cloud (budgets)',
    ...budgetStatus(budgets, spend(mtd), now),
  });
  const known = parse(
    `${LIST}Google Cloud (budgets)\tBREACH\t$20.00 budget\t100\t2026-10-26\tbudget being resized\n`,
  );
  // One budget acknowledged; a second budget breaching is not covered by it.
  const two = triage([row(84.21, [budget('20', 'main'), budget('50', 'second')])], known, {
    today: TODAY,
  });
  assert.deepEqual(
    openCauses(two).map((t) => t.split(':')[0]),
    ['second'],
  );
  // The 2026-09-26 figure is within the ceiling; $1,900 is not.
  assert.deepEqual(
    triage([row(84.21, [budget('20', 'main')])], known, { today: TODAY }).failing,
    [],
  );
  const over = triage([row(1900, [budget('20', 'main')])], known, { today: TODAY });
  assert.match(over.failing[0].open[0].why, /above the acknowledged 100 \(line \d+\)/);
});

const SENTRY = { SENTRY_ORG: 'declutrmail', SENTRY_AUTH_TOKEN: 'token' };
const outcome = (name, n) => ({ by: { outcome: name }, totals: { 'sum(quantity)': n } });
const sentryRow = async (groups) => ({
  name: 'Sentry',
  ...(await withFetch({ 'https://sentry.io/api/0/': { groups } }, SENTRY, checkSentry)),
});

test('a Sentry acknowledgment holds up to its ceiling and not past it', async () => {
  // #782 review: "quota/rate limited" stayed green from 23 to 480,112 dropped errors.
  const known = parse(
    `${LIST}Sentry\tBREACH\tquota/rate limited\t1000\t2026-10-26\tquota raise requested\n`,
  );
  const dropped = (n) => sentryRow([outcome('accepted', 500), outcome('rate_limited', n)]);
  assert.deepEqual(triage([await dropped(23)], known, { today: TODAY }).failing, []);
  const over = triage([await dropped(480112)], known, { today: TODAY });
  assert.match(over.failing[0].open[0].why, /above the acknowledged 1000/);
});

test('a ceiling never holds for a cause with no measured value', async () => {
  const row = {
    name: 'Upstash Redis',
    ...(await withFetch(
      { [UPSTASH_DBS]: [{ ...prodDb, state: 'suspended' }] },
      UPSTASH,
      checkUpstash,
    )),
  };
  const known = parse(
    `${LIST}Upstash Redis\tBREACH\tstate=suspended\t5\t2026-10-03\tno number to bound\n`,
  );
  assert.match(
    triage([row], known, { today: TODAY }).failing[0].open[0].why,
    /above the acknowledged 5/,
  );
});

test('a WARN cause in a BREACH row needs acknowledging only when WARN fails the run', async () => {
  const row = await sentryRow([outcome('accepted', 2500), outcome('client_discard', 5)]);
  assert.equal(row.status, 'BREACH');
  const known = parse(
    `${LIST}Sentry\tBREACH\taccepted errors last 24h\t3000\t2026-10-26\terror burst, fixing\n`,
  );
  assert.deepEqual(triage([row], known, { today: TODAY }).failing, []);
  assert.deepEqual(openCauses(triage([row], known, { today: TODAY, warnIsFailure: true })), [
    '5 invalid/client-discarded',
  ]);
});

test('each PostHog quota is its own cause', async () => {
  const row = {
    name: 'PostHog',
    ...(await withFetch(
      {
        'https://us.posthog.com/api/projects/1/quota_limits/': {
          events: true,
          recordings: { limited: true },
        },
      },
      { POSTHOG_API_KEY: 'key', POSTHOG_PROJECT_ID: '1' },
      checkPosthog,
    )),
  };
  const known = parse(
    `${LIST}PostHog\tBREACH\tdropped): recordings\t-\t2026-10-26\trecordings are off\n`,
  );
  assert.deepEqual(openCauses(triage([row], known, { today: TODAY })), [
    'quota-limited (data being dropped): events',
  ]);
});

test('a failing row whose causes name nothing failing is still checked as one cause', () => {
  // Never wave a failing row through with nothing checked.
  const row = {
    name: 'Sentry',
    status: 'BREACH',
    detail: 'dropped 5',
    causes: [{ status: 'OK', text: 'fine' }],
  };
  assert.deepEqual(openCauses(triage([row], parse(LIST), { today: TODAY })), ['dropped 5']);
});
