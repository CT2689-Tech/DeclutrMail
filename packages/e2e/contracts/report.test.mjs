import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = [
  ['triage-keep', 1],
  ['sender-policy', 1],
  ['protection-review', 1],
  ['followups-dismiss', 1],
  ['brief-preview', 1],
  ['senders-search-typing', 3],
  ['public-journeys', 2],
  ['cookie-consent', 2],
];
function report() {
  return {
    suites: [
      {
        specs: files.flatMap(([file, n]) =>
          Array.from({ length: n }, () => ({
            file: `specs/${file}.spec.ts`,
            tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
          })),
        ),
      },
    ],
  };
}
function check(body) {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-report-'));
  try {
    const path = join(dir, 'report.json');
    writeFileSync(path, JSON.stringify(body));
    return spawnSync(process.execPath, ['contracts/assert-journeys.mjs', path], {
      encoding: 'utf8',
    }).status;
  } finally {
    rmSync(dir, { recursive: true });
  }
}
test('complete journey report passes', () => assert.equal(check(report()), 0));
test('one missing required journey fails despite eleven passing tests', () => {
  const body = report();
  body.suites[0].specs.shift();
  assert.notEqual(check(body), 0);
});
test('skipped journey cannot make a green report', () => {
  const body = report();
  body.suites[0].specs[0].tests[0].results[0].status = 'skipped';
  assert.notEqual(check(body), 0);
});
test('flaky retry cannot hide a failed journey', () => {
  const body = report();
  body.suites[0].specs[0].tests[0].status = 'flaky';
  assert.notEqual(check(body), 0);
});
