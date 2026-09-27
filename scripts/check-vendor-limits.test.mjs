import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkPosthog,
  checkSentry,
  checkUpstash,
  parseKnownIssues,
  runVendor,
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

function cli(listPath, env = {}) {
  // No vendor credentials: every vendor is UNCONFIGURED, so no network.
  return spawnSync(process.execPath, ['scripts/check-vendor-limits.mjs'], {
    env: {
      PATH: process.env.PATH,
      ...(listPath ? { KNOWN_VENDOR_ISSUES_FILE: listPath } : {}),
      ...env,
    },
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
    if (hit[1] instanceof Error) throw hit[1];
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
    `${LIST}Upstash Redis\tBREACH\tcommands today\t5000000\t2026-10-03\tvolume spike, watching\n`,
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
    /no measured value, so the ceiling 5 on line \d+ cannot hold/,
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

const POSTHOG = { POSTHOG_API_KEY: 'key', POSTHOG_PROJECT_ID: '1' };
const posthogRow = async (quota, events) => ({
  name: 'PostHog',
  ...(await withFetch(
    {
      'https://us.posthog.com/api/projects/1/quota_limits/': quota,
      'https://us.posthog.com/api/projects/1/query/': { results: [[events]] },
    },
    POSTHOG,
    checkPosthog,
  )),
});

test('each PostHog quota is its own cause, and the events gauge still runs', async () => {
  const known = parse(
    `${LIST}PostHog\tBREACH\tdropped): recordings\t-\t2026-10-26\trecordings are off\n`,
  );
  const both = await posthogRow({ events: true, recordings: { limited: true } }, 10);
  assert.deepEqual(openCauses(triage([both], known, { today: TODAY })), [
    'quota-limited (data being dropped): events',
  ]);
  // #795 review: acknowledging the recordings quota also skipped the events gauge.
  const volume = await posthogRow({ recordings: { limited: true } }, 5_000_000);
  assert.deepEqual(openCauses(triage([volume], known, { today: TODAY })), [
    'MTD events 5,000,000 (warn 1,000,000)',
  ]);
});

test('acknowledged dropped Sentry errors do not hide an accepted-error breach', async () => {
  // #795 review: the dropped branch returned before accepted volume was gauged.
  const row = await sentryRow([outcome('accepted', 50_000), outcome('rate_limited', 500)]);
  const known = parse(
    `${LIST}Sentry\tBREACH\tquota/rate limited\t1000\t2026-10-26\tquota raise requested\n`,
  );
  assert.deepEqual(openCauses(triage([row], known, { today: TODAY })), [
    '50,000 accepted errors last 24h (warn 1,000)',
  ]);
});

test('acknowledging a suspended staging database does not stop the checks on prod', async () => {
  // #795 review: any suspended database made the check return before prod was gauged.
  const row = {
    name: 'Upstash Redis',
    ...(await withFetch(
      {
        [UPSTASH_DBS]: [prodDb, { ...prodDb, database_name: 'staging-cache', state: 'suspended' }],
        [UPSTASH_STATS]: {
          daily_net_commands: 5_000_000,
          current_storage: 1,
          total_monthly_billing: 29.99,
        },
      },
      UPSTASH,
      checkUpstash,
    )),
  };
  const known = parse(
    `${LIST}Upstash Redis\tBREACH\tstaging-cache: state=suspended\t-\t2026-10-03\tstaging, being deleted\n`,
  );
  const open = openCauses(triage([row], known, { today: TODAY }));
  assert.equal(open.length, 2);
  assert.match(open[0], /^declutrmail-v2-bullmq: projecting \$[\d.]+ against a \$30\.00 cap$/);
  assert.equal(open[1], 'declutrmail-v2-bullmq: 5,000,000 commands today (warn 1,000,000)');
});

test('when two lines name one cause, the tightest ceiling decides', () => {
  // #795 review: a broad line with no ceiling silently overrode a narrower one's.
  const known = parse(
    `${LIST}Sentry\tBREACH\tquota/rate limited (errors being dropped)\t1000\t2026-10-26\tquota raise requested\nSentry\tBREACH\tquota\t-\t2026-10-26\tbroad\n`,
  );
  const row = {
    name: 'Sentry',
    status: 'BREACH',
    detail: 'x',
    causes: [
      {
        status: 'BREACH',
        text: 'quota/rate limited (errors being dropped): 480,112 in last 24h',
        value: 480_112,
      },
    ],
  };
  assert.match(
    triage([row], known, { today: TODAY }).failing[0].open[0].why,
    /above the acknowledged 1000/,
  );
});

test("the list header's example lines acknowledge the 2026-09-26 breaches exactly", async () => {
  // The lines the PR and FOUNDER-FOLLOWUPS tell the founder to uncomment.
  const examples = readFileSync(new URL('./known-vendor-issues.tsv', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^# (Sentry|Google Cloud \(budgets\))\t/.test(l))
    .map((l) => l.slice(2));
  assert.equal(examples.length, 2);
  const known = parse(`${examples.join('\n')}\n`);
  const budget = (units, displayName) => ({
    displayName,
    amount: { specifiedAmount: { currencyCode: 'USD', units } },
    budgetFilter: {
      calendarPeriod: 'MONTH',
      projects: ['projects/387835380133'],
      creditTypesTreatment: 'INCLUDE_ALL_CREDITS',
    },
  });
  const spend = {
    status: 'OK',
    costMtdUsd: 84.21,
    budgetPeriodStart: Date.parse('2026-09-01T07:00:00Z'),
    budgetPeriodEnd: Date.parse('2026-10-01T07:00:00Z'),
  };
  const gcp = (budgets) => ({
    name: 'Google Cloud (budgets)',
    ...budgetStatus(budgets, spend, new Date('2026-09-26T12:00:00Z')),
  });
  const rows = [
    gcp([budget('20', 'declutrmail-monthly-alert-20')]),
    await sentryRow([outcome('accepted', 500), outcome('rate_limited', 23)]),
  ];
  assert.deepEqual(triage(rows, known, { today: TODAY }).failing, []);
  // Another $20 budget is not covered by the line that names this one.
  const other = triage(
    [gcp([budget('20', 'declutrmail-monthly-alert-20'), budget('20', 'another-20')])],
    known,
    { today: TODAY },
  );
  assert.deepEqual(
    openCauses(other).map((t) => t.split(':')[0]),
    ['another-20'],
  );
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

/** A vendor row as the run builds it, errors included, against canned API responses. */
const runRow = (name, routes, env, check) =>
  withFetch(routes, env, () => runVendor({ name, requires: Object.keys(env), check }));

test('a failed stats read keeps a suspended database as its own cause', async () => {
  // #795 review: with prod suspended, a second database's stats read failing
  // replaced the suspension, and a line for the read error muted both.
  const routes = {
    [UPSTASH_DBS]: [
      { ...prodDb, state: 'suspended' },
      { ...prodDb, database_id: 'db2', database_name: 'cache' },
    ],
    [UPSTASH_STATS]: { total_monthly_billing: 1 },
  };
  const row = await runRow('Upstash Redis', routes, UPSTASH, checkUpstash);
  assert.equal(row.status, 'ERROR');
  const known = parse(
    `${LIST}Upstash Redis\tERROR\tUpstash stats response missing numeric\t-\t2026-10-02\tfield renamed, fixing\n`,
  );
  assert.deepEqual(openCauses(triage([row], known, { today: TODAY })), [
    'declutrmail-v2-bullmq: state=suspended',
  ]);
  // Two timeouts: the retry's failure keeps the suspension too.
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
    name: 'TimeoutError',
  });
  const slow = await runRow(
    'Upstash Redis',
    { ...routes, [UPSTASH_STATS]: timeout },
    UPSTASH,
    checkUpstash,
  );
  const unreachable = parse(
    `${LIST}Upstash Redis\tERROR\ttimed out twice\t-\t2026-10-02\tUpstash API slow\n`,
  );
  assert.deepEqual(openCauses(triage([slow], unreachable, { today: TODAY })), [
    'declutrmail-v2-bullmq: state=suspended',
  ]);
});

test('a missing volume field keeps the causes measured before it', async () => {
  const known = parse(
    `${LIST}Upstash Redis\tERROR\tUpstash stats response missing numeric\t-\t2026-10-02\tfield renamed, fixing\n`,
  );
  const open = async (stats) =>
    openCauses(
      triage(
        [
          await runRow(
            'Upstash Redis',
            { [UPSTASH_DBS]: [prodDb], [UPSTASH_STATS]: stats },
            UPSTASH,
            checkUpstash,
          ),
        ],
        known,
        { today: TODAY },
      ),
    );
  const spend = /^declutrmail-v2-bullmq: projecting \$[\d.]+ against a \$30\.00 cap$/;
  const noCommands = await open({ current_storage: 1, total_monthly_billing: 29.99 });
  assert.equal(noCommands.length, 1);
  assert.match(noCommands[0], spend);
  const noStorage = await open({ daily_net_commands: 5_000_000, total_monthly_billing: 29.99 });
  assert.equal(noStorage.length, 2);
  assert.match(noStorage[0], spend);
  assert.equal(noStorage[1], 'declutrmail-v2-bullmq: 5,000,000 commands today (warn 1,000,000)');
});

test('a failed events read keeps each PostHog quota as its own cause', async () => {
  // #795 review: the events query failing replaced the quota BREACH.
  const row = await runRow(
    'PostHog',
    {
      'https://us.posthog.com/api/projects/1/quota_limits/': { events: true },
      'https://us.posthog.com/api/projects/1/query/': { results: [] },
    },
    POSTHOG,
    checkPosthog,
  );
  const known = parse(
    `${LIST}PostHog\tERROR\tMissing PostHog events\t-\t2026-10-02\tquery changed, fixing\n`,
  );
  assert.deepEqual(openCauses(triage([row], known, { today: TODAY })), [
    'quota-limited (data being dropped): events',
  ]);
});

test('a capped Upstash database with no billing figure is an ERROR, not OK on volume', async () => {
  // #795 review: a $30 cap, no billing reported and 137,114 commands read "OK 14%".
  const stats = { daily_net_commands: 137114, current_storage: 12_900_000 };
  const row = (db) =>
    withFetch({ [UPSTASH_DBS]: [db], [UPSTASH_STATS]: stats }, UPSTASH, checkUpstash);
  const capped = { name: 'Upstash Redis', ...(await row(prodDb)) };
  assert.equal(capped.status, 'ERROR');
  assert.deepEqual(openCauses(triage([capped], parse(LIST), { today: TODAY })), [
    'declutrmail-v2-bullmq: no billing reported, so its $30.00 cap cannot be gauged',
  ]);
  // A database with no cap has no spend to gauge, and stays OK on volume.
  assert.equal((await row({ ...prodDb, budget: 0, type: 'payg' })).status, 'OK');
});

test('a - line does not hold a measured cause, at any size', async () => {
  // #795 review: "-" held 23 and 480,112 dropped errors alike.
  const known = parse(
    `${LIST}Sentry\tBREACH\tquota/rate limited\t-\t2026-10-26\tno ceiling written\n`,
  );
  const row = await sentryRow([outcome('accepted', 500), outcome('rate_limited', 23)]);
  assert.match(
    triage([row], known, { today: TODAY }).failing[0].open[0].why,
    /^is measured, so line \d+ needs a number in up_to, not -$/,
  );
});

test('a line that matches several failing causes in a row holds none of them', async () => {
  // One ceiling cannot bound dollars and commands at once: a database-name
  // line written for a volume spike also held the spend projection.
  const row = {
    name: 'Upstash Redis',
    ...(await withFetch(
      {
        [UPSTASH_DBS]: [prodDb],
        [UPSTASH_STATS]: {
          daily_net_commands: 3_000_000,
          current_storage: 1,
          total_monthly_billing: 29.99,
        },
      },
      UPSTASH,
      checkUpstash,
    )),
  };
  const byName = parse(
    `${LIST}Upstash Redis\tBREACH\tdeclutrmail-v2-bullmq:\t5000000\t2026-10-03\tvolume spike\n`,
  );
  const open = triage([row], byName, { today: TODAY }).failing[0].open;
  assert.equal(open.length, 2);
  for (const { why } of open) assert.match(why, /^line \d+ matches 2 failing causes in this row/);
  // Text that covers two suspended databases would cover the next one too.
  const suspended = {
    name: 'Upstash Redis',
    ...(await withFetch(
      {
        [UPSTASH_DBS]: [
          { ...prodDb, database_name: 'staging-cache', state: 'suspended' },
          { ...prodDb, state: 'suspended' },
        ],
      },
      UPSTASH,
      checkUpstash,
    )),
  };
  const generic = parse(
    `${LIST}Upstash Redis\tBREACH\tstate=suspended\t-\t2026-10-03\tstaging, being deleted\n`,
  );
  assert.equal(openCauses(triage([suspended], generic, { today: TODAY })).length, 2);
});

test('a missing Supabase usage figure keeps the size as its own cause', () => {
  // The check shells out to psql; a fake one on PATH returns no connection counts.
  const dir = mkdtempSync(join(tmpdir(), 'fake-psql-'));
  writeFileSync(
    join(dir, 'psql'),
    `#!/bin/sh\necho '{"database_bytes": ${1024 * 1024 * 1024}}'\n`,
    { mode: 0o755 },
  );
  const list = join(dir, 'list.tsv');
  writeFileSync(
    list,
    `${LIST}Supabase (DB size)\tERROR\tMissing database connections\t-\t2026-10-26\tquery changed\n`,
  );
  const run = cli(list, {
    PATH: `${dir}:${process.env.PATH}`,
    SUPABASE_SESSION_DSN: 'postgres://fake',
  });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(
    run.stdout,
    /Supabase \(DB size\) \(BREACH\): DB size 1024\.0 MB \(warn 400 MB\) — not acknowledged/,
  );
});
