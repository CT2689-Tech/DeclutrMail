import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseKnownIssues, triage } from './check-vendor-limits.mjs';

const VENDORS = ['Anthropic', 'Google Cloud (budgets)', 'Sentry', 'Upstash Redis'];
const TODAY = '2026-09-26';
const ADMIN_KEY = 'The Admin API requires an Admin API key';
const LIST = [
  '# vendor\tstatus\tdetail_contains\tacknowledged_until\tnote',
  '',
  `Anthropic\tERROR\t${ADMIN_KEY}\t2026-10-26\tno Admin API key; see FOUNDER-FOLLOWUPS 2026-08-29`,
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
  assert.equal(acknowledged[0].until, '2026-10-26');
});

test('only acknowledged issues: nothing fails', () => {
  const rows = [RUN_2026_09_26[0], RUN_2026_09_26[3]];
  assert.deepEqual(triage(rows, parse(LIST), { today: TODAY }).failing, []);
});

test('an acknowledgment covers only the cause it names', () => {
  const known = parse(
    `${LIST}Upstash Redis\tBREACH\tcommands today\t2026-10-03\tqueue backfill, founder watching\n`,
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
  assert.equal(failing[0].expired, '2026-10-26');
});

test('an acknowledgment cannot be dated more than 30 days ahead', () => {
  const line = (until) => `Sentry\tBREACH\tquota\t${until}\tquiet it\n`;
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
    'Anthropic\tERROR\tadmin\t2026-10-26', // no note
    `Anthropic\tERROR\t2026-10-26\tno detail column`,
    'Anthropic\tERROR\t\t2026-10-26\tempty detail matches everything',
    'Anthropc\tERROR\tadmin\t2026-10-26\ttypo never matches a vendor',
    'Sentry\tOK\tquota\t2026-10-26\tOK never fails, so it cannot be acknowledged',
    'Sentry\tBREACH\tquota\t26-10-2026\tdate format',
    'Sentry BREACH quota 2026-10-26 spaces, not tabs',
    `Sentry\tBREACH\tquota\t2026-10-01\tfirst\nSentry\tBREACH\tquota\t2026-10-02\tduplicate`,
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
