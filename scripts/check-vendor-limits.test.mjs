import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseKnownIssues, triage } from './check-vendor-limits.mjs';

const VENDORS = ['Anthropic', 'Google Cloud (budgets)', 'Sentry', 'Upstash Redis'];
const LIST = [
  '# vendor\tstatus\tacknowledged_until\tnote',
  '',
  'Anthropic\tERROR\t2026-10-26\tno Admin API key; see FOUNDER-FOLLOWUPS 2026-08-29',
  '',
].join('\n');
const TODAY = '2026-09-26';

// The rows the scheduled run produced on 2026-09-26 (details shortened).
const RUN_2026_09_26 = [
  { name: 'Anthropic', status: 'ERROR', detail: 'HTTP 401 from api.anthropic.com' },
  { name: 'Google Cloud (budgets)', status: 'BREACH', detail: '$84.21 accrued / $20.00 budget' },
  { name: 'Sentry', status: 'BREACH', detail: 'quota/rate limited (errors being dropped)' },
  { name: 'Upstash Redis', status: 'OK', detail: 'projecting $10.12 against a $30.00 cap' },
];

function names(rows) {
  return rows.map((r) => `${r.name} (${r.status})`);
}

test('new breaches fail the run while the long-standing known one only warns', () => {
  // 2026-09-24/25: Sentry and the GCP budget breached while Anthropic's
  // standing ERROR already held the run red, so nothing anyone saw changed.
  const { failing, acknowledged } = triage(RUN_2026_09_26, parseKnownIssues(LIST, VENDORS), {
    today: TODAY,
  });
  assert.deepEqual(names(failing), ['Google Cloud (budgets) (BREACH)', 'Sentry (BREACH)']);
  assert.deepEqual(names(acknowledged), ['Anthropic (ERROR)']);
  assert.equal(acknowledged[0].until, '2026-10-26');
});

test('only acknowledged issues: nothing fails', () => {
  const { failing } = triage(
    [RUN_2026_09_26[0], RUN_2026_09_26[3]],
    parseKnownIssues(LIST, VENDORS),
    {
      today: TODAY,
    },
  );
  assert.deepEqual(failing, []);
});

test('a known vendor in a different failing status is new', () => {
  const rows = [{ name: 'Anthropic', status: 'BREACH', detail: '$212 MTD' }];
  const { failing } = triage(rows, parseKnownIssues(LIST, VENDORS), { today: TODAY });
  assert.deepEqual(names(failing), ['Anthropic (BREACH)']);
});

test('an acknowledgment stops holding the day after it expires', () => {
  const known = parseKnownIssues(LIST, VENDORS);
  assert.deepEqual(triage([RUN_2026_09_26[0]], known, { today: '2026-10-26' }).failing, []);
  const { failing } = triage([RUN_2026_09_26[0]], known, { today: '2026-10-27' });
  assert.deepEqual(names(failing), ['Anthropic (ERROR)']);
  assert.equal(failing[0].expired, '2026-10-26');
});

test('WARN fails only when WARN_IS_FAILURE is set, as before', () => {
  const rows = [{ name: 'Sentry', status: 'WARN', detail: '1,200 events' }];
  const known = parseKnownIssues(LIST, VENDORS);
  assert.deepEqual(triage(rows, known, { today: TODAY }).failing, []);
  assert.deepEqual(names(triage(rows, known, { today: TODAY, warnIsFailure: true }).failing), [
    'Sentry (WARN)',
  ]);
});

test('a malformed entry is refused and names its line', () => {
  for (const bad of [
    'Anthropic\tERROR\t2026-10-26', // no note
    'Anthropc\tERROR\t2026-10-26\ttypo never matches a vendor',
    'Sentry\tOK\t2026-10-26\tOK never fails, so it cannot be acknowledged',
    'Sentry\tBREACH\t26-10-2026\tdate format',
    'Sentry BREACH 2026-10-26 spaces, not tabs',
  ]) {
    assert.throws(() => parseKnownIssues(`# header\n${bad}\n`, VENDORS), /line 2/, bad);
  }
});

const CLEAN_ENV = { PATH: process.env.PATH };

function cli(listPath) {
  // No vendor credentials: every vendor is UNCONFIGURED, so no network.
  return spawnSync(process.execPath, ['scripts/check-vendor-limits.mjs'], {
    env: { ...CLEAN_ENV, ...(listPath ? { KNOWN_VENDOR_ISSUES_FILE: listPath } : {}) },
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
